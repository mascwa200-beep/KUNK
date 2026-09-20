#!/usr/bin/env python3
"""Headless render smoke test for synthnet.

This exists because of a specific failure that shipped once: a renderer with a
fatal syntax error was bundled, the build reported success, and two sites
rendered nothing. `node --check` catches that particular case, but only that
one. A renderer can parse fine and still throw at runtime, render an empty
page, or print raw inline markup to the screen -- all of which look like
success to every other check in CI.

So this loads real pages in a real browser and asserts on what the user would
actually see. It deliberately lives here rather than in synthnet/tools/,
because everything under synthnet/tools/ is stdlib-only so it can run under
Termux on a phone, and Playwright is not stdlib.

Usage:  python3 .github/scripts/synthnet_smoke.py [--root synthnet] [--keep-going]
"""

import argparse
import json
import os
import pathlib
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Substrings that must never reach the rendered page. Each one means a renderer
# passed a markup-bearing string through as plain text.
LEAK_MARKERS = ["[url=", "[b]", "[/b]", "[i]", "[/i]", "[quote", "[img:", "[list]", "[code]",
                # Not markup, but the same class of defect: a value that
                # rendered instead of being read. String(someObject) shipped
                # visibly on every user post once.
                "[object Object]", "undefined undefined", "NaN"]

# One representative path per site type, formatted with the first id found.
# Kept in sync with the path table in synthnet/docs/AUTHORING.md.
TYPE_PROBES = {
    "forum": ["/", "/board/{board}", "/topic/{topic}", "/faq", "/search",
              "/members", "/account/register"],
    "social": ["/", "/post/{post}", "/search", "/members", "/account"],
    "blog": ["/", "/post/{post}"],
    "news": ["/", "/article/{article}", "/live/{live}", "/factcheck/{check}",
             "/corrections"],
    "wiki": ["/", "/wiki/{article}"],
    "media": ["/", "/watch/{item}", "/channels", "/members", "/search",
              "/upload", "/signup"],
    "page": ["/"],
    # The 2026 types. Without their sub-paths listed here only the index of
    # each was ever loaded, leaving most of every new renderer unexercised --
    # and an index that works says nothing about the detail page.
    "aggregator": ["/", "/item/{link}"],
    "qa": ["/", "/q/{question}"],
    "board": ["/", "/t/{thread}"],
    "shop": ["/", "/p/{product}", "/cart"],
    "market": ["/", "/l/{listing}"],
    "assistant": ["/", "/chat"],
    "mail": ["/", "/m/{message}"],
    "portal": ["/", "/s/{service}"],
    "stream": ["/", "/w/{video}"],
    "dash": ["/"],
    "control": ["/", "/packs", "/me", "/storage"],
    # The routes the decor sweep added. Nothing had ever rendered them: the
    # adversarial pass pointed out that smoke's probe list stopped at the
    # shapes each type had in 2024, so /search, /members and /account -- all
    # brand new, all reachable from the nav on every page -- had never once
    # been through the 360px sweep or the leaked-markup check.
    # News that is not video, plus the chat the forums migrated to.
    "wire": ["/", "/d/{dispatch}", "/kw/62"],
    "newsletter": ["/", "/i/{issue}"],
    "chat": ["/", "/c/{channel}"],
}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D102 - silence per-request logging
        pass


def serve(root: pathlib.Path, port: int) -> ThreadingHTTPServer:
    handler = lambda *a, **kw: QuietHandler(*a, directory=str(root), **kw)  # noqa: E731
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def first_id(container, *keys):
    """Return the first 'id' found under any of the given keys, or None."""
    for key in keys:
        seq = container.get(key)
        if isinstance(seq, list) and seq and isinstance(seq[0], dict):
            got = seq[0].get("id")
            if got is not None:
                return str(got)
    return None


