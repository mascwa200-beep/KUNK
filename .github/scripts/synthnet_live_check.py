#!/usr/bin/env python3
"""Check that the network actually moves.

The whole premise of this project is a wall clock: nothing is stored, nothing
is random, and what you see is a pure function of the time. That premise fails
in two directions and neither shows up in any other check.

  * It can fail *stopped*: the page paints once and freezes, so the net moves
    between visits and is a photograph during one. That was literally true
    here until app/tick.js existed -- there was not one setInterval in the
    project -- and every test stayed green, because a frozen page renders
    perfectly.

  * It can fail *flat*: everything moves, but at exactly the same rate at 4am
    on a Tuesday as at 9pm on a Saturday, which reads as a metronome rather
    than a place.

So this pins the clock with SYNTH.live.setNow(), which exists for exactly
this, and asserts on what changes and what does not.

Usage:  python3 .github/scripts/synthnet_live_check.py [--root synthnet]
"""

import argparse
import glob
import os
import pathlib
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HOUR = 3600000
DAY = 86400000


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
        root = pathlib.Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"))
        found = sorted(glob.glob(str(root / "chromium-*/chrome-linux/chrome"))) + \
                sorted(glob.glob(str(root / "chromium_headless_shell-*/chrome-linux/headless_shell")))
        if not found:
            raise first
        print(f"note: falling back to {found[-1]}")
        return pw.chromium.launch(executable_path=found[-1])


