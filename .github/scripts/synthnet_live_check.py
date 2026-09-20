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
import datetime
import glob
import os
import pathlib
import re
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

            # --- 8b. the grammar has not collapsed -------------------------
            #
            # Most of what arrives on any feed is composed rather than
            # written, and the failure mode is silent in both directions: a
            # broken grammar falls back to the written pool and the page
            # looks fine but wraps within ten minutes, and a working one can
            # still hand you the same sentence twice on one screen, which is
            # the single thing that gives a composed feed away.
            #
            # This already caught the grammar being switched off entirely:
            # the "is this pool virtual" check duck-typed on .at(), and both
            # arrays and strings have had .at() since ES2022, so it matched
            # everything and the composed half never ran.
            gram = page.evaluate("""() => {
              if (!window.SYNTH || !SYNTH.grammar) return null;
              const bodies = new Set();
              for (let i = 0; i < 3000; i++) {
                const made = SYNTH.grammar.make('socialPosts', i);
                if (made && made.body) bodies.add(made.body);
              }
              SYNTH.live.setNow(Date.UTC(2026, 8, 22, 20, 0, 0));
              const rows = SYNTH.live.stream('probe.social', 'socialPosts', 4, 14);
              const pool = SYNTH.live.virtual(
                SYNTH.live.pool('socialPosts'), 'socialPosts');
              return {
                distinct: bodies.size,
                screen: rows.length,
                screenDistinct: new Set(rows.map(r => (r.item.body || '').slice(0, 40))).size,
                composed: rows.filter(r => r.item && r.item.tplId).length,
                virtual: !!pool.isVirtual,
                written: pool.written || 0,
                length: pool.length || 0
              };
            }""")
            if gram is None:
                problems.append("the grammar did not load at all")
            else:
                if not gram["virtual"]:
                    problems.append(
                        "the feed pool is not virtual, so every post comes from "
                        "the written pool and the feed wraps within ten minutes")
                if gram["distinct"] < 1500:
                    problems.append(
                        f"only {gram['distinct']} distinct posts in 3000 draws; "
                        f"the grammar has collapsed to a handful of templates")
                if gram["composed"] < 4:
                    problems.append(
                        f"only {gram['composed']} of {gram['screen']} posts on a "
                        f"screen were composed; the grammar is barely running")
                if gram["screenDistinct"] < gram["screen"]:
                    problems.append(
                        f"{gram['screen'] - gram['screenDistinct']} repeated "
                        f"opening(s) on one screen of {gram['screen']}. Two posts "
                        f"that start the same way is what gives it away.")
                if not problems:
                    notes.append(
                        f"grammar: {gram['distinct']} distinct in 3000 draws, "
                        f"{gram['written']} written entries serving as "
                        f"{gram['length']}, no repeats on a screen of "
                        f"{gram['screen']}")
            page.evaluate("SYNTH.live.setNow(null)")

            # --- 8c. sweep the clock, so every pool entry gets drawn -------
            #
            # The render test loads every page once, at whatever moment it
            # runs. A feed shows a handful of its pool at any one moment, so
            # that test has only ever seen a sample -- and for eighteen
            # months the sample was a biased handful of the same entries,
            # because hash32's low bits were skewed. Fixing the hash made
            # unreachable content reachable and immediately turned up an ad
            # whose body had never been parsed.
            #
            # So: walk the clock across many slots on the pages that stream,
            # and apply the same assertions at each stop. This is coverage,
            # not a new kind of test, which on this project has consistently
            # been where the bugs were.
            LEAK = ["[url=", "[b]", "[/b]", "[i]", "[/i]", "[quote", "[img:",
                    "[list]", "[code]", "[object Object]", "undefined undefined"]
            sweep_pages = ["gridline.social", "now.verityledger.com",
                           "boards.gridfall.net", "dash.verity.net",
                           "now.clipvault.tv", "mail.verity.net",
                           "shopwell.store", "62chan.org"]
            # A feed can leak no markup, throw nothing, and still read as a
            # machine because the same row is on screen twice. live.stream()
            # re-rolls a repeat, but the re-roll was gated on the pool being
            # a composed one, so every renderer that passes a written array
            # got no dedup at all: 15% of all visible rows network-wide were
            # duplicates of another row on the same screen, three pairs out
            # of eight on a forum front page. Nothing failed. It just looked
            # generated.
            #
            # 5% is the line. Some repetition is real -- a bot does repost,
            # and a genuinely wrapped pool should show it -- so this is not
            # zero, it is "not the mechanism showing through".
            ROWS = [".lv-recent-row", ".news-entry", ".wr-line", ".ag-row",
                    ".feed-item", ".tl-post", ".q-row", ".bd-post", ".cd-msg",
                    ".news-index-row", ".sh-card"]
            DUPE_PROBE = """(sels) => {
              let n = 0, d = 0;
              for (const s of sels) {
                const t = [...document.querySelectorAll(s)]
                  .map(x => (x.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 70))
                  .filter(x => x.length > 12);
                if (t.length < 3) continue;
                n += t.length; d += t.length - new Set(t).size;
              }
              return [n, d];
            }"""
            seen_rows = dupe_rows = 0
            dupe_worst = []

            base_ms = page.evaluate("Date.now()")
            stops = 0
            leaks = []
            for domain in sweep_pages:
                for step in range(0, 26):
                    # Four hours apart: far enough that every stream has
                    # turned over several times, and cheap enough to do
                    # two hundred of them.
                    at = base_ms + step * 4 * HOUR
                    page.evaluate(f"SYNTH.live.setNow({at})")
                    page.evaluate(
                        f"SYNTH.engine.navigate('synth://{domain}/', {{push: false}})")
                    page.wait_for_timeout(60)
                    text = page.inner_text("#synth-viewport")
                    stops += 1
                    for marker in LEAK:
                        if marker in text:
                            idx = text.index(marker)
                            leaks.append(
                                f"synth://{domain}/ at +{step * 4}h leaked "
                                f"{marker!r}: ...{text[max(0, idx - 40):idx + 60]!r}")
                            break

                    n, d = page.evaluate(DUPE_PROBE, ROWS)
                    seen_rows += n
                    dupe_rows += d
                    if d:
                        dupe_worst.append((d, n, domain, step * 4))
            if errors:
                problems.append(f"console error during the clock sweep: "
                                f"{errors[0][:200]}")
            if leaks:
                for leak in leaks[:6]:
                    problems.append(leak)
            else:
                notes.append(f"clock sweep: {stops} page loads across four days "
                             f"on {len(sweep_pages)} streaming sites, no leaked "
                             f"markup")

            pct = 100.0 * dupe_rows / max(1, seen_rows)
            if pct > 5.0:
                dupe_worst.sort(reverse=True)
                problems.append(
                    f"{dupe_rows} of {seen_rows} visible rows across the sweep "
                    f"({pct:.1f}%) repeat another row on the same screen. Over "
                    f"5% the mechanism is showing. Worst: " + ", ".join(
                        f"{d}/{n} on {dom} at +{h}h"
                        for d, n, dom, h in dupe_worst[:3]))
            else:
                notes.append(f"repeated rows: {dupe_rows}/{seen_rows} "
                             f"({pct:.1f}%) across the sweep")

            page.evaluate("SYNTH.live.setNow(null)")

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

            # --- 9b. the same thing, with no account -----------------------
            #
            # Everything above signs up first, so profile.joined always
            # existed and the no-account path was never once walked. You can
            # read this entire network without making an account and most
            # people will, and on that path the away window fell through to
            # a "now minus a day" fallback that is recomputed per call -- so
            # it slid, and three days away reported twenty-four hours. Same
            # bug as the one section 9 exists to catch, arriving through the
            # door section 9 does not use.
            anon = page.evaluate("""async () => {
              await SYNTH.store.ready();
              await SYNTH.store.wipe();
              SYNTH.data.invalidate();
              SYNTH.live.setNow(null);
              // deliberately NO signUp

              const nav = async (u) => {
                await SYNTH.engine.navigate(u);
                await new Promise(r => setTimeout(r, 180));
              };
              await nav('synth://boards.gridfall.net/');
              await nav('synth://gridline.social/');

              const t0 = Date.now();
              const away = (days) => {
                SYNTH.live.setNow(t0 + days * 86400000);
                return Math.round(SYNTH.alerts.digest().away / 3600000);
              };
              const out = {h1: away(1 / 24), d3: away(3), w3: away(21)};
              SYNTH.live.setNow(t0 + 3 * 86400000);
              return out;
            }""")

            if anon["d3"] < 60 or anon["w3"] < 480:
                problems.append(
                    f"with no account the away window does not track the clock: "
                    f"{anon['h1']}h / {anon['d3']}h / {anon['w3']}h reported after "
                    f"1h / 3d / 3w away. It is sliding instead of staying put, so "
                    f"someone who never signed up is told they have been gone a "
                    f"day no matter how long it has been.")
            else:
                notes.append(f"with no account: {anon['h1']}h / {anon['d3']}h / "
                             f"{anon['w3']}h away after 1h / 3d / 3w")

            # And the sentence built from it has to be English. spell() says
            # "an hour" as well as "3 days", and pasting either after a
            # definite article gives "In the an hour since you last checked".
            page.evaluate("SYNTH.live.setNow(Date.now() + 3600000)")
            page.evaluate(
                "SYNTH.engine.navigate('synth://feeds.verity.net/', {push: false})")
            page.wait_for_timeout(400)
            line = page.evaluate(
                "() => { const n = document.querySelector('.fd-summary');"
                " return n ? n.innerText.replace(/\\s+/g, ' ').trim() : ''; }")
            if re.search(r"\bthe an?\b", line):
                problems.append(f"the digest summary is not English: {line[:90]!r}")
            elif not line:
                problems.append("the Feeds page rendered no summary line at all")
            else:
                notes.append(f"digest reads: {line[:64]!r}")
            page.evaluate("SYNTH.live.setNow(null)")

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

            # --- 11. one event, many sites, getting worse -----------------
            #
            # Propagation is the feature where a page rendering perfectly
            # proves the least. Five sites can each show a beautiful
            # substation story and be five unrelated texts -- which is
            # exactly what this network did before the story engine, and
            # every check stayed green through it.
            #
            # So nothing below asserts the absence of an error. It asserts
            # that the SAME story, carrying the same id, arrives in chain
            # order, is intact at hop 0, and is wrong in a documented way by
            # the end. The window is pinned to EPOCH rather than to today,
            # so this says the same thing in CI next March as it does now.
            page.evaluate("SYNTH.live.setNow(null)")
            prop = page.evaluate("""() => {
              const L = SYNTH.live, EP = L.EPOCH, SLOT = 360 * 60000;
              const rows = SYNTH.data.list() || [];
              const typeOf = {}, archive = new Set();
              rows.forEach(r => {
                const d = String(r.domain).toLowerCase();
                typeOf[d] = r.type;
                if (String(r.era || '').indexOf('2026') === -1) archive.add(d);
              });

              // Every distinct story in the first 400 slots (~100 days).
              const seen = new Map();
              for (let k = 0; k < 400; k++) {
                L.storiesLive(EP + k * SLOT + 60000).forEach(s => {
                  if (!seen.has(s.id)) seen.set(s.id, s);
                });
              }
              const all = Array.from(seen.values());

              // An archive site cannot carry this morning's story. Checked
              // over every chain in the window, not at one instant.
              const leaked = [];
              all.forEach(s => s.chain.forEach(h => {
                if (archive.has(String(h.domain).toLowerCase())) {
                  leaked.push(s.id + ' -> ' + h.domain);
                }
              }));

              // A story whose every hop is still the freshest thing on its
              // own domain once the last one lands. Without that, story()
              // rightly returns a NEWER story at some domain and the walk
              // is not testable -- so this picks a clean one rather than
              // asserting something that is only usually true.
              let S = null, end = 0;
              for (const s of all) {
                if (s.chain.length < 5) continue;
                const t = s.chain[s.chain.length - 1].at + 60000;
                if (t > s.ends) continue;
                if (s.chain.every(h => {
                  const r = L.story(h.domain, {at: t});
                  return r && r.storyId === s.id && r.hop === h.hop;
                })) { S = s; end = t; break; }
              }
              if (!S) return {ok: false, stories: all.length, leaked: leaked};

              const walk = S.chain.map(h => {
                const r = L.story(h.domain, {at: end});
                return {
                  hop: r.hop, role: r.role, domain: h.domain,
                  type: typeOf[String(h.domain).toLowerCase()] || '?',
                  damage: r.lost.length + Object.keys(r.wrong).length,
                  correction: !!r.correction,
                  title: String(r.title || ''), body: String(r.body || ''),
                  dek: String(r.dek || ''),
                  // withStory() on an empty page: how many rows a story
                  // adds. More than one and a feed stops being a feed.
                  added: L.withStory([], h.domain, {at: end}).length
                };
              });

              // At hop 0's minute, who has heard it?
              const early = S.chain.map(h => {
                const r = L.story(h.domain, {at: S.at + 60000});
                return {hop: h.hop, mine: !!(r && r.storyId === S.id)};
              });

              return {
                ok: true, stories: all.length, id: S.id, end: end,
                subject: S.subject, where: S.where, anchor: S.anchor,
                facts: S.facts.map(f => ({k: f.k, t: f.t})),
                walk: walk, early: early, leaked: leaked
              };
            }""")

            if prop["leaked"]:
                problems.append(
                    "the frozen archive is carrying a 2026 story: "
                    + ", ".join(prop["leaked"][:3]))
            else:
                notes.append("no story ever reaches a pre-2026 site")

            if not prop["ok"]:
                problems.append(
                    f"no clean story chain in 400 slots ({prop['stories']} "
                    "stories) -- propagation is untestable, not necessarily "
                    "broken")
                walk = []
            else:
                walk = prop["walk"]

            if walk:
                # A story reaches many sites -- the same story, by id, which
                # the JS above already asserted, and on enough different
                # kinds of site that it is a network rather than a mailing.
                doms = {w["domain"] for w in walk}
                kinds = {w["type"] for w in walk}
                if len(doms) < 5 or len(kinds) < 3:
                    problems.append(
                        f"story {prop['id']} covers {len(doms)} sites of "
                        f"{len(kinds)} kinds; wanted 5 and 3")
                else:
                    notes.append(
                        f"{prop['anchor']} travels {len(doms)} sites, "
                        f"{len(kinds)} kinds: "
                        + " -> ".join(w["role"] for w in walk))

                # Arrives in order: at hop 0's minute only hop 0 has it.
                heard = [e["hop"] for e in prop["early"] if e["mine"]]
                if heard != [0]:
                    problems.append(
                        f"at hop 0's minute the story is already on hops "
                        f"{heard} -- downstream sites are ahead of the wire")
                else:
                    notes.append("downstream sites have not heard it yet at "
                                 "hop 0, and all have by the last hop")

                # Hop 0 is the record: nothing lost, nothing wrong, and the
                # canon text of the first two facts is on the page verbatim.
                h0 = walk[0]
                if h0["damage"] != 0:
                    problems.append(
                        f"hop 0 already has {h0['damage']} facts wrong")
                canon = [f["t"] for f in prop["facts"][:2]]
                said = h0["dek"] + " " + h0["body"] + " " + h0["title"]
                off = [c for c in canon if c not in said]
                if off:
                    problems.append(
                        f"hop 0 does not state the record: missing {off[0]!r}")
                else:
                    notes.append(f"hop 0 states the record verbatim: "
                                 f"{canon[0]!r}")

                # Monotone decay. The correction hop is deliberately clean
                # and sits in the middle, so it is excluded rather than
                # allowed to look like a regression.
                run = [w for w in walk if not w["correction"]]
                worse = [w["damage"] for w in run]
                if any(b < a for a, b in zip(worse, worse[1:])):
                    problems.append(
                        f"a hop recovered a fact it should not have: {worse}")
                elif len(run) > 3 and worse[-1] <= worse[1]:
                    problems.append(
                        f"the story does not decay: hop damage {worse}")
                else:
                    notes.append(f"facts lost per hop: {worse}")

                # Wrong in the right way: a corrupted date is still a date.
                for w in walk:
                    fields = {"title": w["title"], "body": w["body"],
                              "dek": w["dek"]}
                    for name, v in fields.items():
                        if not v.strip():
                            problems.append(
                                f"hop {w['hop']} on {w['domain']} has an "
                                f"empty {name}")
                        for bad in ("undefined", "NaN", "[object Object]"):
                            if bad in v:
                                problems.append(
                                    f"hop {w['hop']} {name} shows {bad!r}")
                        m = re.search(r"\{[a-z_]+\}", v)
                        if m:
                            problems.append(
                                f"hop {w['hop']} {name} left {m.group(0)} "
                                "unresolved")
                    if w["added"] != 1:
                        problems.append(
                            f"{w['domain']} takes {w['added']} story rows, "
                            "not 1")

                # ...and it is actually on the page. Only the renderers that
                # opted in can show it, so this checks those and says how
                # many of the chain that was.
                wired = {"aggregator", "news", "wire", "forum", "board",
                         "social"}
                page.evaluate(f"SYNTH.live.setNow({prop['end']})")
                shown = 0
                for w in walk:
                    if w["type"] not in wired:
                        continue
                    errors.clear()
                    page.evaluate(
                        "SYNTH.engine.navigate('synth://%s/', {push: false})"
                        % w["domain"])
                    page.wait_for_timeout(300)
                    text = page.inner_text("#synth-viewport")
                    if prop["subject"] not in text and prop["where"] not in text:
                        problems.append(
                            f"{w['domain']} is hop {w['hop']} of "
                            f"{prop['id']} and the page does not mention it")
                        continue
                    shown += 1
                    # A feed that is mostly story stops being a feed.
                    if len(text) < 400:
                        problems.append(
                            f"{w['domain']} rendered {len(text)} chars with "
                            "a story on it -- the story is the page")
                    elif len(w["title"]) + len(w["body"]) > 0.6 * len(text):
                        problems.append(
                            f"the story is {100 * (len(w['title']) + len(w['body'])) // len(text)}%"
                            f" of {w['domain']}")
                page.evaluate("SYNTH.live.setNow(null)")
                eligible = sum(1 for w in walk if w["type"] in wired)
                if shown < 3:
                    problems.append(
                        f"only {shown} of {eligible} wired hops actually "
                        "render the story")
                else:
                    notes.append(f"{shown} of {eligible} hops visibly carry "
                                 "the story on the page itself")

            # The canon guard. Two facts in ANCHORS turned out not to be in
            # WORLD.md at all when this was written, and both had already
            # spread across a dozen sites. Numbers are the checkable part:
            # every year, count, mileage and frequency a story asserts as
            # TRUE has to be in the document. The prose around them is not
            # checked and is still on the author.
            anchors = page.evaluate("() => SYNTH.grammar.ANCHORS")
            world = (root / "docs" / "WORLD.md").read_text(encoding="utf-8")
            flat = world.replace(",", "")
            unsourced, nums = [], 0
            for a in anchors:
                for f in a["facts"]:
                    for tok in re.findall(r"\d[\d,]*(?:\.\d+)?", f["t"]):
                        nums += 1
                        if not re.search(r"(?<!\d)" + re.escape(
                                tok.replace(",", "")) + r"(?!\d)", flat):
                            unsourced.append(f"{a['id']}.{f['k']} = {tok}")
            if unsourced:
                problems.append(
                    "anchor facts assert numbers WORLD.md does not have: "
                    + ", ".join(unsourced))
            else:
                notes.append(f"all {nums} numbers in the anchor facts are in "
                             "WORLD.md")

            # And the misreports WORLD.md names by hand are the ones the
            # decay engine actually produces, rather than three others.
            fire = [a for a in anchors if a["id"] == "fire2003"]
            if not fire:
                problems.append("the substation anchor is gone")
            else:
                wrongs = " | ".join(
                    w for f in fire[0]["facts"] for w in f["w"])
                for named in ("2004", "lightning", "two deaths"):
                    if named not in wrongs:
                        problems.append(
                            f"WORLD.md says the fire is misreported as "
                            f"{named!r} and no hop can say it")

            # --- 12. the wiki argues with itself -------------------------
            #
            # The old wiki drew each edit summary independently, so "rv,
            # again" could sit at the top of a history with nothing under it
            # to revert. Nothing caught that, because a history of eight
            # plausible lines renders perfectly. These assertions are all
            # about the RELATIONSHIP between rows -- which is the only place
            # the bug was.
            wiki = None
            for r in page.evaluate("() => SYNTH.data.list()"):
                if r.get("type") == "wiki" and "2026" in str(r.get("era")):
                    wiki = r["domain"]
                    break
            if not wiki:
                problems.append("there is no 2026 wiki to check")
            else:
                arts = page.evaluate("""async (d) => {
                  const s = await SYNTH.data.getSite(d);
                  return ((s && s.data && s.data.articles) || [])
                    .map(a => a.id).slice(0, 10);
                }""", wiki)

                def rows_at(domain, art):
                    page.evaluate(
                        "(u) => SYNTH.engine.navigate(u, {push: false})",
                        "synth://%s/history/%s" % (domain, art))
                    page.wait_for_timeout(120)
                    return page.evaluate("""() =>
                      Array.from(document.querySelectorAll('.wiki-histrow')).map(n => ({
                        at: Number((n.querySelector('[data-lv-ago]') || {}).dataset
                              ? n.querySelector('[data-lv-ago]').dataset.lvAgo : 0),
                        who: (n.querySelector('.wiki-histwho') || {}).textContent || '',
                        bot: /wiki-editor-(bot|anon)/.test(n.innerHTML),
                        summary: (n.querySelector('.wiki-histsummary') || {}).textContent || ''
                      }))""")

                # A maintenance tag after the wrong full stop. The first
                # one in the substation article belongs to "Substation No. 3",
                # so a naive /\.\s/ put a citation tag inside an abbreviation
                # and the page read as a broken template. No assertion caught
                # that; a screenshot did. Checked on the article page (where
                # the tag renders as [citation needed]) and in the diff
                # source view (where it stays {{citation needed}}), across
                # every article swept rather than only the first -- the first
                # version of this check looked at one article, whose lead has
                # no abbreviation in it, and could not fail.
                ABBREV = re.compile(
                    r"\b(?:No|St|Rd|Ave|Mr|Mrs|Dr|Jr|Sr|vs|etc|Co|Inc|a\.m|p\.m)"
                    r"\.(?:\{\{|\[)(?:citation|stub|dead|NPOV|neutrality|who)")

                t0 = page.evaluate("() => SYNTH.live.now()")
                orphans, protections, locked_leaks, seen_rows = 0, 0, 0, 0
                misplaced = []
                for day in range(0, 40, 5):
                    page.evaluate("(ms) => SYNTH.live.setNow(ms)",
                                  t0 + day * DAY)
                    for art in arts[:6]:
                        rows = list(reversed(rows_at(wiki, art)))   # oldest first
                        seen_rows += len(rows)
                        # A revert reverts something: walking forward, the
                        # state must be "wrong" before an rv and not before.
                        wrong = False
                        for row in rows:
                            s = row["summary"]
                            if s.startswith("(updated "):
                                wrong = True
                            elif s.startswith("(rv"):
                                if not wrong:
                                    orphans += 1
                                wrong = False
                        page.evaluate(
                            "(u) => SYNTH.engine.navigate(u, {push: false})",
                            "synth://%s/wiki/%s" % (wiki, art))
                        page.wait_for_timeout(70)
                        m = ABBREV.search(page.inner_text("#synth-viewport"))
                        if m:
                            misplaced.append(m.group(0))
                        page.evaluate(
                            "(u) => SYNTH.engine.navigate(u, {push: false})",
                            "synth://%s/history/%s" % (wiki, art))
                        page.wait_for_timeout(70)

                        # 3RR: while a page is protected, the automated
                        # editors are not in the history, because they could
                        # not edit. That is the whole point of tripping it.
                        for k, row in enumerate(rows):
                            if not row["summary"].startswith("(protected"):
                                continue
                            protections += 1
                            until = row["at"] + 7 * DAY
                            for later in rows[k + 1:]:
                                if later["at"] < until and later["bot"]:
                                    locked_leaks += 1
                page.evaluate("() => SYNTH.live.setNow(null)")

                if orphans:
                    problems.append(
                        f"{orphans} revert(s) in the wiki history have nothing "
                        "before them to revert")
                else:
                    notes.append(f"every revert across {seen_rows} wiki "
                                 "revisions follows the edit it undoes")
                if not protections:
                    problems.append(
                        "three reverts in a window never produce page "
                        "protection -- 3RR is decoration")
                elif locked_leaks:
                    problems.append(
                        f"{locked_leaks} automated edit(s) went through while "
                        "the page was protected")
                else:
                    notes.append(f"3RR trips {protections} times in the sweep "
                                 "and the bots stop until it lifts")

                # A diff shows text that differs. The exception is a
                # protection, which changes who may edit and not a word of
                # the article -- so it is named rather than tolerated.
                page.evaluate(
                    "(u) => SYNTH.engine.navigate(u, {push: false})",
                    "synth://%s/history/%s" % (wiki, arts[0]))
                page.wait_for_timeout(200)
                links = page.evaluate("""() =>
                  Array.from(document.querySelectorAll('#synth-viewport a'))
                    .map(a => a.getAttribute('data-synth-href') || '')
                    .filter(h => h.indexOf('/diff/') === 0)""")
                blank = []
                # A maintenance tag after the wrong full stop. The first one
                # in the substation article belongs to "Substation No. 3", so
                # a naive /\.\s/ put a citation tag inside an abbreviation
                # and the page read as a broken template. No assertion caught
                # that; a screenshot did.
                for href in links:
                    page.evaluate(
                        "(u) => SYNTH.engine.navigate(u, {push: false})",
                        "synth://" + wiki + href)
                    page.wait_for_timeout(110)
                    body = page.inner_text(".wiki-diffbody")
                    m = ABBREV.search(body)
                    if m:
                        misplaced.append(m.group(0))
                    n = page.evaluate(
                        "() => document.querySelectorAll('.wiki-ins, .wiki-del').length")
                    if n:
                        continue
                    heads = page.inner_text(".wiki-diffheads")
                    if "protected for" not in heads:
                        blank.append(href)
                if misplaced:
                    problems.append(
                        f"a maintenance tag landed inside an abbreviation: "
                        f"{misplaced[0]!r}")
                if not links:
                    problems.append("the wiki history offers no diffs")
                elif blank:
                    problems.append(
                        f"{len(blank)} of {len(links)} diffs show no change at "
                        f"all, e.g. {blank[0]}")
                else:
                    notes.append(f"all {len(links)} diffs show text that "
                                 "differs, protections excepted")

                # Talk pages: indentation is bounded and nobody signs a post
                # in the future, which is the one error a dated argument
                # cannot hide.
                #
                # And nothing is said twice on one page. Threads are seeded
                # independently, which is right, and it put the heading
                # "Requested move" on one page three times and repeated a
                # reply word for word under two of them. A reader forgives a
                # lot but not that.
                echoes = []
                for art in arts[:8]:
                    page.evaluate(
                        "(u) => SYNTH.engine.navigate(u, {push: false})",
                        "synth://%s/talk/%s" % (wiki, art))
                    page.wait_for_timeout(120)
                    said = page.evaluate("""() => {
                      const strip = (t) => t.replace(/\s*\(talk\)[^]*$/, '').trim();
                      return {
                        posts: Array.from(document.querySelectorAll('.wiki-talkpost'))
                          .map(n => strip(n.innerText)),
                        heads: Array.from(document.querySelectorAll('.wiki-talkthread h2'))
                          .map(n => n.textContent)
                      };
                    }""")
                    for kind in ("posts", "heads"):
                        seen_once = set()
                        for line in said[kind]:
                            if line in seen_once:
                                echoes.append(f"{art} says {line[:48]!r} twice")
                                break
                            seen_once.add(line)
                if echoes:
                    problems.append(
                        f"{len(echoes)} talk page(s) repeat themselves: "
                        f"{echoes[0]}")
                else:
                    notes.append("no talk page says the same thing twice")

                page.evaluate(
                    "(u) => SYNTH.engine.navigate(u, {push: false})",
                    "synth://%s/talk/%s" % (wiki, arts[0]))
                page.wait_for_timeout(200)
                talk = page.evaluate("""() => {
                  const now = SYNTH.live.now();
                  const posts = Array.from(document.querySelectorAll('.wiki-talkpost'));
                  const depth = posts.map(p => {
                    const m = /wiki-talkdepth-(\\d+)/.exec(p.className);
                    return m ? Number(m[1]) : 0;
                  });
                  return {
                    posts: posts.length,
                    maxDepth: depth.length ? Math.max.apply(null, depth) : 0,
                    text: document.querySelector('#synth-viewport').innerText,
                    now: now
                  };
                }""")
                if talk["posts"] < 2:
                    problems.append("the wiki talk page has no discussion on it")
                elif talk["maxDepth"] < 1:
                    # A talk page that does not indent is a list of remarks.
                    # The upper bound is NOT asserted here: a thread has at
                    # most four replies and depth rises by at most one each,
                    # so `> 4` is unreachable and a check that cannot fail is
                    # a comment. The cap in the renderer is the guarantee;
                    # this is the half that can go wrong.
                    problems.append(
                        "talk replies are not indented -- the thread is flat")
                else:
                    notes.append(
                        f"{talk['posts']} talk posts, indented to "
                        f"{talk['maxDepth']} of 4, signed and threaded")
                future = []
                for hhmm, date in re.findall(
                        r"\(talk\) (\d\d:\d\d), (\d+ \w+ \d{4}) \(UTC\)",
                        talk["text"]):
                    try:
                        stamp = datetime.datetime.strptime(
                            date + " " + hhmm + " +0000", "%d %B %Y %H:%M %z")
                    except ValueError:
                        problems.append(f"unparseable talk signature: {date!r}")
                        continue
                    if stamp.timestamp() * 1000 > talk["now"] + 60000:
                        future.append(date + " " + hhmm)
                if future:
                    problems.append(
                        f"{len(future)} talk post(s) are signed in the future, "
                        f"e.g. {future[0]}")
                else:
                    notes.append("no talk post is signed later than now")

                # THE COLLISION, both halves, one run, two page loads.
                page.evaluate(
                    "(u) => SYNTH.engine.navigate(u, {push: false})",
                    "synth://%s/wiki/%s" % (wiki, arts[0]))
                page.wait_for_timeout(200)
                tags = page.evaluate(
                    "() => Array.from(document.querySelectorAll('.synth-tpl'))"
                    ".map(n => n.textContent)")
                page.evaluate(
                    "(u) => SYNTH.engine.navigate(u, {push: false})",
                    "synth://gridfall.chat/c/c-general")
                page.wait_for_timeout(250)
                chat = page.inner_text("#synth-viewport")
                if not tags:
                    problems.append(
                        "no maintenance template renders on the wiki article")
                elif "{{" not in chat:
                    problems.append(
                        "the weather bot's unfilled merge fields stopped "
                        "rendering literally in gridfall.chat -- the template "
                        "branch in markup.js is eating them")
                else:
                    notes.append(
                        f"templates render on the wiki ({tags[0]}) and "
                        "{{merge_field}} stays literal in chat, same run")

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
