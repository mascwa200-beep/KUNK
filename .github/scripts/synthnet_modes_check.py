#!/usr/bin/env python3
"""Render every mode of the four newest renderers, against fixtures.

Four renderers landed with no content on the network using them:

    wire        a news agency file
    newsletter  an email newsletter read on the web
    chat        the place the forums went
    news        gained /live, /factcheck and /corrections

Every other check in this repo drives the real sites, so all four were
shipped never having been rendered once. Three of them threw on their first
contact with data, and the fourth drew the wrong thing -- none of which any
existing check could see, because you cannot render a route no site serves.

So this check brings its own content. The fixtures in .github/fixtures/modes
are four sites that exist only here: they are copied into a throwaway tree
next to the real ones, built, and driven. They are not on the network, they
are not in dist/synthnet.html, and no content author has to remember to keep
a liveblog open or a fact check on file for this to keep working.

What it asserts beyond "did not throw":

  * every route produced real text, not an empty shell
  * the specific copy from the fixture reached the page, so a renderer that
    draws its furniture and drops the content still fails
  * an OPEN liveblog files new copy as the clock moves, and a CLOSED one
    does not -- the LIVE dot has to mean something
  * the authored entries survive the stream topping up around them
  * no unparsed BBCode leaks as text

{{merge_field}} is deliberately NOT treated as a leak. An unfilled merge
field is what a content farm actually ships, and slop_forum.js means it.

Usage:  python3 .github/scripts/synthnet_modes_check.py [--root synthnet]
"""

import argparse
import glob
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HOUR = 3600000

# (domain, path, selectors that must exist, copy that must appear)
CASES = [
    ("fixture.wire",  "/",              [".wr-rail"],
     ["GRIDFALL-POWER", "BULLETIN"]),
    ("fixture.wire",  "/d/d1",          [".wr-page", ".wr-main"],
     ["Substation No. 3", "CORRECTS", "1,400"]),
    ("fixture.wire",  "/cat/util",      [],
     ["GRIDFALL-POWER"]),
    ("fixture.email", "/",              [],
     ["Fixture Letter", "culvert"]),
    ("fixture.email", "/i/i1",          [],
     ["Third deferral", "unsubscribe", "Carrow"]),
    ("fixture.chat",  "/",              [],
     ["general", "lights just went"]),
    ("fixture.chat",  "/c/archive",     [],
     ["forum-archive", "gates-quarry-1998.jpg", "attachment not migrated"]),
    ("fixture.news",  "/",              [".news-livestrip"],
     []),
    ("fixture.news",  "/live",          [".news-index-list, .news-livechip-row"],
     ["live"]),
    ("fixture.news",  "/live/lb1",      [".news-live-head", ".news-entry"],
     ["Substation No. 3", "1,400"]),
    ("fixture.news",  "/live/lb2",      [".news-live-head"],
     ["as it happened"]),
    ("fixture.news",  "/factcheck",     [".news-index-list"],
     ["broadband"]),
    ("fixture.news",  "/factcheck/fc1", [".news-fc-claim", ".news-fc-verdictbox",
                                         ".news-fc-evidence"],
     ["Missing context", "advertised"]),
    ("fixture.news",  "/factcheck/fc2", [".news-fc-verdictbox"],
     ["False", "bushing"]),
    ("fixture.news",  "/corrections",   [".news-corr-row, .news-corr-item, "
                                         ".news-index-row"],
     ["Pennock", "withdrawn"]),
]

UNPARSED = ("[img:", "[url=", "[/b]", "[/list]", "[/url]", "[/i]")


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
            sorted(glob.glob(str(root / "chromium_headless_shell-*/chrome-linux/"
                                        "headless_shell")))
        if not found:
            raise first
        print(f"note: falling back to {found[-1]}")
        return pw.chromium.launch(executable_path=found[-1])


