#!/usr/bin/env python3
"""Every list of site-type names must answer to the renderers.

Round 10 took the per-type PATH table -- written down five times by hand,
checked against itself nowhere -- derived it from the renderers and made the
copies answer. This is the same disease in the table next to it: the list of
TYPE NAMES, written down eight times, six of them drifted.

The renderers are the truth. `app/types/<type>.js` existing is what makes a
type real, and `tools/build.py` already fails the build if one on disk is
missing from `app/loadmap.js`. Everything else here is a copy of that fact,
and a copy is a thing that goes stale quietly:

    tools/new_site.py      named 7 of 21 as argparse choices, so the
                           scaffolding CLI refused thirteen of the twenty
                           authorable types outright
    app/packs.js           named 17, missing chat, newsletter and wire, so
                           one authored chat site made an entire exported
                           pack unimportable -- every other site in it too
    app/control.js         6 starters, one of them naming a type that no
                           longer exists, and all six of the wrong SHAPE:
                           the composer's "Insert starter" produced JSON no
                           renderer reads
    app/engine.js          7 labels, so every 2026 type appeared in the
                           built-in directory under a bare lowercase
                           heading, sorted after all the old ones
    README.md              "Seven types, each with its own renderer"
    synthnet-expand.js     told its own verification agent the valid types
                           were the original seven, so the checker would
                           reject a chat site the same workflow had just
                           been told to write

Two sets, and confusing them is how `control` ends up in a list of things a
person can author:

    ALL         the renderers plus `control`, the browser's own settings
                panel. There is a real control site, so the content
                validator legitimately needs it.
    AUTHORABLE  ALL minus control.

Two relations, because the copies are not all the same kind of thing:

    equals   a name missing breaks a real type and a name extra gates
             nothing -- loadmap, validate.py, new_site.py, the starters
    covers   the table carries per-type PROSE that cannot be derived, so it
             must have a row for every type and no row for a type with no
             renderer -- skins, labels, the AUTHORING table

And one end-to-end pass: scaffold every authorable type into a temp
directory, validate it, and render it in a browser. That is the assertion
the whole round rests on, and it is the one thing no static parse can make.

Usage:  python3 .github/scripts/synthnet_types_check.py [--root synthnet]
        ... --no-render      skip the browser pass (static parses only)
"""

import argparse
import glob
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Floors. The failure this file exists to prevent is its own: a regex that
# stops matching reports that every copy agrees.
MIN_RENDERERS = 20
MIN_COPIES = 8


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
# the truth
# ---------------------------------------------------------------------------

def derive(root):
    """Every type this build can draw: one app/types/<type>.js each, plus
    `control`, whose renderer lives in app/control.js because it is the
    browser's own panel rather than a site type."""
    out = {p.stem for p in (root / "app" / "types").glob("*.js")}
    if (root / "app" / "control.js").is_file():
        out.add("control")
    return out


# ---------------------------------------------------------------------------
# the copies
# ---------------------------------------------------------------------------

def js_object_keys(text, name):
    """Keys of `var <name> = { ... };` -- quoted or bare, one level."""
    m = re.search(r"var\s+" + re.escape(name) + r"\s*=\s*\{(.*?)\n\s*\};",
                  text, re.DOTALL)
    if not m:
        return None
    body = m.group(1)
    depth, top = 0, []
    for line in body.splitlines():
        if depth == 0:
            k = re.match(r"\s*['\"]?([A-Za-z_][\w-]*)['\"]?\s*:", line)
            if k:
                top.append(k.group(1))
        depth += line.count("{") + line.count("[")
        depth -= line.count("}") + line.count("]")
    return set(top)


def js_array_items(text, name):
    m = re.search(r"(?:var|const)\s+" + re.escape(name) + r"\s*=\s*\[(.*?)\]",
                  text, re.DOTALL)
    if not m:
        return None
    return set(re.findall(r"'([a-z]+)'|\"([a-z]+)\"", m.group(1))
               and [a or b for a, b in re.findall(r"'([a-z]+)'|\"([a-z]+)\"",
                                                  m.group(1))])


def py_names(text, name):
    m = re.search(re.escape(name) + r"\s*=\s*[\(\{\[](.*?)[\)\}\]]\n",
                  text, re.DOTALL)
    if not m:
        return None
    return set(re.findall(r"[\"']([a-z_]+)[\"']", m.group(1)))


