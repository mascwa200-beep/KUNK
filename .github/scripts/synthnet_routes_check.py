#!/usr/bin/env python3
"""What paths a type serves is written down five times and derived none.

The renderers decide. `synthnet/app/types/<type>.js` branches on `ctx.path`
and that is what happens at runtime. Everywhere else the same fact is
restated by hand:

  synthnet/tools/validate.py PATH_PREFIXES    -- called the authority
  .github/scripts/synthnet_link_check.py      -- a copy, drift-checked
  synthnet/docs/AUTHORING.md                  -- a table, unenforced
  .github/scripts/synthnet_smoke.py TYPE_PROBES -- unenforced
  synthnet/app/live.js ROLE_PATH              -- a comment
  synthnet/tools/build.py                     -- a comment

Only one pair of those is checked against each other. The renderers, which
are the thing that is true, are read by nobody.

That is not theoretical. AUTHORING.md's table is missing `modlog`, `faq`,
`search`, `members` and `account` for forum, `cart` for shop, `catalog` for
board, `kw` for wire, five routes for media, three for social -- and has no
`control` row at all, for a type that is in PATH_PREFIXES. TYPE_PROBES says
in a comment that it is kept in sync with that table, and it is not, in
either direction.

The cost of a table being wrong is not that a doc reads badly. A segment a
renderer serves and PATH_PREFIXES lacks is a working link the link check
calls dead. A PATH_PREFIXES entry with no branch behind it is a path the
link check waves through to a 404. And a route absent from TYPE_PROBES is a
page the smoke sweep never loads -- which is how a rule that has matched
`[url=` since the day it was written sat over a page rendering raw markup.

So this derives the table from the renderers and makes the copies answer to
it.

Usage:  python3 .github/scripts/synthnet_routes_check.py [--root synthnet]
        python3 .github/scripts/synthnet_routes_check.py --print
"""
import argparse
import pathlib
import re
import sys

# `var path = ctx.path || []`, `var p = (ctx.path || []).slice(0)`,
# `var path = arr(ctx.path)`. All three spellings are in use.
BIND = re.compile(r"var\s+([A-Za-z_]\w*)\s*=\s*[^;\n]*\bctx\.path\b")

# `var head = path.length ? String(path[0]) : ''` -- control.js hoists the
# segment into its own variable and then compares that.
ALIAS = re.compile(r"var\s+([A-Za-z_]\w*)\s*=\s*[^;\n]*\b%s\[0\]")

# The literal a branch compares the first segment against.
def seg_re(name):
    return re.compile(r"(?<!typeof )\b" + re.escape(name) +
                      r"\[0\]\s*===?\s*'([^']*)'")


def alias_re(name):
    return re.compile(r"(?<!typeof )\b" + re.escape(name) +
                      r"\s*===?\s*'([^']*)'")


# A renderer with no literal first segment at all is not broken -- `page`
# serves `/` and `/<page-id>`, `dash` serves only `/`. Both are correct with
# an empty set, and PATH_PREFIXES says so (None and set() respectively). Any
# OTHER renderer coming back empty means the parse missed it.
EXPECT_EMPTY = {"page", "dash"}

# Floors. The failure this file exists to avoid is its own: a regex that
# stops matching reports that every table agrees.
MIN_RENDERERS = 20
# 58 routes today. The first draft set this to 60 -- a number picked before
# anything had been counted -- and it fired on the first run, which is the
# floor doing its job on its own author.
MIN_SEGMENTS = 50

# The one route that cannot have a static probe, and why. An allowlist with
# nothing in it is a check that cannot fire; an allowlist with an unexplained
# entry is a check nobody reads. This has one entry and a reason.
NO_STATIC_PROBE = {
    ("wiki", "diff"):
        "/diff/<article>/<rev> needs a revision number that only exists "
        "once revisionsFor() has run, so there is no id in site.json to "
        "fill it with. synthnet_claims_check.py reaches it the only way "
        "anything can -- by following the links /changes offers -- and "
        "asserts all 120 of them resolve.",
}


