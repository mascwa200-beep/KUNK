#!/usr/bin/env python3
"""Open dist/synthnet.html the way a person would: off a file manager, offline.

The standalone build is the mode that needs no install and no server -- copy
one file to a phone, tap it. CI checked its SIZE and nothing else, which is
to say CI checked that the file existed.

That gap mattered the moment the renderers stopped being listed in
index.html. Served, app/render.js fetches a type's renderer and stylesheet on
demand; a single file has nothing to fetch from, so tools/build.py inlines
every entry in app/loadmap.js instead. The reason that was never done before
was a belief that deferring the renderers "costs the single-file standalone
build". It does not -- SYNTH.render.has() is true for every inlined type, so
ensure() resolves without a fetch -- but a belief and an assertion are not
the same thing, and only one of them fails when it stops being true.

So: a real file:// load, EVERY type and every route its renderer serves,
and two things asserted that a served run cannot check.

It rendered eight front doors until this was written -- eight of the
twenty-one types, the eight that happened to be built first, covering 37 of
the 109 sites. Two thirds of the network had never been rendered in the mode
the project leads with, and the covered third only at its index. Nothing said
so, because the list was written by hand and nothing counted it.

The list is derived now, from synthnet_routes_check.py, which derives it from
the renderers. A type in app/loadmap.js that does not get rendered here is a
build failure.

  * Nothing goes over the network. Not one request that is not file://.
    A renderer that slipped out of the bundle would be fetched from a path
    that does not exist next to the file, and the page would be a notice box
    on someone's phone with no way to diagnose it.
  * Every type renders with its stylesheet applied, not just with text on
    the screen. An inlined <style> that went missing leaves a page that
    still has all its words.

Usage:  python3 .github/scripts/synthnet_standalone_check.py
        [--bundle synthnet/dist/synthnet.html]
"""

import argparse
import glob
import json
import pathlib
import re
import sys

# The types are not listed here. They come from app/loadmap.js -- the one
# table of type -> {js, css} that build.py inlines from -- and their routes
# come from synthnet_routes_check.py, which parses them out of the renderers.
# A hand-written list is what let this sit at eight.
#
# Two routes cannot be reached from a static id and are named, with reasons,
# rather than quietly skipped.
NO_STATIC_ROUTE = {
    ("wiki", "diff"):
        "/diff/<article>/<rev> needs a revision number that only exists once "
        "revisionsFor() has run. The claims check follows the links /changes "
        "offers, which is the only way anything can reach it.",
}

# Which collection under site.data supplies the id for a route segment, per
# type. Same job as probes_for() in the smoke check, kept here because this
# file picks ONE site per type rather than sweeping all of them.
ID_SOURCE = {
    ("aggregator", "board"): "boards",
    ("aggregator", "item"): "links",
    ("blog", "post"): "posts",
    ("board", "t"): "threads",
    ("chat", "c"): "channels",
    ("forum", "board"): "boards",
    ("forum", "topic"): "topics",
    ("mail", "f"): "folders",
    ("mail", "m"): "messages",
    ("market", "c"): "cats",
    ("market", "l"): "listings",
    ("media", "watch"): "videos",
    ("media", "channel"): "channels",
    ("news", "article"): "articles",
    ("news", "section"): "sections",
    ("news", "live"): "live",
    ("news", "factcheck"): "factchecks",
    ("newsletter", "i"): "issues",
    ("portal", "s"): "services",
    ("qa", "q"): "questions",
    ("qa", "tag"): "tags",
    ("shop", "c"): "categories",
    ("shop", "p"): "products",
    ("social", "post"): "posts",
    ("stream", "c"): "channels",
    ("stream", "w"): "videos",
    ("wiki", "wiki"): "articles",
    ("wiki", "history"): "articles",
    ("wiki", "talk"): "articles",
    ("wiki", "category"): "categories",
    ("wire", "d"): "dispatches",
    ("wire", "cat"): "categories",
}

# Routes whose second segment is not an id at all.
LITERAL_ARG = {
    ("forum", "account"): "register",
    ("wire", "kw"): "62",
}

