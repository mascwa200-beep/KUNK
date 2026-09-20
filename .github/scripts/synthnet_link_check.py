#!/usr/bin/env python3
"""Follow every synth:// link the *app* generates at runtime.

tools/validate.py checks the synth:// links written inside site JSON. It
cannot see the ones built by JavaScript at render time, and for a long time
nothing did -- which is how app/fame.js came to hardcode five domains, three
of which (shoutbox.live, veritywiki.org, gridfall.forums.net) were never in
the registry at all. The headline feature of the whole 2026 build, "gain
followers and the world reacts", emitted a dead link at every single
milestone, and every check in CI stayed green because every check in CI was
looking at the content rather than at what the code did with it.

So this drives the real app in a real browser, pushes a real account through
every fame tier, harvests every synth:// URL that comes back, and asserts
each one resolves:

  * the domain exists in the registry, unless it is a deliberate dead end
    (see DEAD_TLDS in tools/validate.py -- scam links are supposed to 404)
  * the path is one the target site's type actually routes
  * the id in that path names something that exists in the target site

Usage:  python3 .github/scripts/synthnet_link_check.py [--root synthnet]
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

# Must match PATH_PREFIXES in tools/validate.py. Kept as a copy rather than
# imported because that module is stdlib-only-by-design and this one is not;
# the test below asserts they agree, so drift fails the build rather than
# silently weakening the check.
PATH_PREFIXES = {
    "forum": {"board", "topic", "modlog"},
    "social": {"user", "post"},
    "blog": {"post", "tag"},
    "news": {"section", "article", "live", "factcheck", "corrections"},
    # A living wiki is history, diffs, talk and recent changes as well
    # as articles. The 1998-2008 wiki serves the first two only, but the
    # prefix table is per TYPE, not per site.
    "wiki": {"wiki", "category", "history", "diff", "talk", "changes"},
    "media": {"watch", "channel"},
    "page": None,
    "aggregator": {"board", "item"},
    "qa": {"tag", "q"},
    "board": {"t", "catalog"},
    "shop": {"c", "p"},
    "market": {"c", "l"},
    "assistant": {"chat"},
    "mail": {"f", "m"},
    "portal": {"s"},
    "stream": {"w", "c"},
    "dash": set(),
    "control": {"packs", "compose", "me", "storage"},
    "wire": {"d", "cat"},
    "newsletter": {"i"},
    "chat": {"c"},
}

DEAD_TLDS = (
    # scams -- a link that is a lie, and is supposed to 404
    ".top", ".click", ".win", ".example", ".finance", ".fin", ".zip",
    ".lol", ".biz", ".hostline", ".vip", ".shop",
    # off-net -- real in Verity County, simply not archived in this build
    ".synth",
)
LIVE_TLDS = (".org", ".net", ".com", ".tv", ".blog", ".social", ".store",
             ".ai", ".gov", ".us", ".info", ".news", ".wiki", ".press",
             ".live", ".chat", ".radio")

# Domains the engine serves itself rather than from net/sites/. They are not
# in the registry and never will be, because there is no site.json behind them.
BUILTIN_DOMAINS = {"start.verity.net", "search.verity.net", "feeds.verity.net"}

SYNTH_URL = re.compile(r"synth://([a-z0-9.-]+)((?:/[^\s\]\)\"'<>]*)?)", re.IGNORECASE)


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


def load_sites(root):
    """domain -> {type, ids: {prefix: set(id)}} for every site on disk."""
    out = {}
    for path in sorted(glob.glob(str(root / "net" / "sites" / "*" / "site.json"))):
        site = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
        data = site.get("data") or {}
        ids = {}

        def collect(prefix, rows, key="id"):
            got = set()
            for row in rows or []:
                if isinstance(row, dict) and isinstance(row.get(key), str):
                    got.add(row[key])
            if got:
                ids.setdefault(prefix, set()).update(got)

        t = site.get("type")
        if t == "forum":
            collect("topic", data.get("topics"))
            for cat in data.get("categories") or []:
                if isinstance(cat, dict):
                    collect("board", cat.get("boards"))
        elif t == "social":
            collect("post", data.get("feed"))
            collect("user", data.get("friends"), "handle")
            prof = data.get("profile")
            if isinstance(prof, dict) and isinstance(prof.get("handle"), str):
                ids.setdefault("user", set()).add(prof["handle"])
        elif t == "blog":
            collect("post", data.get("posts"))
        elif t == "news":
            collect("article", data.get("articles"))
            collect("section", data.get("sections"))
            collect("live", data.get("live"))
            collect("factcheck", data.get("factchecks"))
        elif t == "wiki":
            collect("wiki", data.get("articles"))
            collect("category", data.get("categories"))
        elif t == "media":
            collect("watch", data.get("items"))
            collect("channel", data.get("channels"))
        elif t == "aggregator":
            collect("item", data.get("links"))
            collect("board", data.get("boards"))
        elif t == "qa":
            collect("q", data.get("questions"))
            collect("tag", data.get("tags"))
        elif t == "board":
            collect("t", data.get("threads"))
        elif t == "shop":
            collect("p", data.get("products"))
            collect("c", data.get("categories"))
        elif t == "market":
            collect("l", data.get("listings"))
            collect("c", data.get("cats"))
        elif t == "mail":
            collect("m", data.get("messages"))
            collect("f", data.get("folders"))
        elif t == "portal":
            collect("s", data.get("services"))
        elif t == "stream":
            collect("w", data.get("videos"))
            collect("c", data.get("channels"))
        elif t == "wire":
            collect("d", data.get("dispatches"))
            collect("cat", data.get("categories"))
        elif t == "newsletter":
            collect("i", data.get("issues"))
        elif t == "chat":
            collect("c", data.get("channels"))
        elif t == "page":
            collect("", data.get("pages"))

        out[site["domain"].lower()] = {"type": t, "ids": ids}
    return out


def check_url(domain, path, sites, strict_ids):
    """Return a complaint string, or None if the link is fine."""
    domain = domain.lower()
    if domain.endswith(DEAD_TLDS):
        return None                      # a scam link. It is meant to 404.
    if domain in BUILTIN_DOMAINS:
        return None
    site = sites.get(domain)
    if site is None:
        if not domain.endswith(LIVE_TLDS):
            return (f"domain {domain!r} is on a TLD this project does not "
                    f"recognise -- use a real domain, or a DEAD_TLDS one if "
                    f"it is meant to dead-end")
        return f"domain {domain!r} is not in the registry"

    seg = [s for s in path.split("/") if s]
    if not seg:
        return None                      # the front page always exists

    allowed = PATH_PREFIXES.get(site["type"])
    if allowed is None:                  # `page`: any single segment is a page id
        return None
    prefix = seg[0]
    if allowed and prefix not in allowed:
        return (f"synth://{domain}{path}: a {site['type']} does not serve "
                f"/{prefix}/ (it serves {sorted(allowed)})")
    if not allowed:
        return f"synth://{domain}{path}: a {site['type']} has no sub-paths"

    if not strict_ids or len(seg) < 2:
        return None
    known = site["ids"].get(prefix)
    if known is None:
        return None                      # nothing of that kind authored; not our call
    ident = seg[1].split("?")[0]
    try:
        from urllib.parse import unquote
        ident = unquote(ident)
    except Exception:
        pass
    if ident not in known:
        return (f"synth://{domain}{path}: no {prefix} with id {ident!r} "
                f"on {domain}")
    return None


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

    # Guard against this file's copy of the routing table drifting from the
    # validator's. A stale copy here would quietly stop catching things.
    sys.path.insert(0, str(root / "tools"))
    try:
        import validate as validator
        if validator.PATH_PREFIXES != PATH_PREFIXES:
            print("FAIL: PATH_PREFIXES here has drifted from tools/validate.py.")
            only_here = set(PATH_PREFIXES) - set(validator.PATH_PREFIXES)
            only_there = set(validator.PATH_PREFIXES) - set(PATH_PREFIXES)
            for t in sorted(only_there):
                print(f"  - {t}: in validate.py, missing here")
            for t in sorted(only_here):
                print(f"  - {t}: here, missing from validate.py")
            for t in sorted(set(PATH_PREFIXES) & set(validator.PATH_PREFIXES)):
                if PATH_PREFIXES[t] != validator.PATH_PREFIXES[t]:
                    print(f"  - {t}: {PATH_PREFIXES[t]} here vs "
                          f"{validator.PATH_PREFIXES[t]} there")
            return 1
        if validator.DEAD_TLDS != DEAD_TLDS:
            print("FAIL: DEAD_TLDS here has drifted from tools/validate.py.")
            return 1
        if getattr(validator, "LIVE_TLDS", None) != LIVE_TLDS:
            print("FAIL: LIVE_TLDS here has drifted from tools/validate.py.")
            return 1
    except ImportError:
        print("note: could not import tools/validate.py to cross-check the tables")

    sites = load_sites(root)

    problems_static = []
    # --- pass 1: every literal synth:// URL in the app's own source --------
    #
    # Driving the app only exercises the templates that happen to fire. The
    # reply corpus alone holds hundreds, drawn by seed, so a dead link can sit
    # in one for months and surface on somebody's phone rather than in CI.
    # Reading the source catches all of them at once, and costs nothing.
    for path in sorted(glob.glob(str(root / "app" / "*.js"))) + \
                sorted(glob.glob(str(root / "app" / "types" / "*.js"))):
        text = pathlib.Path(path).read_text(encoding="utf-8")
        rel = os.path.relpath(path, root.parent)
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.lstrip()
            # Skip comments; several of them name a dead domain on purpose,
            # explaining the bug that made it dead.
            if stripped.startswith("*") or stripped.startswith("//") or \
               stripped.startswith("/*"):
                continue
            for m in SYNTH_URL.finditer(line):
                domain, path_part = m.group(1), m.group(2) or "/"
                # A URL built by concatenation has a variable after it; only
                # judge the ones that are fully literal.
                if m.end() < len(line) and line[m.end():m.end() + 1] not in "]'\" )},;":
                    continue
                complaint = check_url(domain, path_part, sites, strict_ids=True)
                if complaint:
                    problems_static.append(f"{rel}:{lineno}: {complaint}")

    port = free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port),
                              lambda *a, **k: Quiet(*a, directory=str(root), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}/index.html"

    problems = []
    checked = 0

    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 360, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(base, wait_until="networkidle")
            page.wait_for_timeout(400)
            if errors:
                problems.append(f"console error on load: {errors[0][:200]}")

            # Walk an account up through every tier and harvest what the
            # world says about it. 1.5M is past the last milestone.
            harvest = page.evaluate("""async () => {
              await SYNTH.store.ready();
              await SYNTH.me.reset();
              await SYNTH.me.signUp({handle: 'linkcheck', name: 'Link Check'});
              const out = [];
              const seen = new Set();
              const eat = (where, text) => {
                if (typeof text !== 'string') return;
                for (const m of text.matchAll(/synth:\\/\\/[^\\s\\]\\)"'<>]+/gi)) {
                  const key = where + '|' + m[0];
                  if (seen.has(key)) continue;
                  seen.add(key);
                  out.push({where: where, url: m[0]});
                }
              };

              for (const f of [0, 50, 100, 1000, 10000, 50000, 250000, 1000000, 1500000]) {
                await SYNTH.me.update({followers: f});
                const p = SYNTH.me.profile();
                for (const e of (SYNTH.fame.events(p) || [])) {
                  eat('fame event "' + e.title + '" at ' + f, e.body);
                  eat('fame event "' + e.title + '" at ' + f, e.domain ? 'synth://' + e.domain + '/' : '');
                }
                for (const d of (SYNTH.fame.dmsFor(p) || [])) {
                  eat('fame DM from ' + d.handle + ' at ' + f, d.body);
                }
                for (const m of (SYNTH.fame.milestones(p) || [])) {
                  eat('milestone ' + m.name, m.blurb);
                }
              }

              // Bot replies, which also build links.
              await SYNTH.me.update({followers: 4000});
              const posts = [
                'the substation on Ellery is making that noise again',
                'made $9000 last month working from home, ask me how',
                'does anyone know when the Halsey branch line closed'
              ];
              for (const body of posts) {
                const post = await SYNTH.me.addPost('gridline.social', body);
                for (const r of SYNTH.bots.repliesFor(post, {now: Date.now() + 86400000, followers: 4000})) {
                  eat('bot reply (' + r.kind + ')', r.body);
                }
              }
              return out;
            }""")

            for row in harvest:
                m = SYNTH_URL.match(row["url"])
                if not m:
                    problems.append(f"{row['where']}: unparseable URL {row['url']!r}")
                    continue
                checked += 1
                # Ids inside generated links are frequently the player's own
                # handle, which by design does not exist as authored content;
                # the domain and the path shape are what must hold.
                complaint = check_url(m.group(1), m.group(2) or "/", sites,
                                      strict_ids=False)
                if complaint:
                    problems.append(f"{row['where']}: {complaint}")

            # --- board post references ---------------------------------
            #
            # A ">>8162518" on an imageboard is a link like any other, and
            # it can be dead like any other -- it just does not look like a
            # URL, so nothing above would ever see it. The first version of
            # the code that generates them recomputed a post's number from
            # a hash instead of reading the number the post is rendered
            # with, and every reference on every thread pointed at no post
            # on the page. It looked completely correct.
            for domain, entry in sorted(sites.items()):
                if entry.get("type") != "board":
                    continue
                for tid in sorted(entry.get("ids", {}).get("t", set()))[:8]:
                    page.goto(f"{base}#synth://{domain}/t/{tid}",
                              wait_until="networkidle")
                    page.wait_for_timeout(120)
                    found = page.evaluate("""() => {
                      const nos = new Set(
                        [...document.querySelectorAll('.bd-no')]
                          .map(n => n.innerText.replace(/\\D/g, '')));
                      const refs = [];
                      document.querySelectorAll('.bd-body').forEach(b => {
                        (b.innerText.match(/>>(\\d+)/g) || [])
                          .forEach(r => refs.push(r.slice(2)));
                      });
                      return {n: refs.length,
                              dead: refs.filter(r => !nos.has(r))}; }""")
                    checked += found["n"]
                    for dead in found["dead"][:3]:
                        problems.append(
                            f"synth://{domain}/t/{tid}: the reply references "
                            f">>{dead}, and no post on that page has that "
                            f"number")

            browser.close()
    finally:
        srv.shutdown()

    # Dedupe the runtime findings: one broken domain shows up under a dozen
    # different events. The static ones are already one per source line.
    seen, unique = set(), []
    for p in problems:
        key = p.split(": ", 1)[-1]
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)

    if problems_static or unique:
        total = len(problems_static) + len(unique)
        print(f"FAIL: {total} broken link(s).")
        if problems_static:
            print(f"\n  In the source ({len(problems_static)}):")
            for p in problems_static[:30]:
                print(f"    - {p}")
        if unique:
            print(f"\n  Generated at runtime ({len(unique)} distinct, "
                  f"{checked} links followed):")
            for p in unique[:30]:
                print(f"    - {p}")
        return 1

    print(f"OK: no dead synth:// links. {len(sites)} sites known; "
          f"{checked} links generated at runtime all resolve to a real site "
          f"on a path that site serves.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
