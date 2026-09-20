#!/usr/bin/env python3
"""Open dist/synthnet.html the way a person would: off a file manager, offline.

The standalone build is the mode that needs no install and no server -- copy
one file to a phone, tap it. CI checked its SIZE and nothing else, which is
to say CI checked that the file existed.

That gap mattered the moment the renderers stopped being listed in
index.html. Served, app/render.js fetches a type's renderer and stylesheet on
demand; a single file has nothing to fetch from, so tools/build.py inlines
every entry in app/loadmap.js instead. The reason that was never done before
was a belief that deferring the renderers "costs the single-file standalone
build". It does not -- SYNTH.render.has() is true for every inlined type, so
ensure() resolves without a fetch -- but a belief and an assertion are not
the same thing, and only one of them fails when it stops being true.

So: a real file:// load, a page of several types, and TWO things asserted
that a served run cannot check.

  * Nothing goes over the network. Not one request that is not file://.
    A renderer that slipped out of the bundle would be fetched from a path
    that does not exist next to the file, and the page would be a notice box
    on someone's phone with no way to diagnose it.
  * Every type renders with its stylesheet applied, not just with text on
    the screen. An inlined <style> that went missing leaves a page that
    still has all its words.

Usage:  python3 .github/scripts/synthnet_standalone_check.py
        [--bundle synthnet/dist/synthnet.html]
"""

import argparse
import glob
import pathlib
import sys

# One of each shape the bundle has to carry: a renderer whose skin is heavy,
# one with a minimal skin, a 2026 site, an archive site, and the control
# panel -- which is in the loadmap too and is the only surface that writes.
PAGES = [
    ("synth://boards.gridfall.net/", "forum"),
    ("synth://verity.wiki/", "wiki"),
    ("synth://shopwell.store/", "shop"),
    ("synth://now.verityledger.com/", "news"),
    ("synth://clipvault.tv/", "media"),
    ("synth://verityfeed.social/", "social"),
    ("synth://gridfall.chat/", "chat"),
    ("synth://control.verity.net/", "control"),
]

PROBE = r"""() => {
  const v = document.getElementById('synth-viewport');
  const page = v && v.querySelector('.synth-page');
  if (!page) return {ok: false, why: 'no .synth-page element'};
  const text = (v.innerText || '').trim();
  if (text.indexOf('Unsupported site type') !== -1) {
    return {ok: false, why: 'the renderer for this type is not in the bundle'};
  }
  if (text.length < 120) {
    return {ok: false, why: 'rendered only ' + text.length + ' characters'};
  }
  /* A skin that failed to inline leaves the words and takes the layout.
     Every skin in this project sets at least a font stack or a background
     on .synth-page or something inside it; unstyled is the browser default
     serif on a transparent background. */
  const cs = getComputedStyle(page);
  const styled = cs.fontFamily && cs.fontFamily.indexOf('Times') === -1
                 && cs.fontFamily !== 'serif';
  if (!styled) {
    return {ok: false, why: 'unstyled: font-family is ' + cs.fontFamily};
  }
  return {ok: true, font: cs.fontFamily.slice(0, 30), chars: text.length};
}"""


def launch(pw):
    try:
        return pw.chromium.launch()
    except Exception as first:
        found = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")) + \
            sorted(glob.glob("/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell"))
        if not found:
            raise first
        return pw.chromium.launch(executable_path=found[-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", default="synthnet/dist/synthnet.html")
    args = ap.parse_args()
    bundle = pathlib.Path(args.bundle).resolve()
    if not bundle.is_file():
        print(f"FAIL: {args.bundle} does not exist")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: playwright is not installed")
        return 1

    problems = []
    offsite = []
    errors = []

    with sync_playwright() as pw:
        browser = launch(pw)
        page = browser.new_page(viewport={"width": 360, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console",
                lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("request",
                lambda r: None if r.url.startswith("file:") else offsite.append(r.url))

        # No server. No --root. The file, opened.
        page.goto("file://" + str(bundle), wait_until="load")
        page.wait_for_timeout(1200)

        if not page.evaluate("() => !!(window.SYNTH && SYNTH.engine)"):
            print("FAIL: the bundle loaded but SYNTH.engine is not there")
            browser.close()
            return 1

        for url, kind in PAGES:
            # navigate() resolves after the page is committed, and Playwright
            # awaits a returned promise -- so this waits for the real thing
            # rather than for a guess at how long it takes.
            page.evaluate(
                "(u) => SYNTH.engine.navigate(u, {push: false})", url)
            page.wait_for_timeout(120)
            got = page.evaluate(PROBE)
            if got.get("ok"):
                print(f"  ok   {kind:<11} {got['chars']:>5} chars, "
                      f"font {got['font']}")
            else:
                problems.append(f"{kind} ({url}): {got.get('why')}")
                print(f"  FAIL {kind:<11} {got.get('why')}")

        browser.close()

    if offsite:
        problems.append(
            "the standalone file made %d request(s) that were not file:// -- "
            "it is not self-contained: %s"
            % (len(offsite), ", ".join(sorted(set(offsite))[:4])))
    if errors:
        problems.append("console error off file://: " + errors[0][:160])

    print()
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"OK: {len(PAGES)} site types render off file:// with no server, no "
          "network and no console errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
