#!/usr/bin/env python3
"""Text on a page has to be findable by searching for it.

app/engine.js:1205 puts the words "Searching the whole of VerityNet, offline"
over the search box. Three rounds have now found that sentence to be a claim
rather than a description:

  round 10  a term on 200+ documents kept only the start of the alphabet,
            so wiki.gridfall.net was not reachable through the index at all
  round 14  `[quote=Dori Wanamaker]` renders as "Dori Wanamaker wrote:" and
            the indexer's tag regex ate the attribution with the tag, so
            eleven people whose names are on a page were in no posting list
  round 14  and then, measured properly: every renderer draws a masthead out
            of `data` -- siteName, boardName, storeName, agency, masthead,
            motto, tagline, slogan, notices, rules, about, blogroll, navLabel
            -- and not one of those fields was read by any document builder

Each of those was found by reading the content and reasoning about it. This
file does the opposite, and it is the only version of the question that does
not need me to guess which field is next:

    render the page, read the words off the screen, and ask the app's own
    search box for them.

Nothing here re-implements the index, the tokeniser's rules about what a term
is, or markup stripping. A checker that re-derives the thing it is checking
agrees with the bug.

WHICH WORDS ARE FAIR TO ASK FOR
    A page shows two kinds of text. One is authored: it is in the site's
    own net/sites/<domain>/site.json, and if it is on screen it had better
    be in the index. The other is generated at render time by the live
    simulation -- app/slop_*.js ad copy, app/grammar.js bot posts, counters
    that move with the clock -- and no static index can hold it.

    So the words asked for are the intersection: on screen AND in this
    site's own file. That rule is mechanical, needs no field list, and is
    what lets this check survive a renderer learning to draw a field that
    build.py has never heard of.

WHAT COUNTS AS FOUND
    found      a result on this page's own domain
    elsewhere  no result here, but a result whose DOMAIN contains the word.
               Pages name other sites in their prose -- "the report is at
               verityhealth.gov" -- and searching "verityhealth" off the
               page that says so and landing on verityhealth.gov is the
               search working, not failing.
    crowded    eighty results -- the cap in engine.js's search() -- and none
               of them here. The word is plainly in the index; which of
               eighty documents ranks first is a question about ranking,
               which this file does not claim to answer. Counted, printed,
               and excluded from the conclusive total rather than hidden.
    missing    FAIL.

AND THE THREE STRIPPERS
    A second, much smaller pass puts the same string through all three
    implementations of "what does this text say" -- markup.js parse(),
    markup.js strip(), build.py strip_markup() -- and holds each to what it
    is for, so a divergence is named at the markup rule rather than
    surfacing three hundred pages later as "search missed it".

    One alignment this round made does NOT show up here and is worth saying
    so: `{{citation needed}}` renders as a chip reading its own name, and
    strip_markup() used to leave the braces on. Every tokeniser in the
    project splits on punctuation, so the braces changed no term -- measured,
    the fix added zero -- and a word-level comparison cannot see it. It was
    made so the three agree, not because anything was unfindable.

AND THE SUBJECT TAGS
    A third pass, and deliberately a DIFFERENT question: the one above asks
    only for words a reader can see, which is its whole discipline. A tag is
    not on the page -- it is in the site envelope and in net/registry.json,
    and docs/AUTHORING.md tells an author it is "used by the directory".

    It was not. 85 of the 109 sites carry tags, 174 distinct values, and
    search()'s registry fold-in built its haystack from domain, title and
    description and stopped. Measured with the fold-in removed: 67 of 423
    tag queries returned nothing at all -- `foia`, `route-62`,
    `bracken-lane`, `local-news`, every one a word an author typed for a
    directory that read none of them.

Usage:  python3 .github/scripts/synthnet_search_check.py [--root synthnet]
        ... --sites N     stop after N sites (local runs; fails the floors)
        ... --deep N      in-site pages to follow per site (default 2)
"""

import argparse
import glob
import importlib.util
import json
import os
import pathlib
import re
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Same instant the rest of the suite pins, so a run is the same run twice.
PINNED_NOW = 1790294400000