def stage(real_root, fixtures, work):
    """A throwaway copy of the network with the fixture sites dropped in."""
    root = work / "synthnet"
    shutil.copytree(real_root, root, symlinks=True,
                    ignore=shutil.ignore_patterns("dist", "__pycache__",
                                                  "*.pyc", "build", "android"))
    for src in sorted(fixtures.glob("*.json")):
        domain = json.loads(src.read_text())["domain"]
        folder = root / "net" / "sites" / domain.replace(".", "-")
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, folder / "site.json")
    return root


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--fixtures", default=".github/fixtures/modes")
    args = ap.parse_args()

    real_root = pathlib.Path(args.root).resolve()
    fixtures = pathlib.Path(args.fixtures).resolve()
    if not fixtures.is_dir():
        print(f"FAIL: no fixtures at {fixtures}")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: playwright is not installed")
        return 1

    problems, notes = [], []
    work = pathlib.Path(tempfile.mkdtemp(prefix="synthnet-modes-"))
    try:
        root = stage(real_root, fixtures, work)

        # The fixtures go through the same validator as real content. If a
        # fixture drifts from the shape the validator enforces, this check is
        # testing something the network could never contain.
        val = subprocess.run([sys.executable, str(root / "tools" / "validate.py"),
                              "--strict"], cwd=root, capture_output=True, text=True)
        if val.returncode != 0:
            out = val.stdout.strip() or val.stderr.strip()
            # The staged tree is the real network plus the fixtures, so a
            # failure here is usually the network's, not this check's. Say
            # which, or this reads as a false accusation against the fixtures.
            mine = [ln for ln in out.splitlines() if "fixture-" in ln]
            if mine:
                print("FAIL: the fixtures themselves do not validate")
            else:
                print("FAIL: the network does not validate, so the fixtures "
                      "could not be staged. Fix that first; nothing below is "
                      "about the fixtures.")
            print(out)
            return 1

        built = subprocess.run([sys.executable, str(root / "tools" / "build.py")],
                               cwd=root, capture_output=True, text=True)
        if built.returncode != 0:
            print("FAIL: build.py refused the fixtures")
            print(built.stdout.strip() or built.stderr.strip())
            return 1

        port = free_port()
        srv = ThreadingHTTPServer(("127.0.0.1", port),
                                  lambda *a, **k: Quiet(*a, directory=str(root), **k))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}/index.html"

        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 360, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console",
                    lambda m: errors.append(m.text) if m.type == "error" else None)

            for dom, path, sels, musts in CASES:
                where = f"{dom}{path}"
                errors.clear()
                page.goto(f"{base}#synth://{dom}{path}", wait_until="networkidle")
                page.wait_for_timeout(350)

                if errors:
                    problems.append(f"{where}: console error: {errors[0][:160]}")

                txt = page.evaluate(
                    "document.querySelector('#synth-view, .synth-view, main, body')"
                    ".innerText")
                if len(txt.strip()) < 120:
                    problems.append(f"{where}: rendered {len(txt.strip())} chars -- "
                                    "effectively blank")
                for sel in sels:
                    if page.evaluate(f"document.querySelectorAll({sel!r}).length") == 0:
                        problems.append(f"{where}: no element matches {sel}")
                for m in musts:
                    if m.lower() not in txt.lower():
                        problems.append(f"{where}: the copy {m!r} never reached "
                                        "the page")
                for bad in UNPARSED:
                    if bad in txt:
                        problems.append(f"{where}: unparsed {bad} leaked as text")
                notes.append(f"{where}: {len(txt.strip())} chars")

            # An open liveblog has a WINDOW, not unbounded growth: the entry
            # count stays put and the copy inside it moves. Assert on the copy.
            page.goto(f"{base}#synth://fixture.news/live/lb1", wait_until="networkidle")
            page.wait_for_timeout(300)
            before = page.evaluate("document.querySelector('.news-entries').innerText")
            page.evaluate(f"SYNTH.live.setNow(Date.now() + {6 * HOUR})")
            page.goto(f"{base}#synth://fixture.news/", wait_until="networkidle")
            page.goto(f"{base}#synth://fixture.news/live/lb1", wait_until="networkidle")
            page.wait_for_timeout(300)
            after = page.evaluate("document.querySelector('.news-entries').innerText")
            count = page.evaluate("document.querySelectorAll('.news-entry').length")

            if before == after:
                problems.append("an OPEN liveblog filed nothing in six hours; the "
                                "desk has stopped and the LIVE dot is a lie")
            else:
                notes.append(f"open liveblog: {count} entries, copy moves with the clock")

            # The stream tops the blog up. It must not push the authored copy out.
            for keep in ("Outage reported at Depot and Quarry", "County confirms crews"):
                if keep not in after:
                    problems.append(f"the authored entry {keep!r} was pushed out "
                                    "by the stream")

            # ...and a closed one is a record, not a feed.
            page.goto(f"{base}#synth://fixture.news/live/lb2", wait_until="networkidle")
            page.wait_for_timeout(300)
            closed = page.evaluate("document.querySelectorAll('.news-entry').length")
            if closed > 1:
                problems.append(f"a closed liveblog grew to {closed} entries; "
                                "`open: false` is not honoured")
            else:
                notes.append("closed liveblog stays closed")

            browser.close()
        srv.shutdown()
    finally:
        shutil.rmtree(work, ignore_errors=True)

    for n in notes:
        print("  .", n)
    if problems:
        print("\nFAIL")
        for p in problems:
            print("  x", p)
        return 1
    print(f"\nOK: {len(CASES)} routes across wire, newsletter, chat and the "
          "three news modes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
