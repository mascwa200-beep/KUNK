#!/usr/bin/env python3
"""Pages that contradict themselves.

Every other check here asks whether a page renders, whether its links go
anywhere, whether its controls do something. This one asks whether the page
AGREES WITH ITSELF -- whether a number it states matches the thing it states
it about, three inches further down the same screen.

That class of bug has produced every content fault found on this network in
the last two rounds, and not one of them was found by a check:

  * a forum's totals line said "101,900 articles in 21 topics" above an index
    column adding up to 17,064 topics
  * a footer printed the skin vintage as a founding year, under a description
    saying the board started in 2017
  * "2 Answers" over five rendered answers
  * "3 comments" over eight
  * a thread saying "Bump limit reached" above an omitted-replies count from
    before it got there
  * "Most users ever online was 118 on Mon Apr 2, 2009-2016 9:50 pm"

All six render perfectly. Every one was found by looking at a picture.

TWO RULES, both learned by getting them wrong first.

1. READ BOTH NUMBERS OFF THE PAGE. Never recompute one. A checker that
   works out `posts.length - 1` to test a number the renderer worked out as
   `posts.length - 1` asserts nothing at all -- it agrees with the bug. Every
   row below reads a stated claim and counts a rendered set, and does no
   arithmetic of its own beyond comparing them.

2. THE RELATION IS PART OF THE CLAIM. `forum.js:10` sets PER_PAGE = 10, so a
   12-post topic states 11 replies and shows 10; and `b.postCount` is an
   authored field that is SUPPOSED to exceed what the index itemises,
   because that is what a board with 604 topics and four written threads
   looks like. Picking EQUALS where AT_LEAST belongs makes the check
   permanently red; picking AT_LEAST where EQUALS belongs makes it useless.
   So each row names its relation and says why.

Anything that would need the renderer's pagination arithmetic mirrored here
is deliberately NOT in the table. That is a bug to fix, not an invariant to
assert.

Usage:  python3 .github/scripts/synthnet_claims_check.py [--root synthnet]
"""

import argparse
import glob
import os
import pathlib
import re
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

EQUALS = "equals"      # the claim describes exactly what is on this screen
AT_LEAST = "at_least"  # the claim is authored and may exceed what is itemised

# (label, type, path, claim regex, counterpart selector, relation, why)
#
# `path` may carry one {id} placeholder, filled with the first matching link
# the site's front page offers. A row whose page cannot be reached is a
# FAILURE, not a skip -- see the coverage floor at the bottom.
ROWS = [
    (
        "qa: answer heading vs answers", "qa", "/q/{id}",
        r"\b(\d+)\s+Answers?\b", ".qa-answer", EQUALS,
        "the heading counts the authored array; the page also appends the "
        "streamed ones under a second heading. askverity.com/q/q-01 said 2 "
        "over five.",
    ),
    (
        "aggregator: comment heading vs comments", "aggregator", "/item/{id}",
        r"\b(\d+)\s+comments?\b", ".agg-comment:not(.agg-comment-ad)", EQUALS,
        "the count was top-level only while commentNode() recurses into "
        "replies and three more arrive from the stream. The :not() matters -- "
        "the inline ad is an .agg-comment too, and it is decor.",
    ),
    (
        "wiki: article count vs the A-Z list", "wiki", "/",
        r"currently has\s+([\d,]+)\s+articles",
        "href:[data-synth-href^='/wiki/']", EQUALS,
        "DISTINCT hrefs, not link nodes. The first version of this row "
        "counted nodes and made the wikis look wrong at 18-vs-20, because the "
        "featured article is linked twice -- once in the panel and once in "
        "the A-Z. 'has 18 articles' is a count of articles, and the "
        "counterpart has to mean the same thing the claim means or the row is "
        "measuring its own selector.",
    ),
    (
        "media: channel count vs the channel rows", "media", "/channels",
        r"\b(\d+)\s+channels", ".chan-line", EQUALS,
        "both sides are counted from the same rendered list, which is what "
        "makes it worth pinning: it is one edit away from becoming the "
        "aggregator bug.",
    ),
    (
        "forum: totals line vs the index columns", "forum", "/",
        r"total of\s+([\d,]+)\s+articles", ".col-num", AT_LEAST,
        "AT_LEAST, not EQUALS: a board legitimately declares more posts than "
        "the index itemises. This is the pair that was wrong in the other "
        "direction on all eight forums.",
    ),
]