# A word worth asking for: four characters or more, all letters, not a
# stopword. The SPLIT is build.py's own `_TOKEN`, imported rather than
# restated, because a checker that tokenises differently from the index is
# asking for words the index was never going to hold.
#
# Measured, before that was true here: this file split on `[a-z]{4,}` and so
# read "mbps" out of "300Mbps", while build.py's tokeniser keeps "300mbps"
# whole. engine.js matches a term and any term it is a PREFIX of, and "mbps"
# is not a prefix of "300mbps", so the check reported a product page as
# unfindable over a difference in its own regex. Dropping anything with a
# digit in it -- versions, model numbers, "V1AGRA" -- costs nothing: they are
# in the index, they are just not what a person types.
#
# The STOPLIST comes from build.py too.
MIN_WORD = 4

# build.py's own `_TOKEN`, bound once the module is loaded. Left as a
# module global rather than threaded through every call because the
# whole point is that there is exactly one of it.
bp_TOKEN = None

# Floors, no tolerance. The failure this file is most likely to have is its
# own: a link harvester whose selector stops matching, a navigation that
# silently does nothing, a set intersection that comes out empty. Every one
# of those reads exactly like a clean sweep.
#
# Measured at the commit that added this file: 108 sites (109 less the
# browser's own control panel), 318 pages, 9,230 distinct words, 61,415
# conclusive word-on-page checks, in 105 seconds. The floors sit under those
# with room for content to move, and far above what a broken sampler would
# produce -- breaking the link harvester drops the page count to 108, and
# misspelling the site-file path drops the word count to zero.
MIN_SITES = 100
MIN_PAGES = 280
MIN_WORDS = 8000
MIN_CONCLUSIVE = 50000

# The result cap lives in engine.js's search(): `dedup.slice(0, 80)`.
RESULT_CAP = 80

# The subject-tag pass. Measured when it was written: 174 distinct tags
# across 85 sites, 423 tag/site pairs.
MIN_TAGS = 120
MIN_TAG_PAIRS = 300


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