def derive(root):
    """type -> set of first path segments the renderer dispatches on."""
    out = {}
    files = sorted((root / "app" / "types").glob("*.js"))
    ctrl = root / "app" / "control.js"
    if ctrl.is_file():
        files.append(ctrl)
    for f in files:
        typ = f.stem
        src = f.read_text(encoding="utf-8")
        names = set(BIND.findall(src))
        if not names:
            out[typ] = None          # could not find the binding at all
            continue
        segs = set()
        for n in sorted(names):
            segs |= set(seg_re(n).findall(src))
            for a in set(re.compile(ALIAS.pattern % re.escape(n)).findall(src)):
                segs |= set(alias_re(a).findall(src))
        # control.js spells its front page `head === ''`. The empty string is
        # the absence of a segment, not a segment.
        segs.discard("")
        out[typ] = segs
    return out


def literal_set(text, name):
    """Pull a python set/dict literal's string members out of a source file."""
    m = re.search(re.escape(name) + r"\s*=\s*\{(.*?)\n\}", text, re.S)
    if not m:
        return None
    return m.group(1)


def path_prefixes(root):
    """PATH_PREFIXES from validate.py, as {type: set|None}."""
    text = (root / "tools" / "validate.py").read_text(encoding="utf-8")
    body = literal_set(text, "PATH_PREFIXES")
    if body is None:
        return None
    out = {}
    # Each entry is  "type": {...},  or  "type": None,  or  "type": set(),
    for m in re.finditer(r'"([a-z]+)"\s*:\s*(None|set\(\)|\{[^}]*\})', body):
        typ, val = m.group(1), m.group(2)
        if val == "None":
            out[typ] = None
        elif val == "set()":
            out[typ] = set()
        else:
            out[typ] = set(re.findall(r'"([^"]+)"', val))
    return out


def type_probes(scripts):
    """TYPE_PROBES from smoke.py, as {type: set of first segments}."""
    text = (scripts / "synthnet_smoke.py").read_text(encoding="utf-8")
    body = literal_set(text, "TYPE_PROBES")
    if body is None:
        return None
    out = {}
    for m in re.finditer(r'"([a-z]+)"\s*:\s*\[([^\]]*)\]', body):
        typ = m.group(1)
        segs = set()
        for p in re.findall(r'"([^"]*)"', m.group(2)):
            parts = [x for x in p.split("/") if x]
            if parts and not parts[0].startswith("{"):
                segs.add(parts[0])
        out[typ] = segs
    return out


def role_path(root):
    """ROLE_PATH from live.js, as {type: first segment}."""
    text = (root / "app" / "live.js").read_text(encoding="utf-8")
    m = re.search(r"ROLE_PATH\s*=\s*\{(.*?)\n\s*\};", text, re.S)
    if not m:
        return None
    out = {}
    for mm in re.finditer(r"(\w+)\s*:\s*'([^']*)'", m.group(1)):
        parts = [x for x in mm.group(2).split("/") if x]
        out[mm.group(1)] = parts[0] if parts else ""
    return out


def authoring_table(root):
    """The per-type path table in docs/AUTHORING.md, as {type: set}."""
    text = (root / "docs" / "AUTHORING.md").read_text(encoding="utf-8")
    m = re.search(r"\| type \| paths \|\n\|[-| ]+\|\n((?:\|.*\n)+)", text)
    if not m:
        return None
    out = {}
    for line in m.group(1).splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        typ = cells[0].strip("`")
        segs = set()
        for path in re.findall(r"`(/[^`]*)`", cells[1]):
            parts = [x for x in path.split("/") if x]
            if parts and not parts[0].startswith("<"):
                segs.add(parts[0])
        out[typ] = segs
    return out