# A claim that prints a YEAR taken from `site.era`, which is the skin vintage
# and is free text -- "2013" or "2002-2014". Printing the range where a year
# belongs put "Mon Apr 2, 2009-2016 9:50 pm" on a real page. Whichever end a
# call site wants, what reaches the screen is one four-digit year.
#
# (label, type, path, regex whose group 1 must be exactly one year)
YEAR_ROWS = [
    ("forum: peak-online date", "forum", "/",
     r"Most users ever online was [\d,]+ on [A-Za-z]{3} [A-Za-z]{3} \d{1,2}, (\S+)"),
    ("forum: board-script footer", "forum", "/",
     r"board script someone uploaded in (\S+?)\."),
    ("blog: since-footer", "blog", "/", r"\bSince (\S+?)\."),
    ("page: last-updated footer", "page", "/", r"last updated (\S+?) ·"),
    ("wiki: snapshot footer", "wiki", "/", r"Snapshot: (\S+?)\."),
    ("news: contents-set footer", "news", "/", r"contents set in (\S+?)\."),
    ("media: archived-copy footer", "media", "/", r"archived copy, (\S+?)\."),
]

ONE_YEAR = re.compile(r"^(19|20)\d{2}$")


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
    checked_rows = 0
    checked_years = 0

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 1100, "height": 2400})
            page.goto(base, wait_until="networkidle")
            page.wait_for_timeout(500)

            sites = page.evaluate(
                "() => SYNTH.data.list().map(r => ({d: r.domain, t: r.type}))")
            by_type = {}
            for s in sites:
                by_type.setdefault(s["t"], []).append(s["d"])

            def go(url, ms=380):
                # navigate() returns a promise and Playwright awaits it, so
                # this waits for the renderer's on-demand fetch too.
                page.evaluate(
                    "(u) => SYNTH.engine.navigate(u, {push: false})", url)
                page.wait_for_timeout(ms)

            def first_link(prefix):
                return page.evaluate(
                    """(p) => {
                        const a = Array.from(document.querySelectorAll(
                            '#synth-viewport [data-synth-href]'))
                          .map(x => x.dataset.synthHref)
                          .filter(h => h.indexOf(p) === 0);
                        return a.length ? a[0] : null; }""", prefix)

            # ---- the count rows ------------------------------------------
            for label, typ, path, claim, sel, rel, _why in ROWS:
                domains = by_type.get(typ, [])
                if not domains:
                    problems.append(
                        f"{label}: no site of type {typ!r} in the registry, so "
                        "this row asserts nothing")
                    continue
                hit = 0
                for dom in domains:
                    target = path
                    if "{id}" in path:
                        go("synth://%s/" % dom, 300)
                        prefix = path.split("{id}")[0]
                        got = first_link(prefix)
                        if not got:
                            continue
                        target = got
                    go("synth://%s%s" % (dom, target))
                    text = page.inner_text("#synth-viewport")
                    m = re.search(claim, text)
                    if not m:
                        continue
                    said = int(m.group(1).replace(",", ""))
                    if sel == ".col-num":
                        # Pairs of cells: topics, posts. Sum the first of each.
                        counted = page.evaluate(
                            """() => {
                                const c = document.querySelectorAll(
                                    '#synth-viewport .col-num');
                                let t = 0;
                                for (let i = 0; i + 1 < c.length; i += 2) {
                                  t += parseInt(c[i + 1].innerText
                                        .replace(/[^0-9]/g, '') || '0', 10); }
                                return t; }""")
                    elif sel.startswith("href:"):
                        # Distinct destinations, not link nodes -- see the
                        # wiki row's note.
                        counted = page.evaluate(
                            """(s) => new Set(Array.from(
                                document.querySelectorAll('#synth-viewport ' + s))
                                .map(a => a.dataset.synthHref)).size""",
                            sel[len("href:"):])
                    else:
                        counted = page.evaluate(
                            "(s) => document.querySelectorAll("
                            "'#synth-viewport ' + s).length", sel)
                    hit += 1
                    where = "synth://%s%s" % (dom, target)
                    if rel == EQUALS and said != counted:
                        problems.append(
                            f"{label}: {where} states {said} and renders "
                            f"{counted}")
                    elif rel == AT_LEAST and said < counted:
                        problems.append(
                            f"{label}: {where} states {said}, which is fewer "
                            f"than the {counted} it itemises")
                if hit == 0:
                    problems.append(
                        f"{label}: the claim was not found on any {typ} site. "
                        "The wording or the class moved and this row went "
                        "blind rather than red")
                else:
                    checked_rows += 1
                    notes.append(f"{label}: {hit} page(s) agree")

            # ---- the year rows -------------------------------------------
            #
            # One four-digit year, or the era leaked through as a range.
            for label, typ, path, claim in YEAR_ROWS:
                hit = 0
                for dom in by_type.get(typ, []):
                    go("synth://%s%s" % (dom, path), 300)
                    text = page.inner_text("#synth-viewport")
                    m = re.search(claim, text)
                    if not m:
                        continue
                    hit += 1
                    got = m.group(1)
                    if not ONE_YEAR.match(got):
                        problems.append(
                            f"{label}: synth://{dom}{path} prints {got!r} "
                            "where a single year belongs -- site.era is the "
                            "skin vintage and can be a range")
                if hit:
                    checked_years += 1
                    notes.append(f"{label}: {hit} site(s) print one year")

            # ---- one number, printed on two pages ------------------------
            #
            # The only cross-page row here, and it earns the exception. The
            # general index-says-N / item-page-shows-M seam is excluded from
            # this file because it needs the renderer's pagination mirrored
            # in the checker, which is how a check ends up agreeing with the
            # bug. This is not that: it is ONE value printed twice, read off
            # two rendered pages, with no arithmetic in between.
            #
            # market.js fed SYNTH.live.counter() the same key,
            # 'market:cat:<id>', from both pages and a different base from
            # each -- the index counted only the authored listings, the
            # category page counted those plus the generated ones. So
            # classifieds.verity.net's index said Vehicles (121) and the
            # Vehicles page said "142 listings indexed", on every category of
            # all four market sites.
            cat_pairs = 0
            for dom in by_type.get("market", []):
                go("synth://%s/" % dom)
                cats = page.evaluate(
                    """() => Array.from(document.querySelectorAll(
                          '#synth-viewport .cl-catitem')).map(li => {
                        const a = li.querySelector('[data-synth-href^="/c/"]');
                        const c = li.querySelector('.cl-catcount');
                        return a && c ? {href: a.dataset.synthHref,
                                         name: a.innerText.trim(),
                                         n: c.innerText.replace(/[^0-9]/g, '')}
                                      : null; }).filter(Boolean)""")
                if not cats:
                    problems.append(
                        f"market: {dom} shows no category counts on its index "
                        "-- the class moved and this row went blind")
                    continue
                for c in cats:
                    go("synth://%s%s" % (dom, c["href"]), 300)
                    note = page.evaluate(
                        """() => { const n = document.querySelector(
                             '#synth-viewport .cl-note');
                           return n ? n.innerText.replace(/\\s+/g, ' ') : ''; }""")
                    m = re.search(r"([\d,]+) listings indexed", note)
                    if not m:
                        problems.append(
                            f"market: synth://{dom}{c['href']} no longer says "
                            "'N listings indexed'")
                        continue
                    cat_pairs += 1
                    said = m.group(1).replace(",", "")
                    if said != c["n"]:
                        problems.append(
                            f"market: {dom} category {c['name']!r} is "
                            f"{c['n']} on the index and {said} on its own "
                            "page")
            if cat_pairs:
                notes.append(f"market: {cat_pairs} categories carry the same "
                             "count on the index and on their own page")
            else:
                problems.append(
                    "market: no category was checked on either page")

            browser.close()
    finally:
        srv.shutdown()

    # Coverage floors. The failure this check exists to avoid is its own:
    # a renamed class or reworded sentence turning every row into a silent
    # no-match, which reads exactly like a clean sweep.
    if checked_rows < len(ROWS):
        problems.append(
            f"only {checked_rows} of {len(ROWS)} count rows found anything to "
            "check")
    # No tolerance. The first draft allowed one row to find nothing, on the
    # theory that a type might have no site printing that footer -- but all
    # seven fire today, and slack in a coverage floor is precisely the thing
    # that lets a check go quiet one row at a time.
    if checked_years < len(YEAR_ROWS):
        problems.append(
            f"only {checked_years} of {len(YEAR_ROWS)} year rows found "
            "anything to check")

    for n in notes:
        print(f"  ok  {n}")
    print()
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"OK: {len(ROWS)} counted claims and {len(YEAR_ROWS)} printed years "
          "agree with the pages that make them, and every market category "
          "carries one count on both of the pages that state it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