def load_build(root):
    """tools/build.py as a module, for its tokeniser, STOPLIST and strippers."""
    spec = importlib.util.spec_from_file_location("synth_build", root / "tools" / "build.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["synth_build"] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# the stripper probes
# ---------------------------------------------------------------------------

# Each row is an input and a one-line note on what the page shows. Three
# assertions run over them -- see probe_strippers() -- and none of them is
# "all three agree", because parse() draws and the other two do not.
PROBES = [
    ("[b]bold[/b] plain", "a tag is chrome, its contents are not"),
    ("[b]unclosed bold", "an unclosed tag must not eat the rest of the body"),
    ("[quote=Dori Wanamaker]she said this[/quote]",
     "the attribution is a person's name and renders as one"),
    ("[quote=w_hulse]forwarded[/quote]", "handles are names too"),
    ("[url=synth://wiki.gridfall.net/]Gridfall Wiki[/url]",
     "the label is on screen, the URL is not"),
    ("[url=synth://wiki.gridfall.net/]", "a link with no label shows nothing"),
    ("[img:avatar:seed-1] beside text", "an image seed is never words"),
    ("[img:button:vn-btn-anybrowser]", "nor is a button seed"),
    ("{{citation needed}} in an article",
     "a maintenance template renders a chip reading its own name"),
    ("{{stub}}", "including the one-word ones"),
    ("[code]var x = 1;[/code]", "code is text"),
    ("[b][i]nested[/i][/b]", "nesting changes nothing about the words"),
    ("a [ bracket that is not a tag", "a stray bracket is a bracket"),
    ("[nonsense]tag[/nonsense]", "an unknown tag is literal"),
    ("[B]UPPER CASE TAG[/B]", "tags are case-insensitive"),
    ("[quote=A][quote=B][quote=C]deep[/quote][/quote][/quote]", "quotes nest"),
    ("[list][*]one[*]two[/list]", "list items are separate lines"),
]

# `[quote]` with no attribution renders the label "Quote:" and neither
# stripper emits it. That is correct -- a label is chrome, not content -- so
# it is written down here rather than asserted.


def words(s):
    return [w for w in re.split(r"[^A-Za-z0-9]+", s or "") if w]


def probe_strippers(page, bp, problems, notes):
    got = page.evaluate("""(probes) => probes.map(t => {
      const host = document.createElement('div');
      /* in the document, not off it: textContent on a detached node glues
         adjacent list items into one word, which is a reading artefact and
         not a disagreement */
      host.style.position = 'absolute';
      host.style.left = '-9999px';
      document.body.appendChild(host);
      let rendered = 'THREW';
      try { host.appendChild(SYNTH.markup.parse(t)); rendered = host.innerText; }
      catch (e) { rendered = 'THREW: ' + e.message; }
      let stripped = 'THREW';
      try { stripped = SYNTH.markup.strip(t); } catch (e) { stripped = 'THREW'; }
      document.body.removeChild(host);
      return {rendered: rendered, stripped: stripped};
    })""", [p for p, _why in PROBES])

    if len(got) != len(PROBES):
        problems.append(
            f"the stripper probe returned {len(got)} rows for {len(PROBES)} "
            "inputs, so it was not comparing what it says it compares")
        return
    bad = 0
    for (text, why), row in zip(PROBES, got):
        page_words = words(row["rendered"])
        index_words = words(bp.strip_markup(text))
        strip_words = words(row["stripped"])
        shape = ("%r (%s)\n"
                 "        page   %r   <- app/markup.js parse()\n"
                 "        index  %r   <- tools/build.py strip_markup()\n"
                 "        strip  %r   <- app/markup.js strip()"
                 % (text, why, row["rendered"], bp.strip_markup(text),
                    row["stripped"]))
        # Three assertions, and they are not the same one.
        #
        # First: an image tag parse() does not recognise comes back out of it
        # as its own source, and the reader is shown a piece of markup.
        # app/types/page.js drew the 88x31 button walls by handing
        # '[img:button:' + seed + ']' to parse(); markup.js's RE_IMG listed
        # four kinds and not `button`, so 221 buttons across 22 sites fell
        # through to page.js's developer placeholder -- a grey box with the
        # words "button:vn-btn-anybrowser" printed inside it. Nothing threw,
        # nothing logged, and the page looked deliberate. This clause goes
        # first because the strippers disagree about such a tag too, and the
        # tag is the diagnosis while the disagreement is only a symptom.
        leftover = [m for m in ("[img:", "{{") if m in row["rendered"]]
        if leftover:
            bad += 1
            problems.append(
                "parse() left %s on the drawn page instead of drawing it, "
                "for " % " and ".join(repr(m) for m in leftover) + shape)
            continue
        # Second: the strippers are two implementations of ONE job -- the
        # plain text of a body -- in two languages, so they have to produce
        # the same words. This is the assertion that fails when the Python
        # one learns a markup rule the JS one does not, which is exactly how
        # the quote attributions went missing from the index.
        if index_words != strip_words:
            bad += 1
            problems.append("the two strippers disagree on " + shape)
            continue
        # Third: parse() is a different job -- it draws. It adds chrome the
        # strippers have no reason to emit ("wrote:" over a quote, "Quote:"
        # over an unattributed one) and it leaves malformed markup on screen
        # literally rather than guessing. So the page is not required to
        # match word for word; it is required to CONTAIN. A stripper that
        # emits a word nobody can see has invented it.
        #
        # That is the mirror of the bug this round fixed, and it is how this
        # clause was proved to fail: drop the attribution from parse() -- so
        # a quote renders the bare label "Quote:" -- while both strippers go
        # on emitting the name, and the index holds people no reader can see.
        unseen = [w for w in index_words if w not in page_words]
        if unseen:
            bad += 1
            problems.append(
                "the strippers emit %r, which is nowhere on the rendered "
                "page, for " % unseen + shape)
    if not bad:
        notes.append("%d markup probes: the two strippers agree, every word "
                     "they emit is on the drawn page, and nothing renders as "
                     "its own source" % len(PROBES))


# ---------------------------------------------------------------------------
# what a site's own file says
# ---------------------------------------------------------------------------

def wordset(text, stoplist):
    """The words of a blob, split build.py's way. See MIN_WORD."""
    out = set()
    for match in bp_TOKEN.finditer((text or "").lower()):
        token = match.group(0)
        if len(token) >= MIN_WORD and token.isalpha() and token not in stoplist:
            out.add(token)
    return out


def authored_words(root, domain, bp, stoplist):
    """Every word in every sentence the site file holds.

    Deliberately every field and not a list of content fields: the whole
    point is to notice a field nobody remembered to index, and a list of the
    fields worth indexing is exactly the artefact that goes stale.

    The filter is a SHAPE rather than a field name. A string counts as
    authored prose if it holds a space and at least twelve characters. That
    keeps every sentence in the file -- a portal's notices, a board's rules,
    a button wall's label, the line inside a [quote=] -- and drops the
    machine fields: ids, image seeds, skin names, `type`, and the envelope's
    `links` and `tags`, which are single tokens.

    The rule earns its keep. `ashkettle.gov` carries the registry tag
    "government", and the word "government" does appear on its front page --
    in "Not a government program", which is app/slop_ads.js generating ad
    copy at render time. Nothing static can index that, and asking the index
    to hold it would be asking it to hold a different sentence on every
    load. One coincidence between a one-word field and the live generators
    is enough to make a checker accuse the build of a bug that is not there.

    What it costs: a one-word field that IS drawn -- `siteName: "Gridline"`
    -- is not asked for. The site title covers that case from the registry
    side, and no bug found in fourteen rounds has lived in a single word.
    """
    f = root / "net" / "sites" / domain.replace(".", "-") / "site.json"
    if not f.is_file():
        return set()
    out = set()

    def walk(v):
        if isinstance(v, str):
            # Through the project's own stripper first, so a URL inside a
            # [url=] tag, an image seed and a scheme are gone before the
            # words are counted. They are in the file and they are not on
            # the page: `[url=/l/l-lo-photos]the note[/url]` is the label
            # "the note", and asking the index for "photos" because of it
            # is asking for a word nobody can see.
            if len(v) >= 12 and " " in v:
                out.update(wordset(bp.strip_markup(v), stoplist))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    try:
        walk(json.loads(f.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return set()
    return out


# ---------------------------------------------------------------------------
# the pass itself
# ---------------------------------------------------------------------------

HARVEST = """(d) => Array.from(document.querySelectorAll('#synth-viewport a')).map(a => {
  var r = (a.dataset && a.dataset.synthHref) || '';
  if (r.indexOf('synth://' + d + '/') === 0) r = r.slice(('synth://' + d).length);
  if (r.charAt(0) === '/' && r.charAt(1) !== '/') return r;
  return '';
}).filter(Boolean)"""

ASK = """async (batch) => {
  const out = {};
  for (const row of batch) {
    const term = row[0], wanted = row[1];
    const rs = await SYNTH.engine.search(term);
    const doms = {};
    let cross = false;
    for (const r of rs) {
      doms[r.domain] = 1;
      if (r.domain.indexOf(term) !== -1) cross = true;
    }
    out[term] = {
      n: rs.length,
      hit: wanted.filter(d => doms[d]),
      cross: cross
    };
  }
  return out;
}"""


def check_tags(sites, ask, problems, notes):
    """Every subject tag in the registry has to find the sites that carry it.

    A DIFFERENT QUESTION FROM THE REST OF THIS FILE, and worth saying so.
    Everything above asks only for words a reader can see on a page; that
    restraint is the whole discipline of it. A tag is not on the page. It is
    in the site envelope and in net/registry.json, and docs/AUTHORING.md
    tells an author it is "used by the directory".

    It was not. 85 of the 109 sites carry tags, 174 distinct values, and
    `search()`'s registry fold-in built its haystack from domain, title and
    description and stopped there. Measured with the fold-in removed: 67 of
    423 tag queries returned NOTHING -- `foia`, `route-62`, `bracken-lane`,
    `local-news`, each of them a word an author typed and nobody could reach.

    One query per distinct tag rather than per site, because the answer does
    not depend on which of the sites carrying it asked.
    """
    carriers = {}
    for site in sites:
        tags = site.get("tags")
        if not isinstance(tags, list):
            continue
        for tag in tags:
            if isinstance(tag, str) and tag.strip():
                carriers.setdefault(tag.strip().lower(), set()).add(site["domain"])
    if not carriers:
        problems.append(
            "no site in the registry carries a subject tag, so nothing was "
            "asked. 85 of them did when this pass was written; a parse that "
            "finds none reads exactly like every tag resolving")
        return 0, 0

    rows = [[tag, sorted(doms)] for tag, doms in sorted(carriers.items())]
    verdicts = {}
    for i in range(0, len(rows), 400):
        verdicts.update(ask(rows[i:i + 400]))

    missing, crowded, pairs = [], 0, 0
    for tag, doms in sorted(carriers.items()):
        said = verdicts.get(tag)
        if said is None:
            problems.append("the tag %r was collected and never asked for" % tag)
            continue
        hit = set(said["hit"])
        for dom in sorted(doms):
            pairs += 1
            if dom in hit:
                continue
            if said["n"] >= RESULT_CAP:
                crowded += 1
                continue
            missing.append((tag, dom, said["n"]))

    for tag, dom, n in missing[:20]:
        problems.append(
            "%s is tagged %r and searching %r returns %d result(s), none of "
            "them that site. docs/AUTHORING.md tells an author tags are "
            "\"used by the directory\"" % (dom, tag, tag, n))
    if len(missing) > 20:
        problems.append("... and %d more tag/site pairs that do not resolve"
                        % (len(missing) - 20))

    if len(carriers) < MIN_TAGS:
        problems.append("only %d distinct tag(s) were found in the registry "
                        "(floor %d)" % (len(carriers), MIN_TAGS))
    if pairs < MIN_TAG_PAIRS:
        problems.append("only %d tag/site pair(s) were asked about (floor "
                        "%d)" % (pairs, MIN_TAG_PAIRS))
    if not missing:
        notes.append("%d subject tags across %d sites, every one of them "
                     "finding the sites that carry it (%d pair(s) hit the "
                     "%d-result cap)"
                     % (len(carriers), len({d for ds in carriers.values()
                                            for d in ds}), crowded, RESULT_CAP))
    return len(carriers), pairs


def spread(paths, want):
    """`want` of these, taken evenly across the list rather than off the top.

    A renderer draws its navigation first, so the first two in-site links on
    any page are "FAQ" and "Search" on eight forums running -- and a sample
    made of nav bars is a sample of one page repeated. Taking them evenly
    spaced lands on a board, an article, a product, a thread. Deterministic,
    so two runs read the same pages.
    """
    seen, rows = set(["/"]), []
    for p in paths:
        if p in seen:
            continue
        seen.add(p)
        rows.append(p)
    if len(rows) <= want:
        return rows
    step = len(rows) / float(want)
    return [rows[min(len(rows) - 1, int(i * step))] for i in range(want)]


def visit(page, url, stoplist):
    page.evaluate("(u) => SYNTH.engine.navigate(u, {push: false})", url)
    try:
        page.wait_for_function(
            "() => { var v = document.querySelector('#synth-viewport');"
            "return v && v.textContent && v.textContent.length > 40; }",
            timeout=4000)
    except Exception:
        pass
    page.wait_for_timeout(160)
    return wordset(page.inner_text("#synth-viewport"), stoplist)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--sites", type=int, default=0)
    ap.add_argument("--deep", type=int, default=2)
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()

    global bp_TOKEN
    bp = load_build(root)
    bp_TOKEN = bp._TOKEN
    stoplist = bp.STOPLIST
    registry = json.loads((root / "net" / "registry.json").read_text(encoding="utf-8"))
    sites = [s for s in registry.get("sites") or []
             if s.get("domain") and s.get("type") != "control"]
    sites.sort(key=lambda s: s["domain"])
    if args.sites:
        sites = sites[:args.sites]

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: playwright is not installed, so nothing was rendered and "
              "nothing was searched for. This check has no static mode.")
        return 1

    problems, notes = [], []
    port = free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port),
                              lambda *a, **k: Quiet(*a, directory=str(root), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    pages = []          # {url, domain, want:set(words)}
    shown = {}          # word -> set(domains that show it)
    errors = []
    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 420, "height": 1200})
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
            page.wait_for_timeout(300)
            page.evaluate("(ms) => SYNTH.live.setNow(ms)", PINNED_NOW)

            for site in sites:
                domain = site["domain"]
                have = authored_words(root, domain, bp, stoplist)
                # `targets` grows while it is being walked: the front page is
                # rendered first, its own links are harvested off the drawn
                # page, and the first `--deep` of them are appended and then
                # visited by the same loop. The pages this check reads are
                # the ones the renderer says exist, not ones derived from the
                # index -- a page the index has never heard of has to be
                # reachable here, or the whole question is circular.
                targets = ["/"]
                for step, path in enumerate(targets):
                    url = "synth://" + domain + path
                    on_screen = visit(page, url, stoplist)
                    if step == 0:
                        targets.extend(spread(page.evaluate(HARVEST, domain),
                                              args.deep))
                    want = on_screen & have
                    pages.append({"url": url, "domain": domain, "want": want})
                    for w in want:
                        shown.setdefault(w, set()).add(domain)

            probe_strippers(page, bp, problems, notes)

            def ask(rows):
                return page.evaluate(ASK, rows)

            tags, tag_pairs = check_tags(sites, ask, problems, notes)

            # One query per distinct word, not per word per page: the answer
            # does not depend on which page asked.
            verdicts = {}
            batch = [[w, sorted(d)] for w, d in sorted(shown.items())]
            for i in range(0, len(batch), 400):
                verdicts.update(ask(batch[i:i + 400]))
            browser.close()
    finally:
        srv.shutdown()

    if errors:
        problems.append("the app threw while the pages were being read: %s"
                        % errors[0][:160])

    missing, elsewhere, crowded, conclusive = [], 0, 0, 0
    for p in pages:
        for w in sorted(p["want"]):
            v = verdicts.get(w)
            if v is None:
                problems.append("%r was on %s and was never asked for -- the "
                                "query pass did not cover every word it "
                                "collected" % (w, p["url"]))
                continue
            if p["domain"] in v["hit"]:
                conclusive += 1
            elif v["cross"]:
                elsewhere += 1
                conclusive += 1
            elif v["n"] >= RESULT_CAP:
                crowded += 1
            else:
                conclusive += 1
                missing.append((w, p["url"], v["n"]))

    for w, url, n in missing[:25]:
        problems.append(
            "%r is on %s and in that site's own file, and Verity Search "
            "returns %d result(s), none of them on this site"
            % (w, url, n))
    if len(missing) > 25:
        problems.append("... and %d more words on screen that the index has "
                        "never seen" % (len(missing) - 25))

    if len(sites) < MIN_SITES:
        problems.append(f"only {len(sites)} site(s) were reached (floor "
                        f"{MIN_SITES})")
    if len(pages) < MIN_PAGES:
        problems.append(f"only {len(pages)} page(s) were rendered (floor "
                        f"{MIN_PAGES}) -- a sample that shrinks to nothing "
                        "reads exactly like a clean sweep")
    if len(shown) < MIN_WORDS:
        problems.append(f"only {len(shown)} distinct word(s) were collected "
                        f"off the pages (floor {MIN_WORDS}). Either the "
                        "renderer stopped drawing or the intersection with "
                        "the site files stopped intersecting")
    if conclusive < MIN_CONCLUSIVE:
        problems.append(f"only {conclusive} word-on-page check(s) came back "
                        f"conclusive (floor {MIN_CONCLUSIVE}); {crowded} hit "
                        "the eighty-result cap and were not counted")

    print(f"  read  {len(pages)} pages across {len(sites)} sites")
    print(f"  asked {len(shown)} distinct words, {conclusive} conclusive "
          f"word-on-page checks")
    print(f"        {tags} subject tags, {tag_pairs} tag/site pairs")
    print(f"        {elsewhere} resolved to the site the word NAMES rather "
          f"than the page showing it")
    print(f"        {crowded} hit the {RESULT_CAP}-result cap and are a "
          f"ranking question, not a findability one")
    for n in notes:
        print(f"  ok    {n}")
    for p in problems:
        print(f"FAIL: {p}")
    if problems:
        print(f"\n{len(problems)} problem(s)")
        return 1
    print("\nOK: every word on a rendered page that its own site file "
          "authors can be found by searching for it, and every subject tag "
          "finds the sites that carry it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
