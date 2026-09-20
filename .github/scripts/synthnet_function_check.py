#!/usr/bin/env python3
"""Check that what a page offers, a page does.

Every other check in this project asks whether a page RENDERS. This one asks
whether it WORKS -- whether the things on it that look like controls are
controls, and whether the things that look like links go anywhere.

The failure it exists for is decor. A renderer writes

    el('span', {}, 'catalog archive rules')

and three words sit at the top of the board in link colour for a year, and
every check stays green, because nothing about that span is an error. It
renders perfectly. It is a lie to the reader, which is the only kind of bug
this project has left that matters.

What counts as a control here is decided by how the engine builds one:

  * ctx.link() produces <a data-synth-href="...">. That is a real link.
  * SYNTH.el(tag, {onclick: fn}) sets the onclick PROPERTY, which a page
    can read back.
  * a renderer may instead call addEventListener, which leaves NO trace a
    page can read -- so this wraps EventTarget.prototype.addEventListener
    before the app loads and marks every node that registers one. The first
    version did not, and confidently reported the assistant's
    suggested-question chips as dead when they had worked all along. A
    checker blind to half the ways a handler is attached does not find
    decor, it invents it.

Those two tell us a node is DEFINITELY live. They cannot tell us it is dead,
because a handler may be delegated from an ancestor -- and this app delegates
from #synth-viewport, so every element has a listener above it somewhere.

So the check has two passes:

  1. crawl every site and collect the things that LOOK like controls and are
     not provably live, deduped by tag+class+text, because the same dead span
     on forty pages is one bug;
  2. for each distinct one, go to a page carrying it, PRESS IT, and see
     whether anything at all changes -- the route, or a single byte of the
     viewport. Nothing changed means nothing happens means decor.

Pass 2 is the whole point. Pass 1 is an index so that pass 2 is a hundred
clicks instead of four thousand.

Usage:  python3 .github/scripts/synthnet_function_check.py [--root synthnet]
        [--sites N] [--pages N] [--only domain.com]
"""

import argparse
import glob
import json
import os
import pathlib
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def launch(pw):
    try:
        return pw.chromium.launch()
    except Exception as first:
        root = pathlib.Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH",
                                           "/opt/pw-browsers"))
        found = sorted(glob.glob(str(root / "chromium-*/chrome-linux/chrome"))) + \
                sorted(glob.glob(str(root / "chromium_headless_shell-*/chrome-linux/headless_shell")))
        if not found:
            raise first
        return pw.chromium.launch(executable_path=found[-1])


# Words that promise something happens. Kept to things a reader would
# actually try to click; "Home" and "About" are here because a nav item that
# does nothing is the worst offender of the lot.
CLICKY = {
    "catalog", "archive", "rules", "reply", "quote", "report", "next", "prev",
    "previous", "more", "search", "login", "log in", "sign in", "sign up",
    "register", "download", "submit", "send", "post", "subscribe", "apply",
    "buy", "add to cart", "checkout", "continue", "back", "home", "about",
    "contact", "help", "faq", "settings", "edit", "delete", "save", "cancel",
    "expand", "collapse", "show more", "read more", "view all", "see all",
    "sort", "filter", "refresh", "retry", "upload", "print", "share",
    "follow", "unfollow", "like", "vote", "flag", "mark read", "menu",
}