def collect(root, repo):
    """Every hand-written or derived copy: name -> (relation, set, why)."""
    out = {}

    lm = (root / "app" / "loadmap.js").read_text(encoding="utf-8")
    keys = js_object_keys(lm, "SYNTH.loadmap")
    if keys is None:
        m = re.search(r"loadmap\s*=\s*\{(.*?)\n\s*\};", lm, re.DOTALL)
        keys = set(re.findall(r"^\s{4}([a-z]+)\s*:", m.group(1), re.M)) if m else None
    out["app/loadmap.js"] = ("equals", keys,
                             "which files a type needs; build.py fails if a "
                             "renderer on disk is missing from it")

    vp = (root / "tools" / "validate.py").read_text(encoding="utf-8")
    out["tools/validate.py TYPES"] = ("equals", py_names(vp, "TYPES"),
                                      "the content validator's type gate")
    out["tools/validate.py SKINS"] = ("covers", js_or_py_dict_keys(vp, "SKINS"),
                                      "which skins are legal per type")

    au = (root / "docs" / "AUTHORING.md").read_text(encoding="utf-8")
    out["docs/AUTHORING.md skins"] = ("covers", md_table_types(au),
                                      "the human mirror of SKINS")
    out["docs/AUTHORING.md shapes"] = ("covers-authorable", md_shape_types(au),
                                       "the documented data shape per type, "
                                       "which is what anyone authoring by "
                                       "hand reads")

    ns = (root / "tools" / "new_site.py").read_text(encoding="utf-8")
    out["tools/new_site.py _DATA"] = ("equals-authorable",
                                      py_dict_keys(ns, "_DATA"),
                                      "the scaffolding CLI's --type choices "
                                      "and its body builders")

    cj = (root / "app" / "control.js").read_text(encoding="utf-8")
    out["app/control.js STARTERS"] = ("equals-authorable",
                                      json_block_keys(cj, "STARTERS"),
                                      "the composer's Insert starter button; "
                                      "generated by build.py")

    ej = (root / "app" / "engine.js").read_text(encoding="utf-8")
    out["app/engine.js TYPE_LABELS"] = ("covers", js_object_keys(ej, "TYPE_LABELS"),
                                        "what the built-in directory calls "
                                        "each kind of site")

    rm = (root / "README.md").read_text(encoding="utf-8")
    out["README.md"] = ("covers", readme_types(rm),
                        "the project's own statement of what it draws")

    wf = repo / ".claude" / "workflows" / "synthnet-expand.js"
    if wf.is_file():
        out["synthnet-expand.js ALL_TYPES"] = (
            "equals-authorable", js_array_items(wf.read_text(encoding="utf-8"),
                                                "ALL_TYPES"),
            "the pool the expansion workflow draws from, and the list it "
            "hands its own verification agent")
    return out


def js_or_py_dict_keys(text, name):
    m = re.search(re.escape(name) + r"\s*=\s*\{(.*?)\n\}", text, re.DOTALL)
    if not m:
        return None
    return set(re.findall(r"^\s+[\"']([a-z]+)[\"']\s*:", m.group(1), re.M))


def py_dict_keys(text, name):
    return js_or_py_dict_keys(text, name)


def json_block_keys(text, name):
    m = re.search(r"var\s+" + re.escape(name) + r"\s*=\s*(\{.*?\});\n",
                  text, re.DOTALL)
    if not m:
        return None
    try:
        return set(json.loads(m.group(1)))
    except ValueError:
        return None


def md_table_types(text):
    """The skins table in AUTHORING.md section 2. Type is the SECOND column
    -- the table is `| era | type | skins |` -- and reading the first one
    gave a set of era names that matched no type at all."""
    m = re.search(r"\n## 2\. Skins\n(.*?)(?:\n## |\Z)", text, re.DOTALL)
    if not m:
        return None
    found = set(re.findall(r"^\|[^|]*\|\s*`([a-z]+)`\s*\|", m.group(1), re.M))
    return found or None


def md_shape_types(text):
    """The per-type `data` shapes in AUTHORING.md section 6, one ### each.

    Some headings are bare (`### forum`) and the ones added later are
    backticked (`### `wire``), so a pattern that wanted only the bare form
    reported fourteen types as undocumented when every one of them was
    there. `control` is genuinely absent and should be: validate.py's
    check_control says its site.json is a stub on purpose, because that
    renderer draws the panel from live state.
    """
    m = re.search(r"\n## 6\. .*?\n(.*?)\Z", text, re.DOTALL)
    if not m:
        return None
    found = set(re.findall(r"^###\s+`?([a-z]+)`?", m.group(1), re.M))
    return found or None


