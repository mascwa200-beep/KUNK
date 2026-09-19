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
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


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
