#!/usr/bin/env python3
"""Check that what a page offers, a page does.

Every other check in this project asks whether a page RENDERS. This one asks
whether it WORKS -- whether the things on it that look like controls are
controls, and whether the things that look like links go anywhere.

The failure it exists for is decor. A renderer writes

    el('span', {}, 'catalog archive rules')

and three words sit at the top of the board in link colour for a year, and
every check stays green, because nothing about that span is an error. It
renders perfectly. It is a lie to the reader, which is the only kind of bug
this project has left that matters.

What counts as a control here is decided by how the engine builds one:

  * ctx.link() produces <a data-synth-href="...">. That is a real link.
  * SYNTH.el(tag, {onclick: fn}) sets the onclick PROPERTY, which a page
    can read back.
  * a renderer may instead call addEventListener, which leaves NO trace a
    page can read -- so this wraps EventTarget.prototype.addEventListener
    before the app loads and marks every node that registers one. The first
    version did not, and confidently reported the assistant's
    suggested-question chips as dead when they had worked all along. A
    checker blind to half the ways a handler is attached does not find
    decor, it invents it.

Those two tell us a node is DEFINITELY live. They cannot tell us it is dead,
because a handler may be delegated from an ancestor -- and this app delegates
from #synth-viewport, so every element has a listener above it somewhere.

They also cannot tell us it WORKS, which is the hole this check ran with for
its first two rounds: anything carrying a handler was dropped from the index
and never pressed, on the reasoning that our own code had promised to do
something. A no-op, an early return, or a handler that throws all pass that
reasoning, and the argument for pressing things in the first place was that
static inspection cannot answer this. It cannot answer it here either.

So the check has two passes:

  1. crawl every site and collect the things that LOOK like controls and are
     not provably live (`inert`), AND the things our own code attached a
     handler to (`handled`) -- both deduped by tag+class+text, because the
     same dead span on forty pages is one bug;
  2. for each distinct one, go to a page carrying it, PRESS IT, and see
     whether anything at all changes -- the route, a single byte of the
     viewport, the scroll position -- and whether the press raised anything.

Nothing changed means nothing happens. From the first bucket that is decor;
from the second it is a no-op, which is the worse of the two, because the
code reads as though it works.

Pass 2 is the whole point. Pass 1 is an index so that pass 2 is a few hundred
clicks instead of ten thousand.

Usage:  python3 .github/scripts/synthnet_function_check.py [--root synthnet]
        [--sites N] [--pages N] [--press N] [--only domain.com]
"""

import argparse
import glob
import json
import os
import pathlib
import re
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


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


# Words that promise something happens. Kept to things a reader would
# actually try to click; "Home" and "About" are here because a nav item that
# does nothing is the worst offender of the lot.
CLICKY = {
    "catalog", "archive", "rules", "reply", "quote", "report", "next", "prev",
    "previous", "more", "search", "login", "log in", "sign in", "sign up",
    "register", "download", "submit", "send", "post", "subscribe", "apply",
    "buy", "add to cart", "checkout", "continue", "back", "home", "about",
    "contact", "help", "faq", "settings", "edit", "delete", "save", "cancel",
    "expand", "collapse", "show more", "read more", "view all", "see all",
    "sort", "filter", "refresh", "retry", "upload", "print", "share",
    "follow", "unfollow", "like", "vote", "flag", "mark read", "menu",
}

# Controls the press pass must not touch, and why. Every entry is a thing
# that works BY changing state this run depends on, so pressing it would
# either destroy the run or make every verdict after it meaningless.
#
# Matched on the control's exact text. Keep this list to things that are
# dangerous, never to things that are merely awkward -- an entry added to
# quiet a finding is the finding.
# Every one of these is a stage of a confirmChain() in app/control.js, the
# only surface on this network that can change anything.
#
# The second stage is the one that fires, so all four are here. The first
# stage of the two whole-store wipes is here as well, because a sweep that
# empties the device at site 30 then checks the remaining 79 against an empty
# store and reports what it finds as fact -- and "pass 2 re-navigates before
# every press, so it can only ever arm them" is a property of today's control
# flow, not a guarantee worth betting the run on.
#
# "Remove" and "Delete" -- the first stages at :698 and :1028 -- are
# deliberately NOT here. They only arm, they are ordinary words that appear
# as real controls elsewhere on the network, and a list that swallows them
# would stop testing those. The point of a skip list is the six things that
# are dangerous, not every word near them.
DO_NOT_PRESS = {
    "Reset everything": "control.js:1146 -- account, posts, sites, packs",
    "This erases everything. Tap again.": "the tap that fires it",
    "Wipe storage": "control.js:1308 -- the same wipe from the other side",
    "Everything goes. Tap again.": "the tap that fires it",
    "Really remove?": "control.js:698 -- removes an imported pack",
    "Really delete?": "control.js:1028 -- deletes a site you authored",
}