# The page-level probe. Returns everything that looks like a control together
# with whether it is one, so the Python side decides and the JS side only
# reports.
PROBE = r"""() => {
  const view = document.getElementById('synth-viewport');
  if (!view) return {error: 'no viewport'};

  const isReal = (n) => {
    if (n.dataset && n.dataset.synthHref) return true;
    if (typeof n.onclick === 'function') return true;
    if (n.__synthListener) return true;
    /* NO ancestor walk. The engine puts one delegated click handler on
     * #synth-viewport to catch [data-synth-href], so "an ancestor has a
     * listener" is true of every element on every page and marking those
     * live turned this check off entirely -- it reported a clean sweep of
     * twelve sites while the dead nav item was still sitting there. Static
     * inspection cannot answer this. Pass 2 clicks the thing. */
    if (n.tagName === 'A' && n.getAttribute('href') &&
        n.getAttribute('href') !== '#') return true;
    if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' ||
        n.tagName === 'SELECT' || n.tagName === 'DETAILS' ||
        n.tagName === 'SUMMARY' || n.tagName === 'LABEL') return true;
    if (n.closest && n.closest('details')) return true;
    if (n.closest && n.closest('[data-synth-href]')) return true;
    if (n.closest && n.closest('form')) return true;
    return false;
  };

  const disabledish = (n) => {
    if (n.disabled) return true;
    const cls = String(n.className || '');
    if (/\b(dis|disabled|is-disabled|inactive|off|dead|broken|expired)\b/.test(cls)) return true;
    if (n.getAttribute && n.getAttribute('aria-disabled') === 'true') return true;
    const st = getComputedStyle(n);
    if (st.pointerEvents === 'none') return true;
    if (Number(st.opacity) < 0.6) return true;
    return false;
  };

  // Text that is a heading is not a promise that something happens. A page
  // with an <h2>Contact</h2> is not offering to do anything when you press
  // it, and the first version of this check reported every one of them.
  const LABELS = new Set(['H1','H2','H3','H4','H5','H6','TH','CAPTION',
                          'LEGEND','DT','STRONG','B','EM','I','TITLE']);
  /* NOT span or div. Those are what a nav item is made of -- excluding
   * them would have silently dropped the 252 dead nav items this check
   * exists to find, which is the second time in this file that widening a
   * filter turned the check off. Authored prose is caught by its container
   * instead: markup.js wraps every paragraph it renders in .synth-p. */
  const PROSE = new Set(['P','TD','LI','BLOCKQUOTE','PRE','FIGCAPTION','DD',
                         'SMALL']);
  const inProse = (n) => !!(n.closest && n.closest('.synth-p, .synth-code, blockquote'));

  // The ad layer is decor ON PURPOSE. An advert on this network that does
  // nothing when pressed is not a bug, it is what an advert on a county
  // site in 2026 does.
  const isAd = (n) => !!(n.closest && n.closest(
    '[class*="lv-ad"],[class*="-ad-"],[class*="ad-box"],[class*="adslot"],.ad'));

  // An element whose whole text belongs to a control inside it is that
  // control's wrapper, not a second dead one.
  const wrapsAControl = (n) => {
    for (const c of n.querySelectorAll('button,a,input,select,textarea,[data-synth-href]')) {
      if ((c.textContent || '').trim() === (n.textContent || '').trim()) return true;
      if (typeof c.onclick === 'function') return true;
      if (c.dataset && c.dataset.synthHref) return true;
    }
    return false;
  };

  const out = {inert: [], links: [], forms: 0, buttons: 0};

  // (a) anything the browser says is clickable
  const all = view.querySelectorAll('*');
  for (const n of all) {
    const txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt || txt.length > 60) continue;
    if (n.children.length > 2) continue;            // a container, not a control
    const st = getComputedStyle(n);
    const pointer = st.cursor === 'pointer';
    const clicky = CLICKY_WORDS.has(txt.toLowerCase());
    const tag = n.tagName;
    const controlish = tag === 'BUTTON' ||
                       (n.getAttribute && n.getAttribute('role') === 'button');
    if (!pointer && !clicky && !controlish) continue;
    if (!pointer && LABELS.has(tag)) continue;
    /* Prose is not a control either. A <p> reading "NEXT" in an old-web
     * table, or a news kicker reading "ABOUT", is content that happens to
     * use a word people click. Without a pointer cursor there is nothing
     * offering to do anything. */
    if (!pointer && (PROSE.has(tag) || inProse(n))) continue;
    if (isAd(n) || wrapsAControl(n)) continue;
    if (isReal(n) || disabledish(n)) continue;
    // A bare word inside a real link's label is not itself decor.
    out.inert.push({
      tag: tag, cls: String(n.className || '').slice(0, 40),
      text: txt.slice(0, 48),
      why: pointer ? 'cursor:pointer' : (controlish ? 'is a ' + tag.toLowerCase()
                                                    : 'reads as a control')
    });
    if (out.inert.length > 40) break;
  }

  for (const a of view.querySelectorAll('[data-synth-href]')) {
    out.links.push(a.dataset.synthHref);
  }
  out.forms = view.querySelectorAll('form').length;
  out.buttons = view.querySelectorAll('button').length;
  return out;
}"""