PROBE = r"""(type) => {
  const v = document.getElementById('synth-viewport');
  const page = v && v.querySelector('.synth-page');
  if (!page) return {ok: false, why: 'no .synth-page element'};
  const text = (v.innerText || '').trim();
  for (const notice of ['Unsupported site type',
                        'This page could not be displayed']) {
    if (text.indexOf(notice) !== -1) {
      return {ok: false, why: 'rendered the "' + notice + '" notice'};
    }
  }
  if (text.length < 120) {
    return {ok: false, why: 'rendered only ' + text.length + ' characters'};
  }

  /* Is the skin in the bundle, and does it do anything?
   *
   * This used to ask whether .synth-page's font-family contained "Times",
   * on the theory that an unstyled page is the browser default serif. That
   * held for exactly as long as the eight types checked were the eight
   * sans-serif ones. news.css sets Georgia/Times on purpose, newsletter.css
   * sets Iowan Old Style, portal.css Georgia; page.css sets Courier on an
   * element inside .synth-page rather than on it; blog.css says inherit.
   * Extending the sweep to all twenty-one made the heuristic call five
   * correctly-skinned types unstyled.
   *
   * So: find the skin build.py inlined for this type, switch it off, and
   * see whether anything on the page moves. That is the thing the check
   * means, rather than a guess that stands in for it. */
  const st = document.querySelector('style[data-synth-skin="' + type + '"]');
  if (!st) {
    return {ok: false,
            why: 'no <style data-synth-skin="' + type + '"> in the bundle'};
  }
  const sample = [page].concat(
    Array.prototype.slice.call(page.querySelectorAll('*'), 0, 24));
  const PROPS = ['font-family', 'font-size', 'color', 'background-color',
                 'padding-top', 'margin-top', 'border-top-width',
                 'text-transform', 'letter-spacing'];
  const snap = () => sample.map(el => {
    const cs = getComputedStyle(el);
    return PROPS.map(pr => cs.getPropertyValue(pr)).join('|');
  }).join('\n');

  const on = snap();
  st.disabled = true;
  const off = snap();
  st.disabled = false;
  if (on === off) {
    return {ok: false,
            why: 'the inlined skin for ' + type + ' changes nothing on this '
                 + 'page -- it is in the bundle and not applying'};
  }
  return {ok: true, chars: text.length};
}"""


def launch(pw):
    try:
        return pw.chromium.launch()
    except Exception as first:
        found = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")) + \
            sorted(glob.glob("/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell"))
        if not found:
            raise first
        return pw.chromium.launch(executable_path=found[-1])