def readme_types(text):
    """The block of names under "types you can author". Written as an indented
    run of words rather than a table, so the paragraph that introduces it and
    the paragraph that follows are both skipped."""
    m = re.search(r"types you can author.*?:\n\n((?:[ \t]+\S.*\n)+)",
                  text, re.DOTALL)
    if not m:
        return None
    names = set(re.findall(r"\b([a-z]{2,12})\b", m.group(1))) & KNOWN_WORDS
    if re.search(r"`control`", text):
        names.add("control")
    return names or None


KNOWN_WORDS = {
    "aggregator", "assistant", "blog", "board", "chat", "dash", "forum",
    "mail", "market", "media", "news", "newsletter", "page", "portal", "qa",
    "shop", "social", "stream", "wiki", "wire", "control",
}


# ---------------------------------------------------------------------------
# the end-to-end pass
# ---------------------------------------------------------------------------

def scaffold_and_check(root, repo, authorable, problems, notes, render):
    """Scaffold every authorable type, validate it, and draw it.

    Not a parse. tools/new_site.py's thirteen new builders were written
    against tools/validate.py's per-type rules, and shape is not rendering --
    a body can satisfy every required key and still draw a blank page. This
    makes the twenty sites in a temp tree so the repository is never written
    to, which is also why nothing is left behind to keep the assertion true
    by accident.
    """
    work = pathlib.Path(tempfile.mkdtemp(prefix="synthnet-types-"))
    try:
        tree = work / "synthnet"
        shutil.copytree(root, tree,
                        ignore=shutil.ignore_patterns("dist", "android"))
        made = []
        for kind in sorted(authorable):
            r = subprocess.run(
                [sys.executable, str(tree / "tools" / "new_site.py"),
                 "typecheck-%s.verity.net" % kind, kind],
                capture_output=True, text=True)
            if r.returncode != 0:
                problems.append(
                    "tools/new_site.py cannot scaffold %r: %s"
                    % (kind, (r.stderr or r.stdout).strip().splitlines()[-1][:160]))
            else:
                made.append(kind)
        if len(made) < len(authorable):
            return
        notes.append("scaffolded all %d authorable types" % len(made))

        r = subprocess.run([sys.executable, str(tree / "tools" / "validate.py"),
                            "--strict"], capture_output=True, text=True,
                           cwd=str(tree))
        if r.returncode != 0:
            tail = [ln for ln in (r.stdout + r.stderr).splitlines()
                    if "typecheck-" in ln or ln.startswith("FAIL")]
            problems.append(
                "a scaffolded site does not validate: " +
                " | ".join(tail[:4] or ["(no detail)"]))
            return
        notes.append("every scaffold passes validate.py --strict")

        if not render:
            notes.append("browser pass skipped (--no-render)")
            return
        subprocess.run([sys.executable, str(tree / "tools" / "build.py"),
                        "--quiet"], capture_output=True)
        bodies = {}
        for kind in made:
            f = tree / "net" / "sites" / ("typecheck-%s-verity-net" % kind) / "site.json"
            try:
                bodies[kind] = json.loads(f.read_text(encoding="utf-8")).get("data", {})
            except Exception:
                bodies[kind] = {}
        render_each(tree, made, problems, notes, bodies)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def prose_in(data, title, least=8):
    """Every sentence-length string inside a scaffold's `data`.

    Read out of the file the scaffold wrote, so the check looks for content
    that can only have come from the body -- not from the envelope. The site
    TITLE is no good for this: every renderer draws it from site.title as
    chrome, so a `page` scaffold with its blocks emptied still prints its own
    name while showing none of its content, and an assertion on the title
    waves that through.

    Eight characters and nothing the site title already contains, because
    the front page of a shop or a classifieds site shows listing NAMES and
    keeps the blurb on the item page -- a twenty-character bar wanted a
    sentence that route never draws. A body with nothing in it at all is
    not a scaffold worth shipping, so finding none is a failure, not a skip.
    """
    out = []

    def walk(v):
        if isinstance(v, str):
            if len(v) >= least and v not in title and title not in v:
                out.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(data)
    return out