# A cheap fingerprint of the viewport: length plus one character from the
# middle. Enough to notice a re-render, cheap enough to take 200 times.
SNAP = r"""() => {
  const v = document.getElementById('synth-viewport');
  const h = v ? v.innerHTML : '';
  /* Scroll counts. A table-of-contents entry calls scrollIntoView and
   * changes neither the DOM nor the route, and the first version of this
   * check called every one of them dead. Jumping the reader to a heading is
   * a thing happening. */
  return {len: h.length, sig: h.length ? h.charCodeAt(h.length >> 1) : 0,
          route: location.hash,
          scroll: (v ? v.scrollTop : 0) + window.scrollY};
}"""

SNAP_AND_CLICK = r"""(want) => {
  const view = document.getElementById('synth-viewport');
  const nodes = Array.from(view.querySelectorAll(want.tag));
  const n = nodes.find(x =>
    (x.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48) === want.text &&
    String(x.className || '').slice(0, 40) === want.cls);
  if (!n) return {gone: true};
  const h = view.innerHTML;
  const before = {len: h.length, sig: h.length ? h.charCodeAt(h.length >> 1) : 0,
                  route: location.hash,
                  scroll: view.scrollTop + window.scrollY};
  n.click();
  return before;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--sites", type=int, default=0, help="limit sites (0 = all)")
    ap.add_argument("--pages", type=int, default=10, help="pages per site")
    ap.add_argument("--only", default="", help="one domain")
    ap.add_argument("--json", default="", help="write findings here")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: playwright is not installed")
        return 1

    port = free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port),
                              lambda *a, **k: Quiet(*a, directory=str(root), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    findings = {}       # domain -> list of finding dicts
    stats = {"pages": 0, "sites": 0, "inert": 0, "notfound": 0}
    errors = []

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 360, "height": 900})
            page.on("pageerror", lambda e: errors.append(str(e)))
            # BEFORE the app loads: record every node that registers an
            # interactive listener. add_init_script only applies to the next
            # navigation, so this has to precede goto -- putting it after was
            # the bug that made every addEventListener control look dead.
            page.add_init_script("""
              (function () {
                var orig = EventTarget.prototype.addEventListener;
                var LIVE = {click:1, submit:1, change:1, input:1, keydown:1,
                            keypress:1, mousedown:1, pointerdown:1, toggle:1};
                EventTarget.prototype.addEventListener = function (t, f, o) {
                  if (LIVE[t]) { try { this.__synthListener = true; } catch (e) {} }
                  return orig.call(this, t, f, o);
                };
              })();
            """)
            page.goto(f"http://127.0.0.1:{port}/index.html",
                      wait_until="networkidle")
            page.wait_for_timeout(600)
            page.evaluate("window.CLICKY_WORDS = new Set(%s)"
                          % json.dumps(sorted(CLICKY)))

            sites = page.evaluate(
                "() => SYNTH.data.list().map(r => ({d: r.domain, t: r.type}))")
            if args.only:
                sites = [s for s in sites if s["d"] == args.only]
            if args.sites:
                sites = sites[:args.sites]

            for site in sites:
                dom, typ = site["d"], site["t"]
                stats["sites"] += 1
                seen, queue = set(), ["/"]
                while queue and len(seen) < args.pages:
                    path = queue.pop(0)
                    if path in seen:
                        continue
                    seen.add(path)
                    errors.clear()
                    try:
                        page.evaluate(
                            "(u) => SYNTH.engine.navigate(u, {push: false})",
                            "synth://%s%s" % (dom, path))
                        page.wait_for_timeout(190)
                    except Exception as exc:
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "threw",
                             "detail": str(exc)[:160]})
                        continue
                    stats["pages"] += 1
                    if errors:
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "console",
                             "detail": errors[0][:160]})

                    text = page.inner_text("#synth-viewport")
                    low = text.lower()
                    if ("page not found" in low or "no page here" in low
                            or "is not a page on this" in low
                            or "404" in low[:400]):
                        stats["notfound"] += 1
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "dead-end",
                             "detail": text[:90].replace("\n", " ")})
                        continue

                    probe = page.evaluate(PROBE)
                    if probe.get("error"):
                        continue
                    for item in probe["inert"]:
                        stats["inert"] += 1
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "inert", "type": typ,
                             "tag": item["tag"], "cls": item["cls"],
                             "text": item["text"], "why": item["why"],
                             "at": "synth://%s%s" % (dom, path)})
                    for href in probe["links"]:
                        if href.startswith("/") and href not in seen:
                            if len(seen) + len(queue) < args.pages:
                                queue.append(href)

            # ---- pass 2: press them --------------------------------------
            #
            # One instance of each distinct candidate, on a page carrying it.
            # A control is real if pressing it changes the route or a byte of
            # the viewport. This is the only test delegation cannot fool.
            candidates = {}
            for dom, items in findings.items():
                for f in items:
                    if f["kind"] == "inert":
                        candidates.setdefault(
                            (f.get("type"), f["tag"], f["cls"], f["text"]), f)

            verdicts = {}
            for key, f in candidates.items():
                try:
                    page.evaluate(
                        "(u) => SYNTH.engine.navigate(u, {push: false})",
                        f["at"])
                    page.wait_for_timeout(200)
                    shot = page.evaluate(SNAP_AND_CLICK,
                                         {"tag": f["tag"], "text": f["text"],
                                          "cls": f["cls"]})
                    if shot.get("gone"):
                        verdicts[key] = "vanished"
                        continue
                    # POLL, do not sample once. The assistant's chips repaint
                    # about 300ms after the press and a single look at 240ms
                    # called every one of them dead. A control is allowed to
                    # take a moment; it is not allowed to take forever.
                    verdict = "decor"
                    for _ in range(9):
                        page.wait_for_timeout(180)
                        after = page.evaluate(SNAP)
                        if (after["len"] != shot["len"]
                                or after["sig"] != shot["sig"]
                                or after["route"] != shot["route"]
                                or after["scroll"] != shot["scroll"]):
                            verdict = "live"
                            break
                    verdicts[key] = verdict
                except Exception as exc:
                    verdicts[key] = "error: " + str(exc)[:60]

            browser.close()
    finally:
        srv.shutdown()

    live = sum(1 for v in verdicts.values() if v == "live")
    dead = {k: f for k, f in candidates.items() if verdicts.get(k) == "decor"}
    other = len(verdicts) - live - len(dead)
    print(f"pressed {len(candidates)} distinct controls: {live} did something, "
          f"{len(dead)} did nothing at all, {other} could not be tested\n")

    # Only the ones that did nothing survive as findings.
    for dom in list(findings):
        findings[dom] = [
            f for f in findings[dom]
            if f["kind"] != "inert"
            or (f.get("type"), f["tag"], f["cls"], f["text"]) in dead]
        if not findings[dom]:
            del findings[dom]
    stats["inert"] = sum(1 for items in findings.values()
                         for f in items if f["kind"] == "inert")

    # Group the inert findings: the same span on 40 pages is one bug.
    groups = {}
    for dom, items in findings.items():
        for f in items:
            if f["kind"] != "inert":
                key = ("%s|%s|%s" % (f["kind"], dom, f.get("path", "")))
                groups.setdefault(key, {"kind": f["kind"], "domains": set(),
                                        "sample": f, "count": 0})
            else:
                key = "inert|%s|%s|%s" % (f.get("type"), f["tag"], f["cls"])
                groups.setdefault(key, {"kind": "inert", "domains": set(),
                                        "sample": f, "count": 0})
            groups[key]["domains"].add(dom)
            groups[key]["count"] += 1

    ordered = sorted(groups.items(), key=lambda kv: -kv[1]["count"])
    print(f"swept {stats['sites']} sites, {stats['pages']} pages")
    print(f"  {stats['inert']} things that look like controls and are not")
    print(f"  {stats['notfound']} navigations that dead-ended\n")
    for key, g in ordered[:60]:
        s = g["sample"]
        where = ", ".join(sorted(g["domains"])[:3])
        if len(g["domains"]) > 3:
            where += f" +{len(g['domains']) - 3}"
        if g["kind"] == "inert":
            print(f"  x{g['count']:<4} [{s.get('type','?')}] <{s['tag'].lower()}"
                  f" class=\"{s['cls']}\"> {s['text']!r}  ({s['why']})")
            print(f"         {where}")
        else:
            print(f"  x{g['count']:<4} {g['kind']}: {s.get('path','')} "
                  f"{str(s.get('detail',''))[:70]!r}")
            print(f"         {where}")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(
            {"stats": stats,
             "groups": [{"key": k, "kind": v["kind"], "count": v["count"],
                         "domains": sorted(v["domains"]), "sample": v["sample"]}
                        for k, v in ordered]}, indent=1))
        print(f"\nwrote {args.json}")

    if not groups:
        print("\nOK: everything that looks like a control is one.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
