#!/usr/bin/env python3
"""Two budgets, because there are two questions and they have different answers.

  COLD LOAD   what index.html blocks on before it can paint anything.
  PAYLOAD     everything the service worker precaches, which is what a first
              visit actually costs.

PAYLOAD is the browser and every renderer and skin. It is NOT the content:
the 109 site.json files are 5.7 MB and get cached as you visit them. So
offline gives you the whole browser and every site type, plus the sites you
have actually opened -- and a site you have never opened is not there. That
is deliberate and predates the split; precaching the lot would put a first
visit at 9 MB to cover a case nobody hits. It is written down because "it
works offline" is one of this project's three promises and the true version
is narrower than the slogan.

Those used to be the same number, because index.html carried all twenty
renderers and all twenty skin stylesheets on every page. They are not the
same number any more: app/render.js fetches the one a page needs, from the
table in app/loadmap.js, so the first paint got roughly 1.09 MB cheaper
while the bytes a first visit eventually pulls did not move at all.

Reporting only the first number would say the app halved in size. It did
not. Both are printed, both are enforced.

THE LIST IS DERIVED, NEVER TYPED. The previous version of this check was a
shell glob in the workflow, and a glob is a hand-maintained list wearing a
disguise: `synthnet/app/*.js` counted app/control.js, which is deferred, and
would have kept counting the renderers if they had stayed under a path it
matched. It also once under-reported by 91 KB by not counting the skin
stylesheets that every page loaded. So the cold-load set is parsed out of
index.html and the payload set out of the SHELL list in sw.js -- each from
the file that actually decides it.

There is a structural assertion as well as a numeric one: no path under
app/types/ or theme/skins/ may appear in the cold load at all. Bytes are a
lagging indicator. Putting one <script> tag back would still fit under the
ceiling and would still be the regression.

Usage:  python3 .github/scripts/synthnet_budget_check.py [--root synthnet]
"""

import argparse
import gzip
import pathlib
import re
import sys

# Cold load: what the reader waits for before the first paint.
COLD_RAW = 1048576        # 1 MiB
COLD_GZ = 327680          # 320 KiB
#
# Measured at the commit that introduced the split: 878,545 raw / 267,161
# gzipped, against 1,961,251 / 545,275 the day before. This is the first time
# a ceiling in this project has gone DOWN, and it is meant to. A ceiling that
# rises whenever content grows has stopped being an alarm; the previous three
# raises each made sense on their own and the trend did not.
#
# What is left is dominated by app/*.js. If this ever needs headroom again,
# the next lever is the slop pools -- slop_forum 130,163, slop_news 85,614,
# slop_social 71,349, slop_ads 37,421, already separate per-type files at
# 324,547 bytes together. That is real work, because app/live.js and
# app/bots.js reach across all four, and it is the work to do instead of
# moving this number.

# Payload: everything the service worker precaches, which is what a first
# visit costs end to end and what offline completeness requires.
PAYLOAD_RAW = 4194304     # 4 MiB
#
# Measured at the same commit: 3,229,619 raw, of which net/search.json is
# 1,332,368. This number did NOT improve when the renderers were deferred,
# and it is here so that nobody reads the cold-load figure and concludes it
# did.

LINK = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
SCRIPT = re.compile(
    r"<script\b[^>]*\bsrc\s*=\s*[\"']([^\"']+)[\"'][^>]*>\s*</script\s*>",
    re.IGNORECASE)
ATTR = re.compile(r"\b(\w+)\s*=\s*[\"']([^\"']*)[\"']")
SHELL = re.compile(r"var SHELL = \[(.*?)\];", re.DOTALL)
QUOTED = re.compile(r"'([^']+)'")

DEFERRED = ("app/types/", "theme/skins/")


def local(root, href):
    """A repo-relative path, or None for data:, http:// and the like."""
    if not href or href.startswith("data:") or "://" in href:
        return None
    clean = href.split("?", 1)[0].split("#", 1)[0]
    while clean.startswith("./"):
        clean = clean[2:]
    clean = clean.lstrip("/")
    if not clean:
        return None
    if not (root / clean).is_file():
        return None
    return clean