def probes_for(site: dict) -> list:
    """Build the concrete URL paths to visit for one site."""
    data = site.get("data") or {}
    fills = {
        "board": None,
        "topic": first_id(data, "topics"),
        "post": first_id(data, "feed", "posts"),
        "article": first_id(data, "articles"),
        "item": first_id(data, "items"),
        "link": first_id(data, "links"),
        "question": first_id(data, "questions"),
        "thread": first_id(data, "threads"),
        "product": first_id(data, "products"),
        "listing": first_id(data, "listings"),
        "message": first_id(data, "messages"),
        "service": first_id(data, "services"),
        "video": first_id(data, "videos"),
        "live": first_id(data, "live"),
        "check": first_id(data, "factchecks"),
        "dispatch": first_id(data, "dispatches"),
        "issue": first_id(data, "issues"),
        "channel": first_id(data, "channels"),
    }
    for cat in data.get("categories") or []:
        if isinstance(cat, dict):
            fills["board"] = first_id(cat, "boards") or fills["board"]
            if fills["board"]:
                break

    out = []
    for template in TYPE_PROBES.get(site.get("type"), ["/"]):
        try:
            path = template.format(**fills)
        except (KeyError, IndexError):
            continue
        if "None" in path:
            continue
        out.append(path)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--keep-going", action="store_true",
                    help="report every failure instead of stopping at the first")
    args = ap.parse_args()

    root = pathlib.Path(args.root).resolve()
    registry_path = root / "net" / "registry.json"
    if not registry_path.is_file():
        print(f"FAIL: {registry_path} is missing. Run tools/build.py first.")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: playwright is not installed (pip install playwright && "
              "playwright install chromium)")
        return 1

    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    sites = registry.get("sites") or []
    if not sites:
        print("FAIL: registry.json lists no sites.")
        return 1

    port = free_port()
    httpd = serve(root, port)
    base = f"http://127.0.0.1:{port}/index.html"
    failures = []

    def launch(pw):
        """Launch Chromium, preferring a browser already on the machine.

        Sandboxes and CI images often ship a pinned Chromium under
        PLAYWRIGHT_BROWSERS_PATH whose build number does not match whatever
        version pip resolved. Playwright then refuses to start and tells you to
        download one, which is wrong when a perfectly good binary is sitting
        right there. Try the default first, fall back to the newest build we
        can find on disk.
        """
        try:
            return pw.chromium.launch()
        except Exception as first:
            roots = [pathlib.Path(p) for p in
                     (os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"),)]
            found = []
            for r in roots:
                if r.is_dir():
                    found += sorted(r.glob("chromium-*/chrome-linux/chrome"))
                    found += sorted(r.glob("chromium_headless_shell-*/chrome-linux/headless_shell"))
            if not found:
                raise first
            exe = str(found[-1])
            print(f"note: falling back to {exe}")
            return pw.chromium.launch(executable_path=exe)

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 1280, "height": 800})

            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))

            visited = 0
            for entry in sites:
                domain = entry.get("domain")
                site_file = root / entry.get("path", "")
                if not site_file.is_file():
                    failures.append(f"{domain}: registry path {entry.get('path')} does not exist")
                    continue
                site = json.loads(site_file.read_text(encoding="utf-8"))

                for path in probes_for(site):
                    url = f"{base}#synth://{domain}{path}"
                    errors.clear()
                    page.goto(url, wait_until="networkidle")
                    page.wait_for_timeout(120)
                    visited += 1

                    text = page.inner_text("#synth-viewport")
                    where = f"synth://{domain}{path}"

                    if errors:
                        failures.append(f"{where}: console error: {errors[0][:200]}")
                    if len(text.strip()) < 40:
                        failures.append(f"{where}: rendered {len(text.strip())} chars (empty page)")
                    # app/render.js draws a notice box when it has no renderer
                    # for a type, or when one throws. Both are legible pages
                    # with plenty of text, so every assertion here was happy
                    # with them: a network where all 109 sites rendered
                    # "Unsupported site type" would have swept green.
                    #
                    # That was survivable while index.html carried all twenty
                    # renderers -- nothing could go missing at runtime. Now
                    # app/render.js fetches them on demand and this is the
                    # sweep that would notice a loader that stopped loading.
                    for notice in ("Unsupported site type",
                                   "This page could not be displayed"):
                        if notice in text:
                            failures.append(
                                f"{where}: rendered the {notice!r} notice "
                                "instead of the page")
                            break
                    for marker in LEAK_MARKERS:
                        if marker in text:
                            idx = text.index(marker)
                            failures.append(
                                f"{where}: leaked raw markup {marker!r} -> "
                                f"...{text[max(0, idx - 30):idx + 60]!r}")
                            break
                    if failures and not args.keep_going:
                        break
                if failures and not args.keep_going:
                    break

            # Search, end to end. This is here because of a near miss: the
            # search index was restructured to shrink it, the size check went
            # green, and body-text search silently stopped working because the
            # consumer still expected the old shape. A size budget cannot tell
            # you a feature died. Assert on a word that appears in page bodies
            # but in no site title or domain, so only a working body-text index
            # can find it.
            if not failures or args.keep_going:
                errors.clear()
                page.goto(f"{base}#synth://search.verity.net/?q=substation",
                          wait_until="networkidle")
                page.wait_for_timeout(200)
                found = page.inner_text("#synth-viewport")
                if errors:
                    failures.append(f"search: console error: {errors[0][:200]}")
                hits = page.eval_on_selector_all(
                    "#synth-viewport a[href*='synth://']", "els => els.length")
                if hits < 3:
                    failures.append(
                        f"search for 'substation' returned {hits} result links; "
                        "expected at least 3. The index and its consumer have "
                        "probably drifted apart.")
                if "substation" not in found.lower():
                    failures.append("search results page never mentions the query term")

            # Phone layout: horizontal overflow makes the whole thing unusable
            # on the stated primary target, and it is invisible on a desktop.
            if not failures or args.keep_going:
                phone = browser.new_page(viewport={"width": 360, "height": 640})
                phone.goto(base, wait_until="networkidle")
                phone.wait_for_timeout(150)
                overflow = phone.evaluate(
                    "() => document.documentElement.scrollWidth - "
                    "document.documentElement.clientWidth")
                if overflow > 1:
                    failures.append(f"360px viewport: {overflow}px of horizontal overflow")
                has_search = phone.evaluate(
                    "() => { const e = document.querySelector('#synth-search');"
                    " if (!e) return false; const r = e.getBoundingClientRect();"
                    " return r.width > 0 && r.height > 0; }")
                if not has_search:
                    failures.append("360px viewport: no visible search control")

                # ...and then every site, which this did not do. It checked the
                # start page and stopped, so twenty-three skins and every site
                # on the network were never once measured at the width the
                # project states as its primary target. A skin that overflows
                # is unusable on a phone and completely invisible on a desktop,
                # which is where it gets written.
                #
                # Each site is checked at its front door and one route in, and
                # the widest offending element is named, because "this page
                # overflows" without saying what is doing it is a bug report
                # you have to redo from scratch.
                # document.scrollWidth is the WRONG instrument for content
                # inside this shell, and the comment in theme/skins/forum.css
                # says so from the last time: "the nav items were simply cut
                # off at the edge with no scroll and no wrap. Document
                # scrollWidth was unaffected, which is why the overflow check
                # never caught it -- the clipping happened inside the banner."
                # #synth-viewport clips, so the document never widens and the
                # page is broken and measures clean.
                #
                # So measure the elements. Anything whose right edge is past
                # the viewport's is overflowing, with two deliberate
                # exceptions -- both of which are content you CAN still read:
                #
                #   * something between it and the viewport scrolls, so you
                #     swipe to it: a channel strip, a wide table, a code block
                #   * it is animated, so it comes to you: the breaking-news
                #     ticker and the 1998 marquees are `white-space: nowrap`
                #     inside an `overflow: hidden` window and translate across
                #     it, and are several thousand pixels wide on purpose
                #
                # Anything else past the edge is text nobody can get to.
                WIDEST = """() => {
                  const host = document.querySelector('#synth-viewport');
                  if (!host) return null;
                  const edge = host.getBoundingClientRect().right;
                  const scrolls = (n) => {
                    if (getComputedStyle(n).animationName !== 'none') return true;
                    for (let p = n.parentElement; p && p !== host; p = p.parentElement) {
                      const s = getComputedStyle(p);
                      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
                      if (s.animationName !== 'none') return true;
                    }
                    return false;
                  };
                  let worst = null, w = edge + 1;
                  host.querySelectorAll('*').forEach(n => {
                    const r = n.getBoundingClientRect();
                    if (r.width === 0 && r.height === 0) return;
                    if (r.right <= w) return;
                    if (scrolls(n)) return;
                    w = r.right;
                    worst = {
                      sel: (n.tagName.toLowerCase() + '.' +
                            String(n.className || '')).slice(0, 60),
                      over: Math.round(r.right - edge)
                    };
                  });
                  return worst; }"""
                DEEP = """() => {
                  const a = [...document.querySelectorAll('#synth-viewport a[href]')]
                    .map(x => x.getAttribute('href'))
                    .find(h => h && h.indexOf('://') < 0 && h.length > 3);
                  return a || null; }"""
                swept = 0
                for entry in registry.get("sites", []):
                    domain = entry.get("domain")
                    if not domain:
                        continue
                    phone.goto(f"{base}#synth://{domain}/", wait_until="networkidle")
                    phone.wait_for_timeout(150)
                    swept += 1
                    wide = phone.evaluate(WIDEST)
                    if wide:
                        failures.append(
                            f"360px: synth://{domain}/ (skin {entry.get('skin')}) "
                            f"runs {wide['over']}px past the right edge at "
                            f"{wide['sel']}")
                    href = phone.evaluate(DEEP)
                    if not href:
                        continue
                    path = href if href.startswith("/") else "/" + href
                    phone.goto(f"{base}#synth://{domain}{path}",
                               wait_until="networkidle")
                    phone.wait_for_timeout(150)
                    wide = phone.evaluate(WIDEST)
                    if wide:
                        failures.append(
                            f"360px: synth://{domain}{path} (skin "
                            f"{entry.get('skin')}) runs {wide['over']}px past "
                            f"the right edge at {wide['sel']}")
                print(f"  360px: swept {swept} sites, front door and one route in")
                phone.close()

            browser.close()
    finally:
        httpd.shutdown()

    if failures:
        print(f"FAIL: {len(failures)} problem(s) across {visited} page(s):")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"OK: {visited} pages rendered, no console errors, no leaked markup, "
          f"no horizontal overflow at 360px.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
