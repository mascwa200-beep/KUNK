#!/usr/bin/env python3
"""Check that a list which names an order is actually in it.

A heading is a claim. "Services A–Z", "Most Viewed This Week", a numbered
<ol> of points, a column headed Posts -- each says what the rows under it
are sorted by, and each renders perfectly whether or not that is true. Eight
portal sites opened Property Tax, Open Burning, County Clerk under an A–Z
heading for as long as they had existed, and every other check in this
directory stayed green, because nothing here had ever compared a heading
with the list beneath it.

Two ways it goes wrong, and the second is the interesting one:

  * No sort at all. The renderer walks the authored array and the heading
    is aspirational.

  * Sorted on one number and printing another. `points` in the site file is
    static; `counter('agg:...:pts:' + id, points, 14)` drifts a little every
    day. Sorting on the first and printing the second gives a numbered list
    whose numbers go back up, and it degrades on its own with no commit in
    between -- the spread is days x rate x jitter, so a list that is nearly
    right today is noise next month. news.js:582 mostRead() is the version
    that is correct and it has been in the repo the whole time: score into
    an array, sort on the score, print the score.

READ THE RENDERED SEQUENCE. DERIVE NOTHING. A checker that recomputes the
renderer's sort agrees with the renderer's bug, which is the lesson of every
round of this. So every row below names a route, a container, the element
holding each row's value, and the direction -- and the numbers it compares
are the characters that are on the screen.

Selector discipline. A first pass at measuring the QA cards read every
`.qa-stat` and reported 39 inversions in 60 values; each card carries three
stats -- votes, answers, views -- and only the first is the sorted key. The
real figure was 3 in 20. A first webring selector matched nothing at all and
reported a clean "0 of 0". One row would have asserted nonsense, the other
nothing. So each row states which element it reads and why that element is
the key, and MIN_VALUES makes a row that reads too little a failure rather
than a pass.

Usage:  python3 .github/scripts/synthnet_order_check.py [--root synthnet]
        ... --dump            print every sequence it reads and assert nothing
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

DAY = 86400000

# The same instant the claims check pins, for the same reason: inside the
# simulation (EPOCH is 2026-09-19, so a clock before that empties every
# stream) and far enough in that the counters have moved.
PINNED_NOW = 1790294400000

# Every row is read twice. The counter-driven lists are nearly ordered on
# day one and degrade from there, so a single instant close to EPOCH is the
# one instant at which the aggregator bug almost does not show.
INSTANTS = [("pinned", PINNED_NOW), ("+200d", PINNED_NOW + 200 * DAY)]

# A row that reads fewer values than this has not checked anything, and the
# most likely reason is that its selector is wrong. That is a failure.
MIN_VALUES = 3

# Floors. A check that finds nothing to look at must go red.
MIN_ORDER_ROWS = 20
MIN_RING_BLOCKS = 17
MIN_COUNT_ROWS = 2


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


# ---------------------------------------------------------------------------
# The rows.
#
#   url        where to go. "@sweep:<prefix>" instead reads every page the
#              row's `seed` page links to whose href contains <prefix>, and
#              checks each one's list on its own.
#   container  the list, first match wins -- unless the row sets every, in
#              which case all of them are read and each is checked
#              separately. That is for the wiki index, which is one list per
#              letter.
#   item       one row inside it
#   value      the element inside the row that holds the sorted key; omitted
#              means the row itself. First match inside the row -- see the
#              QA note at the top of this file.
#   how        'num'  -> compare the first number in the text, desc
#              'alpha'-> compare the text, ascending, case-folded
#   partition  optional. Rows matching this selector must all come before
#              rows that do not, and the direction is then checked within
#              each of the two groups rather than across the join.
#   before     optional. Only rows that sit above this element are read.
#   why        why THIS element is the key. Written out because two of the
#              measurements that produced these rows read the wrong one.
# ---------------------------------------------------------------------------

ORDER_ROWS = [
    # --- (a) the heading claims a sort that never happened -----------------
    dict(label="portal: Services A–Z (verity.county.gov)",
         url="synth://verity.county.gov/",
         container=".services .svctable", item=".svcrow", value=".svclink",
         how="alpha",
         why="the service's own name, which is the link text and the only "
             "thing an A–Z heading can mean"),
    dict(label="portal: Services A–Z (veritysheriff.gov)",
         url="synth://veritysheriff.gov/",
         container=".services .svctable", item=".svcrow", value=".svclink",
         how="alpha",
         why="as above; this one opened with four Daily Blotter rows and "
             "then About the Blotter"),
    dict(label="portal: Services A–Z (verityschools.org)",
         url="synth://verityschools.org/",
         container=".services .svctable", item=".svcrow", value=".svclink",
         how="alpha", why="as above"),

    dict(label="media: Most Viewed (clipvault.tv)",
         url="synth://clipvault.tv/",
         container=".grid", item=".card", value=".card-meta.dim",
         how="num",
         why="the tile's own view count, three inches under the heading -- "
             "the line reads '41,544 views  •  uploaded ...' and the count "
             "is the first number in it"),
    dict(label="media: Most Viewed (countyclips.net)",
         url="synth://countyclips.net/",
         container=".grid", item=".card", value=".card-meta.dim",
         how="num", why="as above"),
    dict(label="media: Most Viewed (trailcam.verity.net)",
         url="synth://trailcam.verity.net/",
         container=".grid", item=".card", value=".card-meta.dim",
         how="num", why="as above"),

    dict(label="stream: comment ranking (clipvault-shorts.tv/w/dv-001)",
         url="synth://clipvault-shorts.tv/w/dv-001",
         container=".tm-clist", item=".tm-citem", value=".tm-cfoot",
         how="num", partition=".lv-badge",
         why="the like count the row prints, '▲ 2.6k'. The note over this "
             "list makes two claims -- ranked by engagement, humans below "
             "the fold -- so the partition is the badge: bot, spam, "
             "promoted and sponsored carry one and human is the kind that "
             "does not"),
    dict(label="stream: comment ranking (now.clipvault.tv/w/vd-001)",
         url="synth://now.clipvault.tv/w/vd-001",
         container=".tm-clist", item=".tm-citem", value=".tm-cfoot",
         how="num", partition=".lv-badge", why="as above"),

    # --- (b) sorted on the authored number, printing the live one ----------
    dict(label="aggregator: front page points (gridline.social)",
         url="synth://gridline.social/",
         container=".agg-list", item=".agg-row:not(.agg-row-ad)",
         value=".agg-pts", how="num",
         why="the points the row prints, which is counter('agg:...:pts:') "
             "and not the static link.points the sort used to read. This is "
             "a numbered <ol>, so an inversion is a rank that goes back up"),
    dict(label="aggregator: board points (gridline.social/board/*)",
         url="@sweep:/board/", seed="synth://gridline.social/",
         container=".agg-list", item=".agg-row:not(.agg-row-ad)",
         value=".agg-pts", how="num",
         why="the same list on every board page, each of which had its own "
             "copy of the same sort"),

    dict(label="qa: top questions (askverity.com)",
         url="synth://askverity.com/",
         container=".qa-cards", item=".qa-stats", value=".qa-stat-n",
         how="num",
         why="the FIRST .qa-stat-n in each card's stat block. A card carries "
             "three -- votes, answers, views -- and only votes is the key. "
             "Reading all three reported 39 inversions in 60 values that "
             "were not there"),
    dict(label="qa: top questions (verityanswers.com)",
         url="synth://verityanswers.com/",
         container=".qa-cards", item=".qa-stats", value=".qa-stat-n",
         how="num", why="as above"),
    dict(label="qa: answers on a question (askverity.com)",
         url="@sweep:/q/", seed="synth://askverity.com/", container=".qa-main",
         item=".qa-answer", value=".qa-avotes", partition=".qa-tick",
         how="num", before=".qa-h2-live",
         why="the answer's own vote count, over every question on the site. "
             "No one question carries more than three authored answers, so "
             "a single page would have been one comparison. The partition is "
             "the accepted tick, which the renderer pins to the top on "
             "purpose; the streamed answers under 'Answers still arriving' "
             "have their own heading and make no ranking claim, so the read "
             "stops there"),
    dict(label="qa: answers on a question (verityanswers.com)",
         url="@sweep:/q/", seed="synth://verityanswers.com/",
         container=".qa-main", item=".qa-answer", value=".qa-avotes",
         partition=".qa-tick", how="num", before=".qa-h2-live",
         why="as above"),

    # --- rows over lists that already hold ---------------------------------
    # Not only watching known bugs. These four passed before this round and
    # are here to notice a regression in a list nobody touched.
    dict(label="newsletter: archive, newest first (thequarry.news)",
         url="synth://thequarry.news/",
         container=".nl-arc", item=".nl-arc-row", value=".nl-arc-no",
         how="num",
         why="the issue number, printed as '#41' at the head of the row, "
             "which is what issuesNewestFirst() sorts on. The archive is "
             "this site type's front page, not /archive"),
    dict(label="newsletter: archive, newest first (brenners-notebook.email)",
         url="synth://brenners-notebook.email/",
         container=".nl-arc", item=".nl-arc-row", value=".nl-arc-no",
         how="num", why="as above"),
    dict(label="forum: memberlist Posts column (boards.gridfall.net)",
         url="synth://boards.gridfall.net/members",
         container=".fmembers tbody", item="tr", value=".col-num",
         how="num",
         why="the Posts column, which is the column the table is headed by "
             "and the number memberIndex() sorts on"),
    dict(label="forum: memberlist Posts column (gridfalldetectorists.net)",
         url="synth://gridfalldetectorists.net/members",
         container=".fmembers tbody", item="tr", value=".col-num",
         how="num", why="as above"),
    dict(label="wiki: All articles, A–Z (verity.wiki)",
         url="synth://verity.wiki/",
         container=".wiki-az-group", item="li", value="a", how="alpha",
         every=True,
         why="the article title inside EACH letter group, checked a group at "
             "a time. The index is grouped A, B, C ... and then '#' for "
             "titles starting with a digit, so the groups concatenated are "
             "not one alpha run and reading across them would assert "
             "something false"),
    dict(label="wiki: All articles, A–Z (wiki.gridfall.net)",
         url="synth://wiki.gridfall.net/",
         container=".wiki-az-group", item="li", value="a", how="alpha",
         every=True, why="as above"),
]

# Webring blocks. Not an order -- a distinctness claim. `Random` and `Next »`
# were the same href on every ring block on the network, because the random
# pick was `pick + (members.length > 2 ? 1 : 0)` and `next` was `pick + 1`.
#
# Every authored webring block on the network, and the page it is actually
# on. A first pass at this list guessed the front page of each site and found
# seven of seventeen -- most of these blocks live on a /links page, which is
# where a 2002 personal site put them.
RING_PAGES = [
    "synth://webring.gridfall.net/",
    "synth://webring.gridfall.net/join",
    "synth://stargazers.verity.net/",
    "synth://stargazers.verity.net/links",
    "synth://ashkettle-wx.net/",
    "synth://ashkettle-wx.net/links",
    "synth://ashkettlevfd.org/links",
    "synth://coyneflats.org/",
    "synth://gridfallband.org/",
    "synth://gridfallband.org/guestbook",
    "synth://gridfalltire.com/links",
    "synth://kestrelvapor.com/links",
    "synth://quarrycut.net/",
    "synth://quarrycut.net/links",
    "synth://tnorris.verity.net/contact",
    "synth://troop62.verity.net/links",
    "synth://verityrail-preservation.org/",
]

# A count over a capped list. The head printed the size of the whole hit set
# above a list that stops at four channels and eight videos, with no
# more-link and no pagination, so "31 matches" sat on top of twelve rows and
# that was all there was.
COUNT_ROWS = [
    dict(label="stream: search result count (now.clipvault.tv)",
         url="synth://now.clipvault.tv/", query="the",
         box=".tm-search input", head=".tm-resulthead", item=".tm-resultitem",
         why="the first number in the head, against the rows actually in "
             "the list under it"),
    dict(label="stream: search result count (clipvault-shorts.tv)",
         url="synth://clipvault-shorts.tv/", query="the",
         box=".tm-search input", head=".tm-resulthead", item=".tm-resultitem",
         why="as above"),
]


NUM = re.compile(r"-?\d[\d,]*(?:\.\d+)?\s*[kKmM]?")


def as_number(text):
    """The first number in a rendered string, including a shortNum suffix."""
    m = NUM.search(text or "")
    if not m:
        return None
    raw = m.group(0).replace(",", "").strip()
    mult = 1
    if raw[-1] in "kK":
        mult, raw = 1000, raw[:-1]
    elif raw[-1] in "mM":
        mult, raw = 1000000, raw[:-1]
    try:
        return float(raw) * mult
    except ValueError:
        return None


READ = """
(cfg) => {
  const root = document.querySelector('#synth-viewport') || document.body;
  let boxes = Array.from(root.querySelectorAll(cfg.container));
  if (!boxes.length) { return {missing: 'container'}; }
  // One container unless the row says every: the wiki index is one list per
  // letter and reading across the groups would assert something false.
  if (!cfg.every) { boxes = boxes.slice(0, 1); }
  return {lists: boxes.map(box => {
    let items = Array.from(box.querySelectorAll(cfg.item));
    if (cfg.before) {
      const stop = box.querySelector(cfg.before) ||
                   root.querySelector(cfg.before);
      if (stop) {
        items = items.filter(n =>
          stop.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING);
      }
    }
    return items.map(n => {
      const v = cfg.value ? n.querySelector(cfg.value) : n;
      return {
        text: v ? (v.textContent || '').trim() : null,
        group: cfg.partition ? (n.querySelector(cfg.partition) ? 0 : 1) : 0
      };
    });
  })};
}
"""

RINGS = """
() => {
  const root = document.querySelector('#synth-viewport') || document.body;
  return Array.from(root.querySelectorAll('.pg-webring')).map(b => {
    const links = Array.from(b.querySelectorAll('.pg-ring-link'));
    const href = label => {
      const a = links.find(x => (x.textContent || '').indexOf(label) >= 0);
      if (!a) { return null; }
      return a.dataset.synthHref || a.getAttribute('href') || '(dead)';
    };
    const count = (b.querySelector('.pg-ring-count') || {}).textContent || '';
    return {
      ring: ((b.querySelector('.pg-ring-name') || {}).textContent || '').trim(),
      prev: href('Prev'), random: href('Random'), next: href('Next'),
      count: count
    };
  });
}
"""


def check_order(row, lists, problems, dump):
    """lists is one entry per matching container; each is a list of rows."""
    label = row["label"]
    total = sum(len(x) for x in lists)
    if dump:
        print(f"    {len(lists)} list(s), {total} value(s)")
        for one in lists:
            for r in one[:40]:
                print(f"      [{r['group']}] {r['text']!r}")
            if len(lists) > 1:
                print("      --")

    if total < MIN_VALUES:
        problems.append(
            f"{label}: read {total} value(s) from "
            f"{row['container']} / {row['item']}"
            + (f" / {row['value']}" if row.get("value") else "")
            + f" -- fewer than {MIN_VALUES}, so this row asserted nothing. "
              "Either the selector is wrong or the list is gone.")
        return 0

    for one in lists:
        if not one:
            continue
        if not check_one(row, one, problems):
            return 0
    return total


def check_one(row, rows, problems):
    label, how = row["label"], row["how"]
    blanks = [r for r in rows if not r["text"]]
    if blanks:
        problems.append(
            f"{label}: {len(blanks)} of {len(rows)} rows had no "
            f"{row.get('value') or 'text'} in them, so the sequence read is "
            "not the sequence on the page")
        return 0

    # The partition first: everything in group 0 must precede group 1.
    if row.get("partition"):
        seen_one = False
        for i, r in enumerate(rows):
            if r["group"] == 1:
                seen_one = True
            elif seen_one:
                prev = next(rows[j] for j in range(i - 1, -1, -1)
                            if rows[j]["group"] == 1)
                problems.append(
                    f"{label}: a row matching {row['partition']} is below one "
                    f"that does not -- {prev['text']!r} then {r['text']!r} at "
                    f"position {i + 1} of {len(rows)}")
                return 0

    bad = []
    for group in (0, 1):
        vals = [r["text"] for r in rows if r["group"] == group]
        if len(vals) < 2:
            continue
        if how == "num":
            nums = [as_number(v) for v in vals]
            for i, (v, n) in enumerate(zip(vals, nums)):
                if n is None:
                    problems.append(
                        f"{label}: no number in {v!r} at position {i + 1}, so "
                        "the value read is not the sorted key")
                    return 0
            for i in range(1, len(nums)):
                if nums[i] > nums[i - 1]:
                    bad.append(f"{vals[i - 1]!r} then {vals[i]!r} "
                               f"(position {i} -> {i + 1})")
        else:
            keys = [v.strip().lower() for v in vals]
            for i in range(1, len(keys)):
                if keys[i] < keys[i - 1]:
                    bad.append(f"{vals[i - 1]!r} then {vals[i]!r} "
                               f"(position {i} -> {i + 1})")

    if bad:
        word = "descending" if how == "num" else "A–Z"
        problems.append(
            f"{label}: {len(bad)} inversion(s) in {len(rows)} rows read from "
            f"{row['container']} / {row['item']}"
            + (f" / {row['value']}" if row.get("value") else "")
            + f". The list is not {word}. First: " + bad[0]
            + f"  [the key is {row['why']}]")
        return 0
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--dump", action="store_true",
                    help="print every sequence and assert nothing")
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
    rows_reached = values_read = ring_blocks = counts_reached = 0

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 1100, "height": 2600})
            page.goto(base, wait_until="networkidle")
            page.wait_for_timeout(500)

            def go(url, ms=400):
                page.evaluate("(u) => SYNTH.engine.navigate(u, {push: false})",
                              url)
                page.wait_for_timeout(ms)

            def hrefs(prefix):
                seen = page.evaluate(
                    """(p) => Array.from(document.querySelectorAll(
                            '#synth-viewport [data-synth-href]'))
                          .map(x => x.dataset.synthHref)
                          .filter(h => h.indexOf(p) >= 0)""", prefix)
                out = []
                for h in seen:
                    if h not in out:
                        out.append(h)
                return out

            def read(row, url):
                go(url)
                return page.evaluate(READ, {
                    "container": row["container"], "item": row["item"],
                    "value": row.get("value"),
                    "partition": row.get("partition"),
                    "before": row.get("before"),
                    "every": bool(row.get("every")),
                })

            # ---- the ordered lists ---------------------------------------
            for row in ORDER_ROWS:
                ok_here = True
                for when, ms in INSTANTS:
                    page.evaluate("(ms) => SYNTH.live.setNow(ms)", ms)
                    url, got = row["url"], None
                    if url.startswith("@sweep:"):
                        # Every board, or every question, that the front page
                        # links to -- each page's list checked on its own.
                        # Hard-coding an id makes the row go quiet the day
                        # that id is renamed, and reading only the first
                        # question landed on one with a single unaccepted
                        # answer, which is no comparison at all.
                        prefix = url[len("@sweep:"):]
                        go(row["seed"])
                        cands = hrefs(prefix)
                        if not cands:
                            problems.append(
                                f"{row['label']}: nothing on {row['seed']} "
                                f"links to {prefix}, so this row had no page "
                                "to read")
                            ok_here = False
                            break
                        lists, missing = [], 0
                        for cand in cands:
                            trial = read(row, cand)
                            if trial.get("missing"):
                                missing += 1
                            else:
                                lists.extend(trial["lists"])
                        if missing:
                            problems.append(
                                f"{row['label']} [{when}]: {missing} of "
                                f"{len(cands)} page(s) under {prefix} had no "
                                f"{row['container']} on them")
                            ok_here = False
                            continue
                        url = f"{len(cands)} page(s) under {prefix}"
                        got = {"lists": lists}
                    if got is None:
                        got = read(row, url)
                    if args.dump:
                        print(f"  {row['label']}  [{when}]  {url}")
                    if got.get("missing"):
                        problems.append(
                            f"{row['label']} [{when}]: {row['container']} is "
                            f"not on {url}, so this row asserted nothing")
                        ok_here = False
                        continue
                    n = check_order(row, got["lists"], problems, args.dump)
                    if n:
                        values_read += n
                    else:
                        ok_here = False
                if ok_here:
                    rows_reached += 1

            # ---- webring Random vs Next ----------------------------------
            page.evaluate("(ms) => SYNTH.live.setNow(ms)", PINNED_NOW)
            for url in RING_PAGES:
                go(url)
                blocks = page.evaluate(RINGS)
                if args.dump:
                    print(f"  ring {url}: {len(blocks)} block(s)")
                for b in blocks:
                    if args.dump:
                        print(f"     {b['ring']!r} prev={b['prev']} "
                              f"random={b['random']} next={b['next']} "
                              f"[{b['count'].strip()}]")
                    sites = as_number(b["count"]) or 0
                    if b["random"] is None or b["next"] is None:
                        problems.append(
                            f"webring on {url}: the block {b['ring']!r} has no "
                            "Random or no Next link, so nothing was compared")
                        continue
                    ring_blocks += 1
                    if sites >= 2 and b["random"] == b["next"]:
                        problems.append(
                            f"webring on {url}: in the ring {b['ring']!r} "
                            f"({b['count'].strip()}) Random and Next are the "
                            f"same href, {b['next']} -- the button that says "
                            "Random is the button beside it")

            # ---- a count over a capped list ------------------------------
            for row in COUNT_ROWS:
                go(row["url"])
                box = page.query_selector(f"#synth-viewport {row['box']}")
                if not box:
                    problems.append(
                        f"{row['label']}: no {row['box']} on {row['url']}, so "
                        "this row asserted nothing")
                    continue
                # The box renders nothing on keystroke -- the form's submit
                # handler is what builds the result list.
                box.fill(row["query"])
                box.press("Enter")
                page.wait_for_timeout(350)
                got = page.evaluate(
                    """(cfg) => {
                        const root = document.querySelector('#synth-viewport');
                        const h = root.querySelector(cfg.head);
                        return {
                          head: h ? (h.textContent || '').trim() : null,
                          items: root.querySelectorAll(cfg.item).length };
                    }""", {"head": row["head"], "item": row["item"]})
                if args.dump:
                    print(f"  {row['label']}: {got['head']!r} over "
                          f"{got['items']} row(s)")
                if not got["head"]:
                    problems.append(
                        f"{row['label']}: no {row['head']} after typing "
                        f"{row['query']!r}, so this row asserted nothing")
                    continue
                claimed = as_number(got["head"])
                if claimed is None:
                    problems.append(
                        f"{row['label']}: no number in {got['head']!r}")
                    continue
                if got["items"] < MIN_VALUES:
                    problems.append(
                        f"{row['label']}: {got['items']} result row(s) for "
                        f"{row['query']!r} -- too few to tell a capped list "
                        "from an uncapped one, so this row asserted nothing")
                    continue
                counts_reached += 1
                if int(claimed) != got["items"]:
                    problems.append(
                        f"{row['label']}: the head says {got['head']!r} and "
                        f"{got['items']} row(s) are under it. A reader "
                        "counting gets the second number."
                        f"  [{row['why']}]")

            browser.close()
    finally:
        srv.shutdown()

    if args.dump:
        print("\n(dump mode: nothing was asserted)")
        return 0

    # ---- floors -----------------------------------------------------------
    if rows_reached < MIN_ORDER_ROWS:
        problems.append(
            f"only {rows_reached} of {len(ORDER_ROWS)} ordered lists were "
            f"read clean (floor {MIN_ORDER_ROWS}) -- a check that cannot "
            "reach its rows is not passing, it is silent")
    if ring_blocks < MIN_RING_BLOCKS:
        problems.append(
            f"only {ring_blocks} webring block(s) were compared (floor "
            f"{MIN_RING_BLOCKS}) -- the selector is probably wrong again")
    if counts_reached < MIN_COUNT_ROWS:
        problems.append(
            f"only {counts_reached} of {len(COUNT_ROWS)} capped-count rows "
            f"were reached (floor {MIN_COUNT_ROWS})")

    for p in problems:
        print(f"FAIL: {p}")
    for n in notes:
        print(f"note: {n}")

    if problems:
        print(f"\n{len(problems)} problem(s)")
        return 1

    print(f"order  {rows_reached} list(s), {values_read} rendered value(s) "
          f"at {len(INSTANTS)} instants; {ring_blocks} webring block(s); "
          f"{counts_reached} capped count(s) -- all in the order they claim")
    return 0


if __name__ == "__main__":
    sys.exit(main())
