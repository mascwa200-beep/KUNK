#!/usr/bin/env python3
"""Check the things that make synthnet something you use rather than read.

The render smoke test proves pages draw. It cannot prove that posting works,
that bot replies reference what you wrote, that fame progresses, or that a
content pack survives a round trip -- and those are the whole point of the
2026 build. Each of them fails silently: the page renders perfectly and simply
does nothing, which is exactly the failure mode that shipped twice on this
project already.

Everything runs against a real browser and the real code. No mocks.

Usage:
  python3 .github/scripts/synthnet_user_check.py [--root synthnet]
"""

import argparse
import glob
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# How patient the service-worker assertion is. Two reloads is the normal
# path -- the first triggers the update check and installs the new worker,
# the second is served by it -- so four is slack, not hope.
SW_RELOADS, SW_WAIT = 4, 2000


def version_in(path):
    m = re.search(r"CACHE_VERSION = '([^']*)'", path.read_text(encoding="utf-8"))
    return m.group(1) if m else None


class NoStore(SimpleHTTPRequestHandler):
    """Serves with caching off, so a stale response is the worker's doing."""

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        SimpleHTTPRequestHandler.end_headers(self)

# One row in every collection the app really writes, with the key shape the
# owning module uses. Nothing here is a collection only this check knows
# about -- each was found by reading the writer:
#
#   me, posts          me.js:32-33        alertstate     alerts.js:45
#   packs, mysites     packs.js:34-35     bots           bots.js:1857
#   visits, subs       alerts.js:43-44    shopcart       types/shop.js:54
#   assistant          types/assistant.js:215
#   streamsaved/votes/watch/autoplay      types/stream.js:114-117
#
# A collection added later and not added here is not a gap this check can
# see, which is the limit worth stating: it proves the button empties what
# it is given, not that the list of writers is complete. MIN_COLLECTIONS is
# what stops the seed silently shrinking.
WIPE_SEED = [
    ["me", "profile", {"handle": "wipecheck", "displayName": "Wipe Check"}],
    ["posts", "p-1", {"body": "a post"}],
    ["mysites", "mine.verity.net", {"domain": "mine.verity.net", "type": "page"}],
    ["packs", "pk-1", {"id": "pk-1", "name": "A Pack", "enabled": True}],
    ["visits", "boards.gridfall.net", {"at": 1790294400000, "feeds": []}],
    ["subs", "channel:c-1", {"kind": "channel", "id": "c-1", "level": "watching"}],
    ["alertstate", "seen", 1790294400000],
    ["alertstate", "seenfollowers", 12400],
    ["bots", "extension", {"topics": []}],
    ["shopcart", "shop.verity.net", [{"id": "p-1", "qty": 2}]],
    ["assistant", "ask.verity.net", [{"q": "hello", "a": "hello"}]],
    ["streamsaved", "now.clipvault.tv/vd-001", {"at": 1790294400000}],
    ["streamvotes", "now.clipvault.tv/vd-001", "up"],
    ["streamwatch", "now.clipvault.tv", 1],
    ["streamautoplay", "now.clipvault.tv", 0],
]
MIN_COLLECTIONS = 14


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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
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
    base = f"http://127.0.0.1:{port}/index.html"

    problems = []
    notes = []

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 360, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(f"{base}#synth://gridline.social/", wait_until="networkidle")
            page.wait_for_timeout(400)
            if errors:
                problems.append(f"console errors on load: {errors[0][:160]}")

            # --- 1. posting, and replies that reference the post ------------
            #
            # The assertion that matters: a reply must contain a fragment of
            # what was typed. Anything weaker passes even when the analyser is
            # returning nothing and every reply is generic filler.
            res = page.evaluate("""async () => {
              await SYNTH.store.ready();
              await SYNTH.me.reset();
              await SYNTH.me.signUp({handle: 'checker', name: 'Checker'});
              const out = [];
              const cases = [
                {text: 'the substation on Ellery is making that noise again', word: 'substation'},
                {text: 'does anyone know when the Halsey branch line closed', word: 'halsey'},
                {text: 'made $9000 last month working from home, ask me how', word: 'money'}
              ];
              for (const c of cases) {
                const post = await SYNTH.me.addPost('gridline.social', c.text);
                const reps = SYNTH.bots.repliesFor(post, {now: Date.now() + 3600000, followers: 12});
                out.push({
                  want: c.word,
                  topics: (post.analysis || {}).topics || [],
                  subject: (post.analysis || {}).subject,
                  count: reps.length,
                  bodies: reps.map(r => r.body),
                  kinds: reps.map(r => r.kind)
                });
              }
              return out;
            }""")

            for r in res:
                if r["count"] < 2:
                    problems.append(f"post about {r['want']!r} drew only {r['count']} replies")
                blob = " ".join(r["bodies"]).lower()
                # The money case asserts on the topic rather than the word,
                # since "money" never appears in the text -- that is the point.
                if r["want"] == "money":
                    if "money" not in r["topics"]:
                        problems.append("a post about earning $9000 from home did not register as money")
                elif r["want"] not in blob:
                    problems.append(f"no reply mentioned {r['want']!r} "
                                    f"(subject was {r['subject']!r})")
                if "human" not in r["kinds"]:
                    problems.append(f"no human reply at all under the {r['want']!r} post")
            notes.append(f"posting: {len(res)} posts, "
                         f"{sum(r['count'] for r in res)} replies, all referenced their post")

            # Different posts must produce different replies. Identical output
            # would mean the analysis is being ignored.
            blobs = [" ".join(r["bodies"]) for r in res]
            if len(set(blobs)) < len(blobs):
                problems.append("two different posts produced identical reply sets")

            # --- 2. replies accumulate over time ---------------------------
            grow = page.evaluate("""async () => {
              const post = SYNTH.me.posts()[0];
              const at = post.at;
              const n = (mins) => SYNTH.bots.repliesFor(post, {now: at + mins * 60000, followers: 12}).length;
              return {m1: n(1), h1: n(60), d1: n(1440)};
            }""")
            if not (grow["m1"] <= grow["h1"] <= grow["d1"]):
                problems.append(f"reply count does not grow with time: {grow}")
            notes.append(f"replies over time: {grow['m1']} at 1min, {grow['h1']} at 1h, {grow['d1']} at 1d")

            # --- 3. fame progresses and milestones fire --------------------
            fame = page.evaluate("""async () => {
              const tiers = [0, 100, 1000, 10000, 50000, 250000, 1000000].map(
                f => ({f, tier: SYNTH.fame.tierFor(f).name}));
              await SYNTH.me.update({followers: 60000});
              const ev = SYNTH.fame.events(SYNTH.me.profile()) || [];
              const ms = (SYNTH.fame.milestones(SYNTH.me.profile()) || []);
              return {tiers, events: ev.length, unlocked: ms.filter(m => m.unlocked).length,
                      titles: ev.map(e => e.title).slice(0, 6)};
            }""")
            if len(set(t["tier"] for t in fame["tiers"])) < 5:
                problems.append(f"fame tiers do not separate: {fame['tiers']}")
            if fame["events"] < 3:
                problems.append(f"at 60k followers only {fame['events']} world events fired")
            notes.append(f"fame: {fame['unlocked']} milestones unlocked at 60k, "
                         f"{fame['events']} events")

            # --- 4. pack round trip ----------------------------------------
            #
            # The headline feature. Author a site, export, wipe everything,
            # import, and assert the site is back AND reachable through the
            # registry -- not merely sitting in storage.
            trip = page.evaluate("""async () => {
              await SYNTH.packs.saveMySite({
                schema: 1, domain: 'roundtrip.verity.net', title: 'Round Trip',
                type: 'page', era: '2026', skin: 'plain-white',
                description: 'written by the check', links: [],
                data: {navLabel: 'x', pages: [{id: 'home', name: 'Home',
                  blocks: [{kind: 'heading', level: 1, text: 'It survived'}]}]}
              });
              const pack = SYNTH.packs.exportPack({id: 'rt', name: 'Round Trip Pack'});
              const json = JSON.stringify(pack);
              const before = SYNTH.data.list().filter(s => s.domain === 'roundtrip.verity.net').length;

              await SYNTH.store.wipe();
              SYNTH.data.invalidate();
              const afterWipe = SYNTH.data.list().filter(s => s.domain === 'roundtrip.verity.net').length;

              await SYNTH.packs.importText(json);
              const afterImport = SYNTH.data.list().filter(s => s.domain === 'roundtrip.verity.net').length;
              const site = await SYNTH.data.getSite('roundtrip.verity.net');
              return {before, afterWipe, afterImport, title: site && site.title,
                      packs: SYNTH.packs.list().length};
            }""")
            if trip["before"] != 1:
                problems.append("an authored site did not appear in the registry")
            if trip["afterWipe"] != 0:
                problems.append("wiping storage did not remove the authored site")
            if trip["afterImport"] != 1:
                problems.append("importing the exported pack did not restore the site")
            if trip["title"] != "Round Trip":
                problems.append(f"imported site did not load: title was {trip['title']!r}")
            notes.append("pack round trip: authored, exported, wiped, imported, reachable")

            # --- 5. a bad pack is rejected with a reason -------------------
            bad = page.evaluate("""async () => {
              const tries = [
                '{not json',
                JSON.stringify({pack: 99, id: 'x', name: 'x', sites: []}),
                JSON.stringify({pack: 1, id: 'y', name: 'y', sites: [
                  {domain: 'bad.verity.net', type: 'nonsense', data: {}}]})
              ];
              const out = [];
              for (const t of tries) {
                try { await SYNTH.packs.importText(t); out.push(null); }
                catch (e) { out.push(String(e.message).slice(0, 90)); }
              }
              return out;
            }""")
            for i, msg in enumerate(bad):
                if msg is None:
                    problems.append(f"bad pack #{i + 1} was accepted when it should have been rejected")
            notes.append("bad packs rejected: " + "; ".join(m for m in bad if m))

            # --- 6. posts survive a reload ---------------------------------
            page.evaluate("""async () => {
              await SYNTH.me.reset();
              await SYNTH.me.signUp({handle: 'persist'});
              await SYNTH.me.addPost('gridline.social', 'this should still be here after a reload');
            }""")
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(500)
            kept = page.evaluate("""async () => {
              await SYNTH.store.ready();
              const p = SYNTH.me.profile();
              return {handle: p && p.handle, posts: SYNTH.me.posts().length};
            }""")
            if kept["handle"] != "persist" or kept["posts"] < 1:
                problems.append(f"state did not survive a reload: {kept}")
            notes.append("persistence: account and post survived a reload")

            # --- 7. the Wipe BUTTON, not the store's own wipe --------------
            #
            # Section 4 above calls SYNTH.store.wipe(), which empties the
            # whole keyspace and has no call site anywhere in the app. The
            # button on the control panel calls control.js's wipeAll(), and
            # for as long as both existed that walked a hand-written list of
            # nineteen collection names: two were real, sixteen named nothing
            # at all, and eleven live collections were absent. Measured by
            # pressing it -- twelve of fourteen seeded rows survived, the
            # account among them, and usage() went 658 bytes to 567 while the
            # page said "Everything is gone."
            #
            # So this presses the control. A check that exercises a different
            # function from the one the button calls is not watching the
            # button.
            page.evaluate("(u) => SYNTH.engine.navigate(u, {push: false})",
                          "synth://control.verity.net/storage")
            page.wait_for_timeout(500)
            # Read back through store.get, not store.collections(). The first
            # draft of this seeded and counted through collections(), which is
            # the function the fix adds -- so against the code it was written
            # to catch it threw a TypeError and died before pressing the
            # button. An assertion that cannot survive the bug it is about
            # cannot report it.
            seeded = page.evaluate("""async (rows) => {
              for (const r of rows) { await SYNTH.store.put(r[0], r[1], r[2]); }
              const live = {};
              for (const r of rows) {
                if (SYNTH.store.get(r[0], r[1], null) !== null) { live[r[0]] = 1; }
              }
              return Object.keys(live).sort();
            }""", WIPE_SEED)
            if len(seeded) < MIN_COLLECTIONS:
                problems.append(
                    f"seeded {len(seeded)} collection(s), fewer than "
                    f"{MIN_COLLECTIONS} -- either store.collections() is not "
                    "reporting them or the seed has gone stale, and either "
                    "way the wipe below asserts nothing")
            pressed = page.evaluate("""() => {
              const root = document.querySelector('#synth-viewport');
              const card = Array.from(root.querySelectorAll('.cp-card-danger'))
                .find(c => /Wipe all stored data/.test(c.textContent));
              if (!card) { return 'no "Wipe all stored data" card on /storage'; }
              const btn = card.querySelector('.cp-btn-danger');
              if (!btn) { return 'the Wipe card has no button'; }
              btn.click();   // the control is a two-tap confirm chain
              btn.click();
              return null;
            }""")
            if pressed:
                problems.append(f"could not press the Wipe control: {pressed}")
            else:
                page.wait_for_timeout(1200)
                left = page.evaluate("""(rows) => {
                  const out = [];
                  for (const r of rows) {
                    if (SYNTH.store.get(r[0], r[1], null) !== null) {
                      out.push(r[0] + ':' + r[1]);
                    }
                  }
                  return out;
                }""", WIPE_SEED)
                if left:
                    problems.append(
                        f"'Wipe all stored data' left {len(left)} of "
                        f"{len(WIPE_SEED)} rows in place: " + ", ".join(left))
                else:
                    notes.append(
                        f"the Wipe button emptied all {len(seeded)} "
                        "collection(s), read back from the store")

            # --- 8. the two storage totals on one screen agree -------------
            #
            # The Summary reads store.usage(); the by-collection table summed
            # its own walk of that same hand-written list, counting only the
            # value and not the key. On one screen, three inches apart, they
            # read 658 B and 59 B.
            page.evaluate("""async (rows) => {
              for (const r of rows) { await SYNTH.store.put(r[0], r[1], r[2]); }
            }""", WIPE_SEED)
            page.evaluate("(u) => SYNTH.engine.navigate(u, {push: false})",
                          "synth://control.verity.net/storage")
            page.wait_for_timeout(600)
            # Both figures are read AS RENDERED. Comparing the table against
            # a live store.usage() call instead fails by 56 bytes, because
            # opening the control panel records a visit of its own after the
            # table has painted -- a race in the reading, not a fault in the
            # page.
            totals = page.evaluate("""() => {
              const root = document.querySelector('#synth-viewport');
              const keys = Array.from(root.querySelectorAll('.cp-rows-k'));
              const used = keys.find(k => /^Used$/.test((k.textContent || '').trim()));
              const table = Array.from(root.querySelectorAll('.cp-tr-total'))
                .map(n => (n.textContent || '').trim())[0] || '';
              return {
                summary: used && used.nextElementSibling
                  ? (used.nextElementSibling.textContent || '').trim() : null,
                table: table
              };
            }""")

            def bytes_in(text):
                m = re.search(r"([\d,]+(?:\.\d+)?)\s*(B|KB|MB)\b", text or "")
                if not m:
                    return None
                scale = {"B": 1, "KB": 1024, "MB": 1024 * 1024}[m.group(2)]
                return round(float(m.group(1).replace(",", "")) * scale)

            a, b = bytes_in(totals["summary"]), bytes_in(totals["table"])
            if a is None or b is None:
                problems.append(
                    "could not read both storage totals off the screen "
                    f"(summary {totals['summary']!r}, table {totals['table']!r}), "
                    "so they were not compared")
            elif a != b:
                problems.append(
                    "the storage screen states two different totals three "
                    f"inches apart: the summary says {totals['summary']!r} and "
                    f"the table under it adds up to {totals['table']!r}")
            else:
                notes.append(
                    f"both storage totals on one screen read {totals['summary']}")

            # --- 9. a returning browser gets the new build -----------------
            #
            # sw.js is cache-first with no revalidation and activate() only
            # drops caches whose key is not CACHE_VERSION, so the version IS
            # the invalidation. It was the literal 'synthnet-v1' from the
            # first commit of this project until it was generated, and
            # measured with the same harness below: four reloads over eight
            # seconds still served the old content while a fresh profile got
            # the new.
            #
            # Nothing else here can see it, because every other check starts
            # from a fresh profile -- the one state in which a stale cache
            # does not exist.
            #
            # Runs against a COPY of the tree, because it has to edit content
            # and rebuild, and a check must not write to the repository it is
            # checking.
            work = pathlib.Path(tempfile.mkdtemp(prefix="synthnet-sw-"))
            try:
                tree = work / "synthnet"
                shutil.copytree(root, tree,
                                ignore=shutil.ignore_patterns("dist", "android"))
                target = sorted(tree.glob("net/sites/*/site.json"))[0]
                first = version_in(tree / "sw.js")

                port2 = free_port()
                srv2 = ThreadingHTTPServer(
                    ("127.0.0.1", port2),
                    lambda *a, **k: NoStore(*a, directory=str(tree), **k))
                threading.Thread(target=srv2.serve_forever, daemon=True).start()
                try:
                    ctx = browser.new_context()
                    sw = ctx.new_page()
                    sw.goto(f"http://127.0.0.1:{port2}/index.html",
                            wait_until="networkidle")
                    sw.wait_for_function(
                        "() => navigator.serviceWorker && "
                        "navigator.serviceWorker.controller", timeout=20000)
                    rel = str(target.relative_to(tree)).replace("\\", "/")
                    read = ("async (p) => (await (await fetch('./' + p))"
                            ".json()).title")
                    was = sw.evaluate(read, rel)

                    doc = json.loads(target.read_text())
                    doc["title"] = "edited between visits"
                    target.write_text(json.dumps(doc))
                    subprocess.run(
                        [sys.executable, str(tree / "tools/build.py"), "--quiet"],
                        capture_output=True)
                    second = version_in(tree / "sw.js")

                    if second == first:
                        problems.append(
                            "the content changed and CACHE_VERSION did not "
                            f"move ({first}) -- build.py is no longer deriving "
                            "it, so no released fix will ever reach a browser "
                            "that has opened this app once")
                    else:
                        got = None
                        for _ in range(SW_RELOADS):
                            sw.reload(wait_until="networkidle")
                            sw.wait_for_timeout(SW_WAIT)
                            got = sw.evaluate(read, rel)
                            if got == "edited between visits":
                                break
                        if got != "edited between visits":
                            problems.append(
                                f"after {SW_RELOADS} reloads over "
                                f"{SW_RELOADS * SW_WAIT // 1000}s a returning "
                                f"browser was still served {got!r} instead of "
                                f"the rebuilt content, with CACHE_VERSION "
                                f"{first} -> {second}")
                        else:
                            notes.append(
                                f"a returning browser picked up the rebuild "
                                f"({was!r} -> {got!r}), CACHE_VERSION "
                                f"{first} -> {second}")
                finally:
                    srv2.shutdown()
            finally:
                shutil.rmtree(work, ignore_errors=True)

            browser.close()
    finally:
        srv.shutdown()

    for n in notes:
        print(f"  ok  {n}")
    if problems:
        print(f"\nFAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("\nOK: posting, content-aware replies, fame, pack round trip and persistence all work.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