# There is deliberately no allowlist of handlers that are ALLOWED to do
# nothing. The one category that genuinely qualifies -- a control already in
# the state pressing it would set, such as the highlighted chip on a filter
# row -- is recognised from its own aria-pressed/aria-current markup in the
# probe, which is a rule the content states about itself rather than a list
# of sites this check has agreed to stop looking at. An empty allowlist that
# nothing ever matches is a check that cannot fire; a full one is a way to
# make findings go away. Neither is wanted here.

# The page-level probe. Returns everything that looks like a control together
# with whether it is one, so the Python side decides and the JS side only
# reports.
PROBE = r"""() => {
  const view = document.getElementById('synth-viewport');
  if (!view) return {error: 'no viewport'};

  /* Returns WHY a node is live, not just that it is, because the three
   * answers get different treatment:
   *
   *   'link'    someone else's job -- synthnet_link_check.py drives the app
   *             and follows every one of these.
   *   'native'  the browser's behaviour, not ours. A <select>, a <details>,
   *             a <form>. Pressing a <form> is not how a form is used.
   *   'handler' OUR code said it would do something when pressed. That is a
   *             promise this check can hold it to, and until the `handled`
   *             bucket below existed it was the one promise nobody checked:
   *             these were dropped from `inert` and never pressed, so a
   *             handler that was a no-op, an early return, or a throw passed
   *             a clean sweep. Static inspection cannot tell a working
   *             handler from an empty one either. Pass 2 presses it.
   *
   * null means no trace of a handler, which does NOT mean dead -- see the
   * delegation note below.
   */
  const isReal = (n) => {
    if (n.dataset && n.dataset.synthHref) return 'link';
    if (n.tagName === 'A' && n.getAttribute('href') &&
        n.getAttribute('href') !== '#') return 'link';
    /* Native tags are classified BEFORE handlers on purpose. A <form> with a
     * submit listener and a <select> with a change listener both carry a
     * handler, and clicking either does nothing, correctly -- putting them
     * in `handled` would report every form on the network as a no-op. */
    if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' ||
        n.tagName === 'SELECT' || n.tagName === 'DETAILS' ||
        n.tagName === 'SUMMARY' || n.tagName === 'LABEL' ||
        n.tagName === 'FORM' || n.tagName === 'OPTION') return 'native';
    if (typeof n.onclick === 'function') return 'handler';
    if (n.__synthListener) return 'handler';
    /* NO ancestor walk. The engine puts one delegated click handler on
     * #synth-viewport to catch [data-synth-href], so "an ancestor has a
     * listener" is true of every element on every page and marking those
     * live turned this check off entirely -- it reported a clean sweep of
     * twelve sites while the dead nav item was still sitting there. Static
     * inspection cannot answer this. Pass 2 clicks the thing. */
    if (n.closest && n.closest('details')) return 'native';
    if (n.closest && n.closest('[data-synth-href]')) return 'link';
    if (n.closest && n.closest('form')) return 'native';
    return null;
  };

  /* A control that is ALREADY in the state pressing it would set. Pressing
   * the highlighted "All" chip on a filter row sets current to what current
   * already is and redraws the identical grid, and that is the chip working.
   *
   * Decided by ARIA rather than by class name on purpose. `tm-chip-on`,
   * `is-active`, `sel`, `here` and `current` are all in use on this network
   * and excluding anything that looks like them would be the third time in
   * this file that widening a filter turned the check off. aria-pressed and
   * aria-current are the markup saying, in the one vocabulary that means
   * exactly this, that the control is already set. These are counted and
   * printed at the end rather than quietly dropped. */
  const alreadySet = (n) => {
    if (!n.getAttribute) return false;
    return n.getAttribute('aria-pressed') === 'true' ||
           n.getAttribute('aria-selected') === 'true' ||
           (n.hasAttribute('aria-current') &&
            n.getAttribute('aria-current') !== 'false');
  };

  const disabledish = (n) => {
    if (n.disabled) return true;
    const cls = String(n.className || '');
    if (/\b(dis|disabled|is-disabled|inactive|off|dead|broken|expired)\b/.test(cls)) return true;
    if (n.getAttribute && n.getAttribute('aria-disabled') === 'true') return true;
    const st = getComputedStyle(n);
    if (st.pointerEvents === 'none') return true;
    if (Number(st.opacity) < 0.6) return true;
    return false;
  };

  // Text that is a heading is not a promise that something happens. A page
  // with an <h2>Contact</h2> is not offering to do anything when you press
  // it, and the first version of this check reported every one of them.
  const LABELS = new Set(['H1','H2','H3','H4','H5','H6','TH','CAPTION',
                          'LEGEND','DT','STRONG','B','EM','I','TITLE']);
  /* NOT span or div. Those are what a nav item is made of -- excluding
   * them would have silently dropped the 252 dead nav items this check
   * exists to find, which is the second time in this file that widening a
   * filter turned the check off. Authored prose is caught by its container
   * instead: markup.js wraps every paragraph it renders in .synth-p. */
  const PROSE = new Set(['P','TD','LI','BLOCKQUOTE','PRE','FIGCAPTION','DD',
                         'SMALL']);
  const inProse = (n) => !!(n.closest && n.closest('.synth-p, .synth-code, blockquote'));

  // The ad layer is decor ON PURPOSE. An advert on this network that does
  // nothing when pressed is not a bug, it is what an advert on a county
  // site in 2026 does.
  const isAd = (n) => !!(n.closest && n.closest(
    '[class*="lv-ad"],[class*="-ad-"],[class*="ad-box"],[class*="adslot"],.ad'));

  // An element whose whole text belongs to a control inside it is that
  // control's wrapper, not a second dead one.
  const wrapsAControl = (n) => {
    for (const c of n.querySelectorAll('button,a,input,select,textarea,[data-synth-href]')) {
      if ((c.textContent || '').trim() === (n.textContent || '').trim()) return true;
      if (typeof c.onclick === 'function') return true;
      if (c.dataset && c.dataset.synthHref) return true;
    }
    return false;
  };

  const out = {inert: [], handled: [], links: [], forms: 0, buttons: 0,
               alreadySet: 0, overflow: 0};

  /* Which one of its kind, so pass 2 can find a textless or repeated
   * control again -- tag+class+text does not identify one of four empty
   * spans. */
  const nthOf = (n, tag) => Array.prototype.indexOf.call(
    view.querySelectorAll(tag + (n.className ? '.' +
      String(n.className).trim().split(/\s+/).join('.') : '')), n);

  // (a) anything the browser says is clickable
  const all = view.querySelectorAll('*');
  for (const n of all) {
    const txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt.length > 60) continue;
    if (n.children.length > 2) continue;            // a container, not a control
    const real = isReal(n);

    /* A node carrying its OWN handler is a control by construction, so none
     * of the looks-like-a-control gates below apply to it. Those gates exist
     * to GUESS at nodes with no handler; this is not a guess. The only open
     * question is whether pressing it does anything, and only pass 2 can
     * answer that.
     *
     * Disabled is excluded because a greyed-out button doing nothing is the
     * button working. Ads are excluded for the same reason as below. Width
     * is excluded because a control nobody can hit is a different bug. */
    if (real === 'handler' && alreadySet(n)) { out.alreadySet++; continue; }
    if (real === 'handler' && !disabledish(n) && !isAd(n) &&
        n.getBoundingClientRect().width >= 8) {
      // Counted, not silently dropped, if a page ever exceeds the cap.
      if (out.handled.length >= 60) { out.overflow++; continue; }
      out.handled.push({
        tag: n.tagName, cls: String(n.className || '').slice(0, 40),
        text: txt.slice(0, 48), nth: nthOf(n, n.tagName),
        why: (typeof n.onclick === 'function') ? 'onclick' : 'addEventListener'
      });
      continue;
    }
    /* A control with NO text is still a control. media.js draws its
     * transport row as empty spans styled into shapes, and skipping
     * textless nodes meant the volume control -- dead, next to three live
     * ones -- was invisible to this check while it reported the row clean.
     * An empty node only counts if the browser says it is clickable or it
     * is a button, because otherwise every spacer div on the network is a
     * finding. */
    if (!txt) {
      const est = getComputedStyle(n);
      const isBtn = n.tagName === 'BUTTON' ||
                    (n.getAttribute && n.getAttribute('role') === 'button');
      if (est.cursor !== 'pointer' && !isBtn) continue;
      if (n.getBoundingClientRect().width < 8) continue;
    }
    const st = getComputedStyle(n);
    const pointer = st.cursor === 'pointer';
    const clicky = CLICKY_WORDS.has(txt.toLowerCase());
    const tag = n.tagName;
    const controlish = tag === 'BUTTON' ||
                       (n.getAttribute && n.getAttribute('role') === 'button');
    if (!pointer && !clicky && !controlish) continue;
    if (!pointer && LABELS.has(tag)) continue;
    /* Prose is not a control either. A <p> reading "NEXT" in an old-web
     * table, or a news kicker reading "ABOUT", is content that happens to
     * use a word people click. Without a pointer cursor there is nothing
     * offering to do anything. */
    if (!pointer && (PROSE.has(tag) || inProse(n))) continue;
    if (isAd(n) || wrapsAControl(n)) continue;
    if (real || disabledish(n)) continue;
    // A bare word inside a real link's label is not itself decor.
    out.inert.push({
      tag: tag, cls: String(n.className || '').slice(0, 40),
      text: txt.slice(0, 48),
      nth: nthOf(n, tag),
      why: pointer ? 'cursor:pointer' : (controlish ? 'is a ' + tag.toLowerCase()
                                                    : 'reads as a control')
    });
    if (out.inert.length > 40) break;
  }

  for (const a of view.querySelectorAll('[data-synth-href]')) {
    out.links.push(a.dataset.synthHref);
  }
  out.forms = view.querySelectorAll('form').length;
  out.buttons = view.querySelectorAll('button').length;
  return out;
}"""