def main():
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

    problems, notes = [], []

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 360, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

            # A forum: it streams, it has an online bar, and it is busy.
            page.goto(f"{base}#synth://boards.gridfall.net/", wait_until="networkidle")
            page.wait_for_timeout(500)
            if errors:
                problems.append(f"console error on load: {errors[0][:200]}")

            # --- 1. the heartbeat exists and is running --------------------
            if not page.evaluate("!!(window.SYNTH && SYNTH.tick && SYNTH.tick.running())"):
                problems.append("the heartbeat is not running -- the page is frozen "
                                "the moment it paints")
            else:
                notes.append(f"heartbeat running at "
                             f"{page.evaluate('SYNTH.tick.interval') // 1000}s")

            # --- 2. the page records what it is watching -------------------
            rows = page.evaluate("SYNTH.live.ledgerRows()")
            if not rows:
                problems.append("a forum front page consulted no live stream; "
                                "nothing on it can ever be new")
            else:
                notes.append("watching " + ", ".join(
                    f"{r['key']}@{r['interval']}m" for r in rows[:3]))

            # --- 3. widgets repaint when the clock moves -------------------
            marked = page.evaluate(
                "document.querySelectorAll('[data-lv-online],[data-lv-ticker],"
                "[data-lv-counter],[data-lv-ago]').length")
            if marked < 1:
                problems.append("no element on the page is marked for repainting; "
                                "the heartbeat has nothing to do")

            before = page.evaluate(
                "() => { const n = document.querySelector('[data-lv-online]');"
                " return n ? n.innerText : null; }")
            page.evaluate(f"SYNTH.live.setNow(Date.now() + {6 * HOUR})")
            page.evaluate("SYNTH.tick.beat()")
            after = page.evaluate(
                "() => { const n = document.querySelector('[data-lv-online]');"
                " return n ? n.innerText : null; }")
            if before is None:
                problems.append("no online counter on a forum front page")
            elif before == after:
                problems.append("the online counter reads the same six hours later; "
                                "the heartbeat is not repainting it")
            else:
                notes.append("online counter repaints in place when the clock moves")

            # --- 4. arrivals are counted and offered, not injected ---------
            pill = page.evaluate(
                "() => { const p = document.querySelector('.lv-pill');"
                " return p ? p.innerText.replace(/\\s+/g,' ').trim() : null; }")
            n = page.evaluate("SYNTH.live.arrivals()")
            if not pill:
                problems.append(f"six hours passed, {n} things arrived, and the page "
                                f"said nothing")
            elif n < 1:
                problems.append("a pill appeared announcing nothing")
            else:
                notes.append(f"{n} arrivals in six hours, announced as {pill!r}")

            # Clicking must actually reload rather than just dismiss.
            page.evaluate("() => { const p = document.querySelector('.lv-pill');"
                          " if (p) p.click(); }")
            page.wait_for_timeout(400)
            if page.evaluate("!!document.querySelector('.lv-pill')"):
                problems.append("the pill survived being clicked")
            elif page.evaluate("SYNTH.live.arrivals()") != 0:
                problems.append("clicking the pill did not re-render: the page is "
                                "still behind the clock")
            else:
                notes.append("clicking it reloads and the count resets")

            # --- 5. it does not repaint under your hands -------------------
            page.evaluate(f"SYNTH.live.setNow(Date.now() + {12 * HOUR})")
            page.evaluate("""() => {
              const i = document.createElement('input');
              document.getElementById('synth-viewport').appendChild(i);
              i.focus();
            }""")
            page.evaluate("SYNTH.tick.beat()")
            if page.evaluate("!!document.querySelector('.lv-pill')"):
                problems.append("the page repainted while the caret was in a text "
                                "field -- this is how you lose what someone typed")
            else:
                notes.append("suppressed while typing")

            # --- 6. the clock genuinely changes the page -------------------
            #
            # Four moments, four different front pages. Identical output at
            # +1 day would mean the wall clock is decorative.
            seen = page.evaluate("""async (base) => {
              const out = [];
              for (const offset of [0, 3600000, 86400000, 604800000]) {
                SYNTH.live.setNow(Date.now() + offset);
                await SYNTH.engine.navigate('synth://now.verityledger.com/', {push: false});
                await new Promise(r => setTimeout(r, 250));
                out.push(document.getElementById('synth-viewport').innerText);
              }
              return out;
            }""", base)
            labels = ["now", "+1h", "+1d", "+1w"]
            for i in range(1, len(seen)):
                if seen[i] == seen[0]:
                    problems.append(f"the news front page is byte-identical at "
                                    f"{labels[i]}; the wall clock is decorative")
            if len(set(seen)) == len(seen):
                notes.append("four different front pages at now / +1h / +1d / +1w")

            # --- 7. rhythm: 4am is not 9pm ---------------------------------
            rhythm = page.evaluate("""() => {
              // A fixed Tuesday and Saturday so this does not depend on when
              // CI happens to run.
              const tue = Date.UTC(2026, 8, 22), sat = Date.UTC(2026, 8, 26);
              const at = (base, h) => {
                SYNTH.live.setNow(base + h * 3600000);
                const rows = SYNTH.live.stream('rhythm-probe', 'socialPosts', 4, 10);
                const span = rows.length > 1
                  ? Math.round((rows[0].at - rows[rows.length - 1].at) / 60000) : 0;
                return {busy: SYNTH.live.busyness(), span: span, n: rows.length};
              };
              return {
                night:   at(tue, 4),
                midday:  at(tue, 13),
                evening: at(tue, 21),
                satEve:  at(sat, 21)
              };
            }""")
            night, evening = rhythm["night"], rhythm["evening"]
            if night["n"] < 10 or evening["n"] < 10:
                problems.append(f"a quiet hour emptied the feed rather than "
                                f"stretching it: {rhythm}")
            if night["span"] <= evening["span"]:
                problems.append(
                    f"4am and 9pm look the same: ten posts span "
                    f"{night['span']}min at night and {evening['span']}min in the "
                    f"evening. Without rhythm the net reads as a metronome.")
            else:
                notes.append(f"rhythm: ten posts span {night['span']}min at 4am vs "
                             f"{evening['span']}min at 9pm "
                             f"(busyness {night['busy']:.2f} vs {evening['busy']:.2f})")

            # --- 8. determinism still holds --------------------------------
            #
            # All of the above is worthless if the page also changes when the
            # clock does NOT move. That would be Math.random leaking in, and it
            # reads as broken rather than alive.
            same = page.evaluate("""async () => {
              SYNTH.live.setNow(Date.UTC(2026, 8, 22, 13, 0, 0));
              const draw = async () => {
                await SYNTH.engine.navigate('synth://gridline.social/', {push: false});
                await new Promise(r => setTimeout(r, 200));
                return document.getElementById('synth-viewport').innerText;
              };
              const a = await draw();
              const b = await draw();
              return a === b;
            }""")
            if not same:
                problems.append("the same page drawn twice at the same instant "
                                "differs -- something is using Math.random, and the "
                                "page will appear to flicker rather than live")
            else:
                notes.append("still deterministic: same instant, same page")

            # --- 9. what happened while you were gone ----------------------
            #
            # The net moving is only half of it. The other half is being told
            # that it moved, which needs a real last-visit rather than a
            # sliding window -- a bug this very check caught: the fallback
            # "seen" time was recomputed on every call, so going away for
            # three days reported the last twenty-four hours of them.
            gone = page.evaluate("""async () => {
              await SYNTH.store.ready();
              await SYNTH.store.wipe();
              SYNTH.data.invalidate();
              SYNTH.live.setNow(null);
              await SYNTH.me.signUp({handle: 'awaycheck', name: 'Away Check'});

              const nav = async (u) => {
                await SYNTH.engine.navigate(u);
                await new Promise(r => setTimeout(r, 180));
              };
              await nav('synth://boards.gridfall.net/');
              await nav('synth://now.verityledger.com/');
              await nav('synth://gridline.social/');
              await SYNTH.me.addPost('gridline.social',
                'the substation on Ellery is making that noise again');

              const visits = SYNTH.alerts.allVisits();
              const recorded = Object.keys(visits).map(d => ({
                domain: d, feeds: (visits[d].feeds || []).length
              }));

              const t0 = Date.now();
              const at = (days) => {
                SYNTH.live.setNow(t0 + days * 86400000);
                const u = SYNTH.alerts.unreadByDomain();
                const d = SYNTH.alerts.digest();
                return {
                  unread: Object.values(u).reduce((a, b) => a + b, 0),
                  sites: Object.keys(u).length,
                  mentions: d.mentions.length,
                  awayHours: Math.round(d.away / 3600000),
                  badge: SYNTH.alerts.badge()
                };
              };
              const out = {recorded: recorded, h1: at(1 / 24), d1: at(1), d3: at(3)};
              // Leave the clock three days out, so the Feeds page rendered
              // next is the one someone coming back would actually see.
              SYNTH.live.setNow(t0 + 3 * 86400000);
              return out;
            }""")

            missing = [r["domain"] for r in gone["recorded"] if r["feeds"] < 1]
            if missing:
                problems.append(
                    f"visiting {missing} recorded no live feeds, so nothing on "
                    f"those sites can ever count as unread")
            if len(gone["recorded"]) < 3:
                problems.append(f"only {len(gone['recorded'])} visits recorded of 3")

            if not (gone["h1"]["unread"] < gone["d1"]["unread"] < gone["d3"]["unread"]):
                problems.append(
                    f"unread does not grow with time away: "
                    f"{gone['h1']['unread']} after an hour, "
                    f"{gone['d1']['unread']} after a day, "
                    f"{gone['d3']['unread']} after three")
            else:
                notes.append(f"unread grows with absence: {gone['h1']['unread']} / "
                             f"{gone['d1']['unread']} / {gone['d3']['unread']} "
                             f"after 1h / 1d / 3d across {gone['d3']['sites']} sites")

            if gone["d3"]["awayHours"] < 60:
                problems.append(
                    f"after three days away the digest thinks it was "
                    f"{gone['d3']['awayHours']} hours. The 'since you last "
                    f"looked' window is sliding with the clock instead of "
                    f"staying put.")
            if gone["d3"]["mentions"] < 1:
                problems.append("three days and a post, and nothing was addressed "
                                "to you -- replies and messages are not reaching "
                                "the digest")
            else:
                notes.append(f"{gone['d3']['mentions']} things addressed to you "
                             f"after three days away")

            # Count versus dot: a number only for things addressed to you.
            badge = gone["d3"]["badge"]
            if badge["count"] != gone["d3"]["mentions"]:
                problems.append(
                    f"the badge counts {badge['count']} but {gone['d3']['mentions']} "
                    f"things were addressed to you. A badge that counts ambient "
                    f"activity says nothing except that you should feel behind.")
            elif not badge["dot"]:
                problems.append("sites moved on and the badge showed nothing at all")
            else:
                notes.append(f"badge: {badge['count']} counted, dot for the rest")

            # --- 10. the Feeds page renders and fits a phone ---------------
            page.evaluate("SYNTH.engine.navigate('synth://feeds.verity.net/')")
            page.wait_for_timeout(400)
            text = page.inner_text("#synth-viewport")
            if len(text.strip()) < 80:
                problems.append(f"the Feeds page rendered {len(text.strip())} chars")
            for marker in ("[object Object]", "undefined", "NaN"):
                if marker in text:
                    problems.append(f"Feeds page shows {marker!r}")
            overflow = page.evaluate(
                "() => { const v = document.getElementById('synth-viewport');"
                " return v.scrollWidth - v.clientWidth; }")
            if overflow > 1:
                problems.append(f"Feeds page overflows by {overflow}px at 360 wide")
            else:
                notes.append("Feeds page renders and fits a 360px phone")

            for tab in ("mentions", "replies", "sites"):
                errors.clear()
                page.evaluate(
                    f"SYNTH.engine.navigate('synth://feeds.verity.net/?t={tab}')")
                page.wait_for_timeout(250)
                if errors:
                    problems.append(f"Feeds '{tab}' tab: {errors[0][:160]}")
                elif len(page.inner_text("#synth-viewport").strip()) < 60:
                    problems.append(f"Feeds '{tab}' tab rendered almost nothing")

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
    print("\nOK: the network moves while you look at it, moves more in the "
          "evening than at 4am, and is still the same page twice at the same "
          "instant.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