def crawl_cap(workflow):
    """The --pages the workflow gives the function check, or None."""
    text = workflow.read_text(encoding="utf-8")
    m = re.search(r"synthnet_function_check\.py[^\n]*--pages\s+(\d+)", text)
    return int(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--print", action="store_true",
                    help="print the derived table and exit")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    scripts = pathlib.Path(__file__).resolve().parent

    derived = derive(root)
    if args.print:
        for typ in sorted(derived):
            segs = derived[typ]
            shown = "COULD NOT PARSE" if segs is None else \
                    (", ".join("/" + s for s in sorted(segs)) or "(only /)")
            print(f"  {typ:12s} {shown}")
        return 0

    problems, notes = [], []

    unparsed = [t for t, v in derived.items() if v is None]
    for t in unparsed:
        problems.append(
            f"{t}: could not find where the renderer binds ctx.path, so "
            "nothing was derived from it")
    parsed = {t: v for t, v in derived.items() if v is not None}

    for t, segs in sorted(parsed.items()):
        if not segs and t not in EXPECT_EMPTY:
            problems.append(
                f"{t}: no route segment was derived. {t} is not one of the "
                f"types that legitimately serve no named path "
                f"({', '.join(sorted(EXPECT_EMPTY))}), so the parse missed "
                "its dispatch")

    total_segs = sum(len(v) for v in parsed.values())
    if len(parsed) < MIN_RENDERERS:
        problems.append(
            f"only {len(parsed)} renderer(s) parsed, under the floor of "
            f"{MIN_RENDERERS}")
    if total_segs < MIN_SEGMENTS:
        problems.append(
            f"only {total_segs} route segment(s) derived, under the floor of "
            f"{MIN_SEGMENTS}. The dispatch pattern has stopped matching, "
            "which reads exactly like every table agreeing")

    # ---- PATH_PREFIXES must equal what the renderers serve ---------------
    pp = path_prefixes(root)
    if pp is None:
        problems.append("could not read PATH_PREFIXES out of tools/validate.py")
    else:
        for t, segs in sorted(parsed.items()):
            if t not in pp:
                problems.append(
                    f"{t}: the renderer exists and PATH_PREFIXES has no entry "
                    "for it, so validate.py cannot check any of its links")
                continue
            allowed = pp[t]
            if allowed is None:
                # `page`: any single segment is an id. Only correct when the
                # renderer really has no named routes.
                if segs:
                    problems.append(
                        f"{t}: PATH_PREFIXES says any segment is an id, but "
                        f"the renderer dispatches on "
                        f"{', '.join('/' + s for s in sorted(segs))}")
                continue
            missing = segs - allowed
            extra = allowed - segs
            if missing:
                problems.append(
                    f"{t}: serves {', '.join('/' + s for s in sorted(missing))}"
                    " and PATH_PREFIXES does not list it -- the link check "
                    "calls a working link dead")
            if extra:
                problems.append(
                    f"{t}: PATH_PREFIXES lists "
                    f"{', '.join('/' + s for s in sorted(extra))} and no "
                    "branch serves it -- the link check waves a link through "
                    "to a 404")
        notes.append(f"PATH_PREFIXES agrees with {len(parsed)} renderer(s)")

    # ---- ROLE_PATH must name a route that exists -------------------------
    rp = role_path(root)
    if rp is None:
        problems.append("could not read ROLE_PATH out of app/live.js")
    else:
        for t, seg in sorted(rp.items()):
            if t not in parsed or not seg:
                continue
            if seg not in parsed[t]:
                problems.append(
                    f"live.js ROLE_PATH sends a {t} story to /{seg}/ and the "
                    f"{t} renderer does not serve /{seg}/")
        notes.append(f"ROLE_PATH names {len(rp)} type(s), all of them routes "
                     "their renderer serves")

    # ---- the documented table is the one a person reads ------------------
    doc = authoring_table(root)
    if doc is None:
        problems.append(
            "could not find the per-type path table in docs/AUTHORING.md")
    else:
        for t, segs in sorted(parsed.items()):
            if t not in doc:
                problems.append(
                    f"{t}: docs/AUTHORING.md has no row for it, and it is a "
                    "type somebody authoring a site has to know the paths of")
                continue
            if doc[t] != segs:
                miss = segs - doc[t]
                extra = doc[t] - segs
                bits = []
                if miss:
                    bits.append("does not document " +
                                ", ".join("/" + x for x in sorted(miss)))
                if extra:
                    bits.append("documents " +
                                ", ".join("/" + x for x in sorted(extra)) +
                                " which nothing serves")
                problems.append(
                    f"{t}: docs/AUTHORING.md " + " and ".join(bits))
        for t in sorted(set(doc) - set(parsed)):
            problems.append(
                f"docs/AUTHORING.md documents a type {t!r} with no renderer")
        notes.append(f"docs/AUTHORING.md documents {len(doc)} type(s), all "
                     "matching what their renderer serves")

    # ---- the function crawl has to be able to reach every route ---------
    #
    # synthnet_function_check.py walks each site from "/" following links and
    # stops at --pages. It is the only check that presses controls, so a
    # route it cannot reach in principle is a route whose buttons are never
    # pressed. At --pages 6 that was forum, media and wiki -- 13 sites whose
    # renderers serve more routes than the crawl could visit.
    #
    # The cap is the widest renderer plus its front door, so it moves when a
    # renderer gains a route rather than being a number somebody picked.
    workflow = root.parent / ".github" / "workflows" / "synthnet.yml"
    if not workflow.is_file():
        notes.append("no workflow file next to the root; crawl cap unchecked")
    else:
        cap = crawl_cap(workflow)
        widest = max((len(v) for v in parsed.values()), default=0) + 1
        if cap is None:
            problems.append(
                "the workflow does not pass --pages to the function check, "
                "so nothing pins how far it crawls")
        elif cap < widest:
            worst = sorted((t for t, v in parsed.items()
                            if len(v) + 1 > cap))
            problems.append(
                f"the function check crawls {cap} page(s) per site and "
                f"{', '.join(worst)} serve{'s' if len(worst) == 1 else ''} up "
                f"to {widest} -- those routes are never reached, so their "
                "controls are never pressed")
        else:
            notes.append(f"the function crawl visits {cap} pages per site, "
                         f"enough for the widest renderer's {widest}")

    # ---- TYPE_PROBES may not invent a route, and its gaps are named ------
    tp = type_probes(scripts)
    if tp is None:
        problems.append("could not read TYPE_PROBES out of synthnet_smoke.py")
    else:
        gaps = []
        for t, segs in sorted(parsed.items()):
            probed = tp.get(t, set())
            invented = probed - segs
            if invented:
                problems.append(
                    f"{t}: smoke probes "
                    f"{', '.join('/' + s for s in sorted(invented))} and no "
                    "branch serves it")
            for seg in sorted(segs - probed):
                why = NO_STATIC_PROBE.get((t, seg))
                if why:
                    gaps.append(f"{t} /{seg}/ -- {why}")
                    continue
                problems.append(
                    f"{t}: the renderer serves /{seg}/ and the smoke sweep "
                    "has no probe for it, so nothing renders that page "
                    "except by luck of following a link")
        for g in gaps:
            notes.append(f"no static probe, by design: {g}")
        if not gaps:
            problems.append(
                "the no-static-probe list matched nothing. Either a route "
                "gained a probe and the entry should go, or the parse "
                "stopped seeing it")
        notes.append("every route a renderer serves has a smoke probe")

    for n in notes:
        print(f"  ok  {n}" if not n.startswith("    ") else n)
    print()
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"OK: {total_segs} routes across {len(parsed)} renderers, and every "
          "hand-written copy of the path table agrees with the renderer that "
          "actually serves them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