# A cheap fingerprint of the viewport: length plus one character from the
# middle. Enough to notice a re-render, cheap enough to take 200 times.
#
# Written once and interpolated into both SNAP and SNAP_AND_CLICK, because
# the two are compared against each other and a fingerprint that drifts
# between them would report every control on the network as live or as dead,
# with nothing in between to notice.
FINGERPRINT = r"""(v) => {
  const h = v ? v.innerHTML : '';
  /* A form field's VALUE is a DOM property and is not in innerHTML, so a
   * control whose whole job is to fill or clear a form is invisible to a
   * fingerprint taken from the markup alone. The control panel's "New /
   * clear" button was reported as a no-op for exactly this reason: it sets
   * .value = '' on five fields and the page it draws does not change by one
   * byte. Read the values too, and the button is doing its job. */
  let vals = 0, vlen = 0;
  if (v) {
    for (const f of v.querySelectorAll('input, textarea, select')) {
      const s = String(f.value == null ? '' : f.value);
      vlen += s.length;
      for (let i = 0; i < s.length; i++) { vals = (vals * 31 + s.charCodeAt(i)) | 0; }
      vals = (vals * 31 + (f.checked ? 1 : 2)) | 0;
    }
  }
  /* Scroll counts. A table-of-contents entry calls scrollIntoView and
   * changes neither the DOM nor the route, and the first version of this
   * check called every one of them dead. Jumping the reader to a heading is
   * a thing happening. */
  return {len: h.length, sig: h.length ? h.charCodeAt(h.length >> 1) : 0,
          route: location.hash,
          scroll: (v ? v.scrollTop : 0) + window.scrollY,
          vals: vals, vlen: vlen};
}"""