def title_of(domain):
    """The same title tools/new_site.py derives, so the check looks for the
    string the scaffold actually carries rather than one it invents."""
    head = domain.split(".")[0].replace("-", " ").replace("_", " ")
    return head.title() if head else domain


def render_each(tree, kinds, problems, notes, bodies):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        problems.append("playwright is not installed, so no scaffold was drawn")
        return
    port = free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port),
                              lambda *a, **k: Quiet(*a, directory=str(tree), **k))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    drawn = 0
    try:
        with sync_playwright() as pw:
            browser = launch(pw)
            page = browser.new_page(viewport={"width": 360, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console",
                    lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
            for kind in kinds:
                errors[:] = []
                page.evaluate("(u) => SYNTH.engine.navigate(u, {push: false})",
                              "synth://typecheck-%s.verity.net/" % kind)
                page.wait_for_timeout(320)
                body = page.evaluate(
                    "() => document.querySelector('#synth-viewport').textContent")
                got = {"text": len(body.strip()), "body": body}
                title = title_of("typecheck-%s.verity.net" % kind)
                want = prose_in(bodies.get(kind, {}), title)
                if errors:
                    problems.append(
                        "the %s scaffold threw on render: %s"
                        % (kind, errors[0][:140]))
                elif not want:
                    problems.append(
                        "the %s scaffold's data carries no prose to look "
                        "for, so nothing could be checked against the page"
                        % kind)
                elif title not in got["body"]:
                    # Measured: all twenty print their own name, so this is a
                    # rule rather than a guess. A character floor is not
                    # enough -- a `page` scaffold with an empty blocks array
                    # validates, draws nav and footer and clears any
                    # reasonable length threshold while showing none of its
                    # own content. The title is the one string that can only
                    # have come from the body.
                    problems.append(
                        "the %s scaffold rendered %d characters and none of "
                        "them were its own name (%r) -- a body that validates "
                        "and never reaches the screen is what this pass is "
                        "for" % (kind, got["text"], title))
                elif not any(w in got["body"] for w in want):
                    problems.append(
                        "the %s scaffold renders its name but none of its "
                        "own %d line(s) of content -- a body that validates "
                        "and never reaches the screen is what this pass is "
                        "for. Looked for: %r"
                        % (kind, len(want), want[0][:60]))
                else:
                    drawn += 1
            browser.close()
    finally:
        srv.shutdown()
    if drawn == len(kinds):
        notes.append("every scaffold draws a page, no console errors")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    ap.add_argument("--no-render", action="store_true")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    repo = root.parent

    problems, notes = [], []

    everything = derive(root)
    if len(everything) < MIN_RENDERERS:
        print(f"FAIL: found only {len(everything)} renderer(s) under "
              f"{args.root}/app/types (floor {MIN_RENDERERS}). The parse has "
              "stopped working, which reads exactly like every copy agreeing.")
        return 1
    authorable = everything - {"control"}

    reached = 0
    for name, (relation, found, why) in sorted(collect(root, repo).items()):
        if found is None:
            problems.append(
                f"{name}: could not be parsed at all, so it was not compared. "
                f"It is supposed to hold {why}.")
            continue
        reached += 1
        want = authorable if relation.endswith("-authorable") else everything
        missing = sorted(want - found)
        extra = sorted(found - want)
        if missing:
            problems.append(
                f"{name} is missing {len(missing)} type(s) the renderers "
                f"provide: {', '.join(missing)}  [{why}]")
        if extra and not relation.startswith("covers"):
            problems.append(
                f"{name} names {len(extra)} type(s) with no renderer: "
                f"{', '.join(extra)}  [{why}]")
        elif extra:
            problems.append(
                f"{name} has a row for {len(extra)} type(s) that do not "
                f"exist: {', '.join(extra)}  [{why}]")

    if reached < MIN_COPIES:
        problems.append(
            f"only {reached} copies of the type list were parsed (floor "
            f"{MIN_COPIES}) -- a check that cannot reach the copies it is "
            "about is not passing, it is silent")

    scaffold_and_check(root, repo, authorable, problems, notes,
                       render=not args.no_render)

    for n in notes:
        print(f"  ok  {n}")
    for p in problems:
        print(f"FAIL: {p}")
    if problems:
        print(f"\n{len(problems)} problem(s)")
        return 1
    print(f"\nOK: {len(everything)} types ({len(authorable)} authorable), "
          f"{reached} copies of that list, all agreeing with the renderers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
