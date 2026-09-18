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
LEAK_MARKERS = ["[url=", "[b]", "[/b]", "[i]", "[/i]", "[quote", "[img:", "[list]", "[code]"]

# One representative path per site type, formatted with the first id found.
# Kept in sync with the path table in synthnet/docs/AUTHORING.md.
TYPE_PROBES = {
    "forum": ["/", "/board/{board}", "/topic/{topic}"],
    "social": ["/", "/post/{post}"],
    "blog": ["/", "/post/{post}"],
    "news": ["/", "/article/{article}"],
    "wiki": ["/", "/wiki/{article}"],
    "media": ["/", "/watch/{item}"],
    "page": ["/"],
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