# The fields every comparison must agree on. Adding one to FINGERPRINT and
# forgetting it here is how a check quietly stops looking at something.
FP_KEYS = ("len", "sig", "route", "scroll", "vals", "vlen")

SNAP = """() => (%s)(document.getElementById('synth-viewport'))""" % FINGERPRINT

SNAP_AND_CLICK = r"""(want) => {
  const view = document.getElementById('synth-viewport');
  const nodes = Array.from(view.querySelectorAll(want.tag));
  var n = nodes.find(function (x) {
    return (x.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48) === want.text &&
      String(x.className || '').slice(0, 40) === want.cls;
  });
  /* A control with no text cannot be found again by its text. Pass 1 also
   * records which one of its kind it was; media.js draws its transport row
   * as empty spans and the dead volume control among them is only
   * identifiable by position. */
  if (!n && want.text === '' && want.nth >= 0 && want.cls) {
    var same = view.querySelectorAll(
      want.tag + '.' + want.cls.trim().split(/\s+/).join('.'));
    if (want.nth < same.length) { n = same[want.nth]; }
  }
  if (!n) return {gone: true};

  /* Give the control something to work with before pressing it.
   *
   * The assistant's Send button is the case: submit() starts
   * `if (!text) { return; }`, so pressing Send with an empty box correctly
   * does nothing, and the check called it a no-op. The tempting fix is to
   * allowlist the word "Send", which would also silence a Send button that
   * is genuinely dead on some other site -- exactly the bug this exists to
   * find. So type into the box instead. A composer that is only ever
   * pressed empty is not being tested at all.
   *
   * Nearest empty text field going up three ancestors, no further: beyond
   * that we would start filling in a search box on the other side of the
   * page and pressing an unrelated button. */
  var filled = false;
  var hop = n, depth = 0;
  while (hop && depth < 4) {
    var box = hop.querySelector &&
      hop.querySelector('textarea, input[type="text"], input[type="search"], input:not([type])');
    if (box && !box.value) {
      box.value = 'verity';
      box.dispatchEvent(new Event('input', {bubbles: true}));
      box.dispatchEvent(new Event('change', {bubbles: true}));
      filled = true;
      break;
    }
    hop = hop.parentElement;
    depth++;
  }

  /* Snapshot AFTER filling, so the typing is not mistaken for the press
   * having done something. */
  const before = (FINGERPRINT)(view);
  before.filled = filled;
  n.click();
  return before;
}""".replace("FINGERPRINT", FINGERPRINT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--sites", type=int, default=0, help="limit sites (0 = all)")
    ap.add_argument("--pages", type=int, default=10, help="pages per site")
    ap.add_argument("--only", default="", help="domain, or a comma list")
    ap.add_argument("--type", default="", help="only sites of this type")
    ap.add_argument("--press", type=int, default=0,
                    help="cap distinct presses (0 = no cap); the number "
                         "skipped is always printed")
    ap.add_argument("--json", default="", help="write findings here")
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

    findings = {}       # domain -> list of finding dicts
    stats = {"pages": 0, "sites": 0, "inert": 0, "handled": 0, "notfound": 0,
             "noop": 0, "throws": 0, "skipped": 0, "already": 0, "unsafe": 0,
             "overflow": 0, "typed": 0}
    errors = []

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 360, "height": 900})
            page.on("pageerror", lambda e: errors.append(str(e)))
            # BEFORE the app loads: record every node that registers an
            # interactive listener. add_init_script only applies to the next
            # navigation, so this has to precede goto -- putting it after was
            # the bug that made every addEventListener control look dead.
            page.add_init_script("""
              (function () {
                var orig = EventTarget.prototype.addEventListener;
                var LIVE = {click:1, submit:1, change:1, input:1, keydown:1,
                            keypress:1, mousedown:1, pointerdown:1, toggle:1};
                EventTarget.prototype.addEventListener = function (t, f, o) {
                  if (LIVE[t]) { try { this.__synthListener = true; } catch (e) {} }
                  return orig.call(this, t, f, o);
                };
              })();
            """)
            page.goto(f"http://127.0.0.1:{port}/index.html",
                      wait_until="networkidle")
            page.wait_for_timeout(600)
            page.evaluate("window.CLICKY_WORDS = new Set(%s)"
                          % json.dumps(sorted(CLICKY)))

            sites = page.evaluate(
                "() => SYNTH.data.list().map(r => ({d: r.domain, t: r.type}))")
            if args.only:
                want = {d.strip() for d in args.only.split(",") if d.strip()}
                sites = [s for s in sites if s["d"] in want]
            if args.type:
                kinds = {t.strip() for t in args.type.split(",") if t.strip()}
                sites = [s for s in sites if s["t"] in kinds]
            if args.sites:
                sites = sites[:args.sites]

            notfound = {}

            def _shape(t):
                # The whole page, with digits flattened and the requested
                # path removed.
                #
                # Three versions of this were wrong in three ways. The first
                # matched a list of phrases and missed social's wording. The
                # second took the first forty words, which on 27 sites is the
                # masthead and the nav -- every one of those front pages was
                # called a dead end. The third added a length window and
                # still caught gridfallswap's /search, which is a real page
                # that happens to be short, because an empty search form is
                # mostly chrome too.
                #
                # A not-found page is not LIKE the probe's answer, it IS the
                # probe's answer. Compare the whole thing. Digits go because
                # these pages carry live counters; the path goes because some
                # renderers echo it back.
                return re.sub(r"\d+", "#", " ".join(t.lower().split()))

            def _same(a, b):
                return bool(a) and bool(b) and a == b

            for site in sites:
                dom, typ = site["d"], site["t"]
                stats["sites"] += 1
                try:
                    page.evaluate(
                        "(u) => SYNTH.engine.navigate(u, {push: false})",
                        "synth://%s/zzz-no-such-path-9417/zzz" % dom)
                    page.wait_for_timeout(150)
                    nft = page.inner_text("#synth-viewport")
                    notfound[dom] = _shape(
                        nft.replace("zzz-no-such-path-9417", " ").replace("zzz", " "))
                except Exception:
                    notfound[dom] = None
                seen, queue = set(), ["/"]
                while queue and len(seen) < args.pages:
                    path = queue.pop(0)
                    if path in seen:
                        continue
                    seen.add(path)
                    errors.clear()
                    try:
                        page.evaluate(
                            "(u) => SYNTH.engine.navigate(u, {push: false})",
                            "synth://%s%s" % (dom, path))
                        page.wait_for_timeout(190)
                    except Exception as exc:
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "threw",
                             "detail": str(exc)[:160]})
                        continue
                    stats["pages"] += 1
                    if errors:
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "console",
                             "detail": errors[0][:160]})

                    text = page.inner_text("#synth-viewport")
                    low = text.lower()
                    # ASK THE SITE what its not-found page looks like,
                    # rather than guessing at the words.
                    #
                    # This used to match a list of phrases. It had four and
                    # missed social's "Sorry! This page is not available.",
                    # so a social route serving nothing read as a clean
                    # sweep -- the adversarial pass caught that, not this
                    # check. Widening the list then flagged clipvault's
                    # front page, because a video site says "not available"
                    # about videos. Words are the wrong instrument. Each
                    # site is asked for a path that certainly does not
                    # exist, once, and anything that comes back looking like
                    # that answer is a dead end.
                    probe_path = path.strip("/").split("/")[0]
                    if _same(_shape(text.replace(probe_path, " ")),
                             notfound.get(dom)):
                        stats["notfound"] += 1
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "dead-end",
                             "detail": text[:90].replace("\n", " ")})
                        continue

                    probe = page.evaluate(PROBE)
                    if probe.get("error"):
                        continue
                    for item in probe["inert"]:
                        stats["inert"] += 1
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "inert", "type": typ,
                             "tag": item["tag"], "cls": item["cls"],
                             "text": item["text"], "why": item["why"],
                             "nth": item.get("nth", -1),
                             "at": "synth://%s%s" % (dom, path)})
                    # Controls our own code claims are live. They go through
                    # exactly the same press pass; the only difference is
                    # what a silent one is called at the end.
                    stats["already"] += probe.get("alreadySet", 0)
                    stats["overflow"] += probe.get("overflow", 0)
                    for item in probe.get("handled", []):
                        if item["text"] in DO_NOT_PRESS:
                            stats["unsafe"] += 1
                            continue
                        stats["handled"] += 1
                        findings.setdefault(dom, []).append(
                            {"path": path, "kind": "handled", "type": typ,
                             "tag": item["tag"], "cls": item["cls"],
                             "text": item["text"], "why": item["why"],
                             "nth": item.get("nth", -1),
                             "at": "synth://%s%s" % (dom, path)})
                    # Renderers spell an internal link two ways. Nearly all of
                    # them emit a bare path, "/faq". app/control.js emits the
                    # whole thing, "synth://control.verity.net/packs" -- and a
                    # startswith("/") filter dropped every one of those, so
                    # the control panel was crawled to exactly its front door
                    # and the buttons on the four panels behind it had never
                    # been pressed. It is the ONE surface on this network that
                    # can change anything, and this check was reporting a
                    # clean sweep of it while never going inside. Both
                    # spellings, and a link to another domain is the link
                    # check's job, not this crawl's.
                    for href in probe["links"]:
                        here = "synth://%s/" % dom
                        if href.startswith(here):
                            href = href[len(here) - 1:]
                        elif not href.startswith("/"):
                            continue
                        if href not in seen and len(seen) + len(queue) < args.pages:
                            queue.append(href)

            # ---- pass 2: press them --------------------------------------
            #
            # One instance of each distinct candidate, on a page carrying it.
            # A control is real if pressing it moves the route, a byte of the
            # viewport, the scroll position, or the value of a form field.
            # This is the only test delegation cannot fool.
            #
            # BOTH buckets come through here. `inert` is a suspicion -- we
            # found no handler and want to know. `handled` is a promise --
            # our code attached a handler and we are holding it to that. The
            # press is identical; only the word for a silent one differs.
            #
            # The dedupe key is (type, tag, class, text), and the renderers
            # are shared across sites, so a control drawn by forum.js is
            # pressed once for the whole forum type rather than once per
            # forum. That is what keeps this affordable -- and it is also its
            # blind spot: if one site's copy of a shared control is broken
            # and another's works, the working one may be the instance
            # pressed.
            candidates = {}
            for dom, items in findings.items():
                for f in items:
                    if f["kind"] in ("inert", "handled"):
                        candidates.setdefault(
                            (f.get("type"), f["tag"], f["cls"], f["text"]), f)

            if args.press and len(candidates) > args.press:
                # No silent caps. A cap that is printed is a known limit; a
                # cap that is not reads as a clean sweep.
                keep = list(candidates.items())[:args.press]
                stats["skipped"] = len(candidates) - len(keep)
                candidates = dict(keep)

            verdicts = {}
            press_errors = {}
            for key, f in candidates.items():
                try:
                    page.evaluate(
                        "(u) => SYNTH.engine.navigate(u, {push: false})",
                        f["at"])
                    page.wait_for_timeout(200)
                    # Clear immediately before the press, so a handler that
                    # throws is attributed to the control that threw rather
                    # than to whatever page is navigated to next. The
                    # per-navigation clear above happens too early for that.
                    errors.clear()
                    shot = page.evaluate(SNAP_AND_CLICK,
                                         {"tag": f["tag"], "text": f["text"],
                                          "cls": f["cls"],
                                          "nth": f.get("nth", -1)})
                    if shot.get("gone"):
                        verdicts[key] = "vanished"
                        continue
                    if shot.get("filled"):
                        stats["typed"] += 1
                    # POLL, do not sample once. The assistant's chips repaint
                    # about 300ms after the press and a single look at 240ms
                    # called every one of them dead. A control is allowed to
                    # take a moment; it is not allowed to take forever.
                    verdict = "decor"
                    for _ in range(9):
                        page.wait_for_timeout(180)
                        after = page.evaluate(SNAP)
                        if any(after[k] != shot[k] for k in FP_KEYS):
                            verdict = "live"
                            break
                    # A handler that threw is not live even if the half of it
                    # that ran before the throw repainted something.
                    if errors:
                        verdict = "threw"
                        press_errors[key] = errors[0][:160]
                    verdicts[key] = verdict
                except Exception as exc:
                    verdicts[key] = "error: " + str(exc)[:60]

            browser.close()
    finally:
        srv.shutdown()

    # What a silent press MEANS depends on which bucket it came from, which
    # is the only reason the two are tracked separately at all.
    #
    #   inert   + silent  -> decor. Nothing was listening and nothing
    #                        happened: three words in link colour.
    #   handled + silent  -> a no-op. Something WAS listening and still
    #                        nothing happened, which is the worse bug of the
    #                        two, because the code reads as if it works.
    #   either  + threw   -> the handler raised. Named separately so nobody
    #                        has to guess which press produced the console
    #                        line.
    def _relabel(f):
        key = (f.get("type"), f["tag"], f["cls"], f["text"])
        # Not in verdicts means never pressed: over the --press cap, which is
        # counted and printed above.
        if key not in verdicts:
            return None
        v = verdicts[key]
        if v == "threw":
            g = dict(f)
            g["kind"] = "throws"
            g["detail"] = press_errors.get(key, "")
            return g
        if v != "decor":
            return None                        # live, vanished, or untestable
        if f["kind"] == "handled":
            g = dict(f)
            g["kind"] = "noop"
            return g
        return f

    live = sum(1 for v in verdicts.values() if v == "live")
    silent = sum(1 for v in verdicts.values() if v == "decor")
    threw = sum(1 for v in verdicts.values() if v == "threw")
    other = len(verdicts) - live - silent - threw
    n_inert = sum(1 for k, f in candidates.items() if f["kind"] == "inert")
    n_handled = len(candidates) - n_inert
    print(f"pressed {len(candidates)} distinct controls "
          f"({n_inert} with no handler found, {n_handled} our code said were "
          f"live): {live} did something, {silent} did nothing at all, "
          f"{threw} threw, {other} could not be tested")
    if other:
        # Say WHY they could not be tested. "Could not be tested" is a
        # number that reads like a rounding error and can hide a bucket the
        # check has stopped reaching.
        gone = sum(1 for v in verdicts.values() if v == "vanished")
        broke = other - gone
        print(f"    of those, {gone} were no longer on the page when pass 2 "
              f"went back for them, {broke} errored in the harness")
    if stats["skipped"]:
        print(f"  NOT pressed: {stats['skipped']} over the --press cap")
    print()

    # Only the ones that did nothing, or threw, survive as findings.
    for dom in list(findings):
        kept = []
        for f in findings[dom]:
            if f["kind"] in ("inert", "handled"):
                g = _relabel(f)
                if g:
                    kept.append(g)
            else:
                kept.append(f)
        findings[dom] = kept
        if not findings[dom]:
            del findings[dom]
    for name in ("inert", "noop", "throws"):
        stats[name] = sum(1 for items in findings.values()
                          for f in items if f["kind"] == name)

    # Group the control findings: the same span on 40 pages is one bug.
    groups = {}
    for dom, items in findings.items():
        for f in items:
            if f["kind"] not in ("inert", "noop", "throws"):
                key = ("%s|%s|%s" % (f["kind"], dom, f.get("path", "")))
                groups.setdefault(key, {"kind": f["kind"], "domains": set(),
                                        "sample": f, "count": 0})
            else:
                key = "%s|%s|%s|%s|%s" % (f["kind"], f.get("type"), f["tag"],
                                          f["cls"], f["text"])
                groups.setdefault(key, {"kind": f["kind"], "domains": set(),
                                        "sample": f, "count": 0})
            groups[key]["domains"].add(dom)
            groups[key]["count"] += 1

    ordered = sorted(groups.items(), key=lambda kv: -kv[1]["count"])
    print(f"swept {stats['sites']} sites, {stats['pages']} pages, "
          f"{stats['handled']} handler controls seen")
    # Say out loud what was seen and not pressed, so "everything works" never
    # rests on a number nobody printed.
    if stats["already"]:
        print(f"  {stats['already']} not pressed: already the selected one "
              "(aria-pressed / aria-current)")
    if stats["unsafe"]:
        print(f"  {stats['unsafe']} not pressed: on the DO_NOT_PRESS list")
    if stats["overflow"]:
        print(f"  {stats['overflow']} not indexed: over the per-page cap")
    # If the fill selector in SNAP_AND_CLICK ever stops matching, this drops
    # to zero and every composer on the network quietly goes back to being
    # pressed empty. A number nobody prints is a number nobody notices.
    print(f"  {stats['typed']} presses typed into a text box first")
    print(f"  {stats['inert']} things that look like controls and are not")
    print(f"  {stats['noop']} controls with a handler that does nothing")
    print(f"  {stats['throws']} controls whose handler threw")
    print(f"  {stats['notfound']} navigations that dead-ended\n")
    for key, g in ordered[:60]:
        s = g["sample"]
        where = ", ".join(sorted(g["domains"])[:3])
        if len(g["domains"]) > 3:
            where += f" +{len(g['domains']) - 3}"
        if g["kind"] in ("inert", "noop", "throws"):
            lead = {"inert": "  x", "noop": " NOOP x",
                    "throws": "THREW x"}[g["kind"]]
            print(f"{lead}{g['count']:<4} [{s.get('type','?')}] "
                  f"<{s['tag'].lower()} class=\"{s['cls']}\"> "
                  f"{s['text']!r}  ({s['why']})")
            if s.get("detail"):
                print(f"         {str(s['detail'])[:110]}")
            print(f"         {where}  e.g. {s.get('at', s.get('path', ''))}")
        else:
            print(f"  x{g['count']:<4} {g['kind']}: {s.get('path','')} "
                  f"{str(s.get('detail',''))[:70]!r}")
            print(f"         {where}")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(
            {"stats": stats,
             "groups": [{"key": k, "kind": v["kind"], "count": v["count"],
                         "domains": sorted(v["domains"]), "sample": v["sample"]}
                        for k, v in ordered]}, indent=1))
        print(f"\nwrote {args.json}")

    if not groups:
        print("\nOK: everything that looks like a control is one, and every "
              "control our code claims is live does something when pressed.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
