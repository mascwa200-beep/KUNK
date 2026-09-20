#!/usr/bin/env python3
"""Check that the APK contains everything the site actually asks for.

There is no emulator in CI and none in the sandbox this was built in, so the
app cannot be booted here. That leaves a gap: the APK can be perfectly signed,
correctly structured, and still show a broken page because one file the page
fetches was never staged into assets/.

This closes most of that gap without a device, and does it without being
circular. Comparing the staged assets against the copy list in build.sh would
prove nothing -- both come from the same loop. Instead this drives the real
site in a real browser, records every URL the page requests, and asserts each
one exists inside the APK. If the page needs it, the app has it.

What it still cannot tell you: whether MainActivity's interception actually
serves those bytes on a device. That needs hardware.

Usage:
  python3 .github/scripts/synthnet_apk_check.py --apk synthnet/android/synthnet.apk --root synthnet
"""

import argparse
import glob
import os
import pathlib
import re
import socket
import sys
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Paths the browser requests that are never app assets.
IGNORE = {"/favicon.ico", "/sw.js"}


def free_port() -> int:
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
        root = pathlib.Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"))
        found = sorted(glob.glob(str(root / "chromium-*/chrome-linux/chrome"))) + \
                sorted(glob.glob(str(root / "chromium_headless_shell-*/chrome-linux/headless_shell")))
        if not found:
            raise first
        print(f"note: falling back to {found[-1]}")
        return pw.chromium.launch(executable_path=found[-1])


_LOADMAP_ENTRY = re.compile(
    r"\w+\s*:\s*\{\s*js\s*:\s*'([^']+)'\s*,\s*css\s*:\s*'([^']+)'\s*\}")


def loadmap_paths(root: pathlib.Path) -> set:
    """Every file app/render.js may fetch on demand, read from the one table
    that decides it. Empty would silently assert nothing, so that is a
    failure rather than a pass."""
    text = (root / "app" / "loadmap.js").read_text(encoding="utf-8")
    out = set()
    for js, css in _LOADMAP_ENTRY.findall(text):
        out.add(js)
        out.add(css)
    if not out:
        raise SystemExit("FAIL: app/loadmap.js parsed to zero entries -- this "
                         "check would assert nothing")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", default="synthnet/android/synthnet.apk")
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()

    apk_path = pathlib.Path(args.apk)
    root = pathlib.Path(args.root).resolve()
    if not apk_path.is_file():
        print(f"FAIL: {apk_path} does not exist. Run android/build.sh first.")
        return 1

    with zipfile.ZipFile(apk_path) as z:
        names = z.namelist()
    assets = {n[len("assets/"):] for n in names if n.startswith("assets/") and not n.endswith("/")}

    problems = []

    # Structural checks that do not need a browser.
    if "classes.dex" not in names:
        problems.append("APK contains no classes.dex -- the app has no code")
    if "AndroidManifest.xml" not in names:
        problems.append("APK contains no AndroidManifest.xml")
    if not any(n.startswith("META-INF/") and n.endswith((".RSA", ".SF", ".DSA")) for n in names) \
            and not any("SIGNATURE" in n.upper() for n in names):
        # v2/v3 signatures live outside the zip entries, so this is advisory
        # only; apksigner verify in build.sh is the real check.
        pass
    if not assets:
        problems.append("APK contains no assets/ at all")

    # Everything app/render.js can fetch at navigation time, from the table
    # in app/loadmap.js.
    #
    # The browser drive below records what the page ASKS FOR, and it opens
    # one site of eight types. That covered every renderer while index.html
    # carried all twenty of them; it stopped covering the other twelve the
    # moment they became on-demand, because nothing in the drive opens a
    # newsletter or a dash. The check would have gone blind rather than red
    # -- a green run meaning "the eight types we happened to visit are in
    # the APK" while reading like "everything is".
    #
    # So the table is asserted directly. The drive stays, because it proves
    # the loading path itself works, which a file listing cannot.
    for rel in sorted(loadmap_paths(root)):
        if rel not in assets:
            problems.append(
                f"app/loadmap.js needs {rel!r} but it is not in the APK's "
                "assets/ -- that site type cannot render on the phone")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: playwright not installed")
        return 1

    port = free_port()
    handler = lambda *a, **k: Quiet(*a, directory=str(root), **k)  # noqa: E731
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}/index.html"

    requested = set()
    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.on("request", lambda r: requested.add(r.url))

            # The home page, one page of every site type, and a search: between
            # them these pull every stylesheet, every renderer and both
            # generated JSON files.
            page.goto(base, wait_until="networkidle")
            page.wait_for_timeout(200)
            for frag in [
                "synth://boards.gridfall.net/topic/1",
                "synth://pulse.gridfall.net/",
                "synth://kestrel-journal.net/",
                "synth://verityledger.com/",
                "synth://wiki.gridfall.net/",
                "synth://clipvault.tv/",
                "synth://stargazers.verity.net/",
                "synth://search.verity.net/?q=substation",
            ]:
                page.goto(f"{base}#{frag}", wait_until="networkidle")
                page.wait_for_timeout(150)
            browser.close()
    finally:
        httpd.shutdown()

    prefix = f"http://127.0.0.1:{port}/"
    paths = set()
    for url in requested:
        if not url.startswith(prefix):
            problems.append(f"page requested an off-origin URL: {url}")
            continue
        p = "/" + url[len(prefix):].split("?")[0].split("#")[0]
        if p in IGNORE:
            continue
        paths.add(p.lstrip("/") or "index.html")

    missing = sorted(p for p in paths if p not in assets)
    for m in missing:
        problems.append(f"the page fetches {m!r} but it is not in the APK's assets/")

    print(f"apk            {apk_path} ({apk_path.stat().st_size} bytes)")
    print(f"assets in apk  {len(assets)}")
    print(f"urls requested {len(paths)}")

    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1

    print(f"OK: every one of the {len(paths)} files the page requests is present in the APK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