def cold_load(root):
    """Exactly what index.html makes the browser fetch before it paints."""
    html = (root / "index.html").read_text(encoding="utf-8")
    out = ["index.html"]
    for tag in LINK.findall(html):
        attrs = dict(ATTR.findall(tag))
        rel = (attrs.get("rel") or "").lower()
        if "stylesheet" not in rel and rel != "manifest":
            continue
        path = local(root, attrs.get("href", ""))
        if path and path not in out:
            out.append(path)
    for match in SCRIPT.finditer(html):
        path = local(root, match.group(1))
        if path and path not in out:
            out.append(path)
    # Fetched on boot without a tag naming them.
    for extra in ("net/registry.json",):
        if (root / extra).is_file() and extra not in out:
            out.append(extra)
    return out


def payload(root):
    """Everything sw.js precaches, i.e. what a first visit eventually pulls."""
    text = (root / "sw.js").read_text(encoding="utf-8")
    match = SHELL.search(text)
    if not match:
        return None
    out = []
    for entry in QUOTED.findall(match.group(1)):
        path = local(root, entry)
        if path and path not in out:
            out.append(path)
    return out


def weigh(root, paths):
    raw = gz = 0
    for p in paths:
        data = (root / p).read_bytes()
        raw += len(data)
        gz += len(gzip.compress(data, 9))
    return raw, gz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    problems = []

    cold = cold_load(root)
    craw, cgz = weigh(root, cold)
    print(f"cold load   {len(cold)} files, {craw} raw / {cgz} gzipped")
    print(f"            ceilings {COLD_RAW} raw / {COLD_GZ} gzipped "
          f"({100 * craw // COLD_RAW}% / {100 * cgz // COLD_GZ}%)")
    if craw > COLD_RAW:
        problems.append(f"the cold load is {craw} raw, over {COLD_RAW}")
    if cgz > COLD_GZ:
        problems.append(f"the cold load is {cgz} gzipped, over {COLD_GZ}")

    # The structural half. A single <script src="app/types/forum.js"> put back
    # into index.html would still fit under the ceiling above and would still
    # be the whole regression, so the bytes are not the only assertion.
    leaked = [p for p in cold if p.startswith(DEFERRED)]
    if leaked:
        problems.append(
            "index.html loads %d file(s) that app/render.js is supposed to "
            "fetch on demand: %s" % (len(leaked), ", ".join(leaked)))

    full = payload(root)
    if full is None:
        problems.append("sw.js has no 'var SHELL = [...]' -- the payload "
                        "budget cannot be measured, so it is not being measured")
    else:
        praw, pgz = weigh(root, full)
        print(f"payload     {len(full)} files, {praw} raw / {pgz} gzipped")
        print(f"            ceiling {PAYLOAD_RAW} raw "
              f"({100 * praw // PAYLOAD_RAW}%)")
        if praw > PAYLOAD_RAW:
            problems.append(f"the offline payload is {praw} raw, over {PAYLOAD_RAW}")
        # Offline is only complete if the precache covers the deferred set.
        # Losing them here is silent: pages you already opened keep working
        # and the ones you did not fail only once you are offline.
        missing = [p for p in cold_deferred(root) if p not in full]
        if missing:
            problems.append(
                "sw.js does not precache %d deferred file(s), so offline is "
                "broken for those types: %s"
                % (len(missing), ", ".join(missing[:6])))
        print(f"            of which {sum(1 for p in full if p.startswith(DEFERRED))}"
              " are renderers and skins fetched after the first paint")

    print()
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("OK: the first paint is cheap, the offline payload is complete, and "
          "neither number is standing in for the other.")
    return 0


def cold_deferred(root):
    """Every renderer and skin on disk -- what the precache has to cover."""
    out = []
    for path in sorted((root / "app" / "types").glob("*.js")):
        out.append("app/types/" + path.name)
    for path in sorted((root / "theme" / "skins").glob("*.css")):
        out.append("theme/skins/" + path.name)
    for extra in ("app/control.js", "theme/control.css"):
        if (root / extra).is_file():
            out.append(extra)
    return out


if __name__ == "__main__":
    sys.exit(main())