def load_routes(scripts, root):
    """The derived route table, from the check that owns it."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "routes", scripts / "synthnet_routes_check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.derive(root)


def loadmap_types(root):
    """Every type build.py inlines, read off app/loadmap.js."""
    text = (root / "app" / "loadmap.js").read_text(encoding="utf-8")
    return set(re.findall(r"^\s*(\w+)\s*:\s*\{", text, re.M))


def pick_sites(root):
    """One site per type -- the one with the most authored data, so a route
    that needs an id is most likely to have one to use."""
    best = {}
    for f in sorted((root / "net" / "sites").glob("*/site.json")):
        site = json.loads(f.read_text(encoding="utf-8"))
        typ, dom = site.get("type"), site.get("domain")
        if not typ or not dom:
            continue
        size = len(json.dumps(site.get("data") or {}))
        if typ not in best or size > best[typ][2]:
            best[typ] = (dom, site.get("data") or {}, size)
    return {t: (d, data) for t, (d, data, _) in best.items()}


def first_id(data, key):
    seq = data.get(key)
    if isinstance(seq, list):
        for row in seq:
            if isinstance(row, dict) and row.get("id") is not None:
                return str(row["id"])
    return None


def build_targets(routes, sites, skipped):
    """[(type, url, label)] -- a front door and every route, per type."""
    out = []
    for typ in sorted(sites):
        dom, data = sites[typ]
        out.append((typ, f"synth://{dom}/", "/"))
        for seg in sorted(routes.get(typ) or ()):
            if (typ, seg) in NO_STATIC_ROUTE:
                skipped.append((typ, seg, NO_STATIC_ROUTE[(typ, seg)]))
                continue
            arg = LITERAL_ARG.get((typ, seg))
            if arg is None:
                key = ID_SOURCE.get((typ, seg))
                arg = first_id(data, key) if key else None
            if arg is None:
                # A route with no second segment -- /changes, /cart, /catalog.
                out.append((typ, f"synth://{dom}/{seg}", "/" + seg))
            else:
                out.append((typ, f"synth://{dom}/{seg}/{arg}",
                            f"/{seg}/{arg}"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", default="synthnet/dist/synthnet.html")
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    scripts = pathlib.Path(__file__).resolve().parent
    bundle = pathlib.Path(args.bundle).resolve()
    if not bundle.is_file():
        print(f"FAIL: {args.bundle} does not exist")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: playwright is not installed")
        return 1

    routes = load_routes(scripts, root)
    sites = pick_sites(root)
    skipped = []
    targets = build_targets(routes, sites, skipped)

    problems = []
    offsite = []
    errors = []

    # The floor. A type build.py inlines and this never renders is exactly
    # the hole that left thirteen of twenty-one unchecked for as long as
    # there have been twenty-one.
    inlined = loadmap_types(root)
    for t in sorted(inlined - set(sites)):
        problems.append(
            f"{t} is in app/loadmap.js and no site of that type exists to "
            "render it off file://")
    for t in sorted(set(sites) - inlined):
        problems.append(
            f"there are {t} sites and {t} is not in app/loadmap.js, so the "
            "bundle does not carry its renderer")

    with sync_playwright() as pw:
        browser = launch(pw)
        page = browser.new_page(viewport={"width": 360, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console",
                lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("request",
                lambda r: None if r.url.startswith("file:") else offsite.append(r.url))

        # No server. No --root. The file, opened.
        page.goto("file://" + str(bundle), wait_until="load")
        page.wait_for_timeout(1200)

        if not page.evaluate("() => !!(window.SYNTH && SYNTH.engine)"):
            print("FAIL: the bundle loaded but SYNTH.engine is not there")
            browser.close()
            return 1

        last_type = None
        per_type = {}
        for kind, url, label in targets:
            if kind != last_type:
                last_type = kind
                per_type[kind] = 0
            # navigate() resolves after the page is committed, and Playwright
            # awaits a returned promise -- so this waits for the real thing
            # rather than for a guess at how long it takes.
            page.evaluate(
                "(u) => SYNTH.engine.navigate(u, {push: false})", url)
            page.wait_for_timeout(120)
            got = page.evaluate(PROBE, kind)
            if got.get("ok"):
                per_type[kind] += 1
            else:
                problems.append(f"{kind} {url}: {got.get('why')}")
                print(f"  FAIL {kind:<11} {label:<26} {got.get('why')}")
        for kind in sorted(per_type):
            if per_type[kind]:
                print(f"  ok   {kind:<11} {per_type[kind]:>2} route(s)")

        browser.close()

    if offsite:
        problems.append(
            "the standalone file made %d request(s) that were not file:// -- "
            "it is not self-contained: %s"
            % (len(offsite), ", ".join(sorted(set(offsite))[:4])))
    if errors:
        problems.append("console error off file://: " + errors[0][:160])

    print()
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    for typ, seg, why in skipped:
        print(f"  --   {typ} /{seg}/ not rendered: {why}")
    if len(skipped) != len(NO_STATIC_ROUTE):
        print(f"FAIL: {len(NO_STATIC_ROUTE)} route(s) are listed as "
              f"unreachable from a static id and {len(skipped)} were "
              "skipped -- an entry that never matches is one nobody re-reads")
        return 1
    print(f"OK: {len(targets)} routes across {len(sites)} site types render "
          "off file:// with no server, no network and no console errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
