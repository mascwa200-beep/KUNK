#!/usr/bin/env python3
"""The documents have to answer to the repository.

Fifteen rounds read the code and the content. Nobody read the README against
the build, and four of its claims were false. The worst was the project's
headline safety claim, stated in bold in two files:

    README.md:36    "the app declares **no permissions at all**"
    docs/PHONE.md   "**The app declares no permissions at all.** Not
                     internet, not storage, not anything."

AndroidManifest.xml declares two. And the manifest says so, in a comment
sitting directly above them:

    What changed is that "declares no permissions at all" is no longer
    literally true, so the CI gate is now an allowlist rather than a count.

So the repository held the correction and the uncorrected sentence at the
same time, and the CI step that was rewritten for exactly this reason never
looked at the prose that had gone stale because of it.

The substance was fine throughout -- no INTERNET permission, the process
still cannot open a socket, and the allowlist still fails the build on
anything network-shaped. Only the sentence was wrong. That is the whole
class this file exists for: prose stating something the repository can
answer, checked nowhere.

WHAT IT CAN AND CANNOT DO. It cannot read prose. It can take a fact the
build knows -- which permissions are declared, which files exist, which
regions are generated -- and insist the documents match it. The README also
said "no posting, no accounts, the forms are furniture" for months after all
three stopped being true, and no pattern would have caught that; it was
fixed by hand and stays unchecked, which the round said out loud rather than
pretending otherwise.

Usage:  python3 .github/scripts/synthnet_docs_check.py [--root synthnet]
"""

import argparse
import pathlib
import re
import sys

# Floors, no tolerance. A regex that stops matching reads exactly like every
# claim being true. Measured at the commit that added this file: 2 declared
# permissions, 3 generated regions, 41 path claims across four documents.
MIN_PERMISSIONS = 2
MIN_REGIONS = 3
MIN_PATHS = 20

# The contract's value tables. Measured at the commit that added these: SKINS
# holds 21 types and 31 skin names, PAGE_BLOCK_KINDS holds 10, RE_IMG accepts
# 5 image kinds, and docs/AUTHORING.md spells that last list out twice.
#
# MIN_IMG_LISTS is the one that earns its place. Both copies of the image
# kinds were stale, in two different sections, so a check that finds the first
# copy, agrees with it and stops would pass while the second stayed wrong --
# which is the exact failure it is here to catch.
MIN_SKIN_TYPES = 20
MIN_SKIN_NAMES = 28
MIN_BLOCK_KINDS = 9
MIN_IMG_KINDS = 4
MIN_IMG_LISTS = 2

DOCS = ["README.md", "docs/PHONE.md", "docs/AUTHORING.md", "docs/WORLD.md"]

# The regions tools/build.py rewrites in README.md. Its build_readme() warns
# and gives up if one is missing, and a warning does not fail a build, so the
# floor is enforced here instead.
REGIONS = ["era", "seed-sites", "measurements"]

USES_PERMISSION = re.compile(
    r"""<uses-permission\s+android:name\s*=\s*["']([^"']+)["']""")

# The manifest's comment block quotes the INTERNET permission in full, to say
# there deliberately is not one. Reading the file raw therefore reports the
# app declaring exactly what it is built not to declare -- the same shape as
# round 13's counter-key check reading a prose comment as code. Comments out
# first, offsets irrelevant here since only the names are wanted.
XML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)

# "no permissions at all", "declares no permissions", "zero permissions" --
# the shape of the claim that went stale, in any of the ways it was phrased.
NO_PERMISSIONS = re.compile(
    r"(?:no|zero)\s+permissions?\s+(?:at\s+all|of\s+any\s+kind|whatsoever)"
    r"|declares\s+no\s+permissions\b",
    re.IGNORECASE)

BACKTICKED = re.compile(r"`([^`\n]{2,90})`")

# Fenced blocks as well, and they are where it matters: README.md's Layout
# inventory and every "run this" block are fenced, so `tools/new_site.py`
# never appears between single backticks anywhere in the file. Renaming it to
# a script that does not exist produced no failure at all until this was
# added -- the assertion was reading the one place the paths are not.
FENCED = re.compile(r"^```[^\n]*\n(.*?)^```", re.DOTALL | re.MULTILINE)
WORDS = re.compile(r"[^\s`'\"(),;|]+")

# Paths the documents point a reader at. Content under net/sites/ is
# deliberately out: AUTHORING.md's worked example says "copy this to
# net/sites/kestrel-diner-verity-us/site.json", which is an instruction to
# create a file, not a claim that one is there.
PATH_PREFIXES = ("tools/", "docs/", "app/", "theme/", "android/",
                 ".claude/", ".github/", "net/registry.json",
                 "net/search.json", "index.html", "sw.js")


def path_claims(text):
    """Every token in the prose that asserts a file is in the repository.

    Both the backticked ones and the contents of fenced blocks, because the
    file inventory and the commands a reader is told to run are all fenced.
    """
    tokens = list(BACKTICKED.findall(text))
    for block in FENCED.findall(text):
        tokens.extend(WORDS.findall(block))
    out = []
    for token in tokens:
        token = token.strip().rstrip(".,:;")
        if not token.startswith(PATH_PREFIXES):
            continue
        if "<" in token or ">" in token or "*" in token or " " in token:
            continue        # a template or a glob, not a claim
        if token.endswith(".apk") or token.startswith("dist/"):
            continue        # build products, not in the tree
        if token not in out:
            out.append(token)
    return out


def check_permissions(root, repo, problems, notes):
    manifest = root / "android" / "AndroidManifest.xml"
    if not manifest.is_file():
        problems.append("android/AndroidManifest.xml is missing, so what the "
                        "app declares could not be read at all")
        return 0
    raw = manifest.read_text(encoding="utf-8")
    declared = USES_PERMISSION.findall(XML_COMMENT.sub(" ", raw))
    short = [p.rsplit(".", 1)[-1] for p in declared]
    documented = set()

    if "android.permission.INTERNET" in declared:
        problems.append(
            "the manifest declares INTERNET. The entire project rests on "
            "Android refusing every socket this process opens")

    if len(declared) < MIN_PERMISSIONS:
        problems.append(
            "only %d uses-permission line(s) were parsed out of the manifest "
            "(floor %d). The parse has stopped working, which reads exactly "
            "like the documents being right about them"
            % (len(declared), MIN_PERMISSIONS))
        return len(declared)

    for name in DOCS:
        path = root / name
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        claim = NO_PERMISSIONS.search(text)
        # "declares no INTERNET permission" is the true version and must not
        # be caught by the pattern above; it names a permission, so it never
        # matches "no permissions" on its own.
        if claim:
            line = text[:claim.start()].count("\n") + 1
            problems.append(
                "%s:%d says %r. The manifest declares %d: %s. Neither grants "
                "network access and the INTERNET one is still absent, so the "
                "claim to make is about INTERNET, not about the count"
                % (name, line, claim.group(0), len(declared),
                   ", ".join(short)))
        # A document that names ONE of them has to name all of them: a
        # half-updated list is how this went wrong in the first place. A
        # document that names none is simply not about this, and WORLD.md
        # using the word in "reader mail he retypes with permission" is not
        # a claim about an Android manifest.
        named = [b for b in short if b in text]
        if named and len(named) != len(short):
            problems.append(
                "%s names %s and not %s, and the app declares both"
                % (name, ", ".join(named),
                   ", ".join(b for b in short if b not in named)))
        if named:
            documented.update(named)

    for brief in short:
        if brief not in documented:
            problems.append(
                "the app declares %s and no document names it. Someone "
                "reading the README to find out what it wants would not "
                "learn that it wants this" % brief)

    # The CI allowlist is a third copy of the same list, and three copies
    # agreeing beats two disagreeing.
    workflow = repo / ".github" / "workflows" / "synthnet.yml"
    if workflow.is_file():
        flow = workflow.read_text(encoding="utf-8")
        for full in declared:
            if full not in flow:
                problems.append(
                    "the CI permission allowlist does not name %s, which the "
                    "manifest declares, so the build would fail on the app's "
                    "own manifest" % full)
    else:
        problems.append("the workflow is missing, so the allowlist could not "
                        "be compared against the manifest")

    if not problems:
        notes.append("the manifest, both documents and the CI allowlist name "
                     "the same %d permission(s): %s"
                     % (len(declared), ", ".join(short)))
    return len(declared)


SCRIPT_REF = re.compile(r"\.github/scripts/(synthnet_\w+\.py)")
PATH_FILTER = re.compile(r'-\s+"\.github/scripts/(synthnet_\w+\.py)"')


def check_workflow_filter(repo, problems, notes):
    """Every check a step runs must be in the workflow's own paths filter.

    The workflow only runs `on:` changes to a hand-written list of files, and
    that list names each check script one by one. Two rounds added a script
    and did not add it to the list, so editing only
    synthnet_search_check.py or synthnet_widget_check.py changed nothing CI
    would look at -- a check that cannot be triggered is a check that has
    stopped being one, and nothing anywhere said so.

    Both halves of the file are read: `on: push:` and `on: pull_request:`
    carry separate copies of the same list.
    """
    workflow = repo / ".github" / "workflows" / "synthnet.yml"
    if not workflow.is_file():
        problems.append("the workflow is missing")
        return 0
    text = workflow.read_text(encoding="utf-8")
    if "jobs:" not in text:
        problems.append("the workflow has no jobs: block to read")
        return 0
    head, body = text.split("jobs:", 1)
    run = set(SCRIPT_REF.findall(body))

    # The two filters are compared SEPARATELY. Reading them as one set was
    # the first version of this, and dropping a script from the push filter
    # alone passed, because the pull_request copy still named it -- so half
    # the triggers would have gone quiet and the check said they agreed.
    if "pull_request:" not in head:
        problems.append("the workflow has no pull_request: trigger to read")
        return len(run)
    push_block, pr_block = head.split("pull_request:", 1)
    ok = True
    for where, block in (("push", push_block), ("pull_request", pr_block)):
        listed = set(PATH_FILTER.findall(block))
        for name in sorted(run - listed):
            ok = False
            problems.append(
                ".github/scripts/%s is run by a step and is not in the "
                "workflow's %s paths filter, so editing it alone triggers "
                "nothing" % (name, where))
        for name in sorted(listed - run):
            ok = False
            problems.append(
                ".github/scripts/%s is in the %s paths filter and no step "
                "runs it" % (name, where))
    if not run:
        problems.append("no check scripts were found in the workflow body, "
                        "so the filters were compared against nothing")
    elif ok:
        notes.append("%d check scripts, every one of them in both paths "
                     "filters" % len(run))
    return len(run)


def check_regions(root, problems, notes):
    readme = root / "README.md"
    if not readme.is_file():
        problems.append("README.md is missing")
        return 0
    text = readme.read_text(encoding="utf-8")
    found = 0
    for name in REGIONS:
        pattern = re.compile(
            r"<!-- generated: %s[^>]*-->\n(.*?)<!-- /generated: %s -->"
            % (re.escape(name), re.escape(name)), re.DOTALL)
        match = pattern.search(text)
        if not match:
            problems.append(
                "README.md has no '<!-- generated: %s -->' region. "
                "tools/build.py only WARNS when it cannot find one, and a "
                "warning does not fail a build, so the region would quietly "
                "stop being generated and go stale the way the hand-written "
                "version did" % name)
            continue
        if not match.group(1).strip():
            problems.append(
                "README.md's '%s' region is empty, so the build wrote nothing "
                "into it and nothing says so" % name)
            continue
        found += 1
    if found < MIN_REGIONS:
        problems.append("only %d of %d generated region(s) were found in "
                        "README.md (floor %d)"
                        % (found, len(REGIONS), MIN_REGIONS))
    elif found:
        notes.append("%d generated region(s) in README.md, all present and "
                     "filled" % found)
    return found


# --------------------------------------------------------------------------
# The contract's value tables, against the code that enforces them.
# --------------------------------------------------------------------------

# The skins table. Anchored on its header row rather than on a line count,
# because rows get added. Its era column splits some types over two rows --
# `forum` archive/2026, `news` archive/2026 -- so the comparison is against
# the UNION of every row for a type, not row by row. Hard-coding which types
# are split would be one more hand-written copy of something the file already
# says.
#
# Every class here is newline-free on purpose. Written first with `\s` in the
# separator row, it matched across the line break and swallowed the first data
# row -- so `forum` was read from its 2026 row alone and the archive skins
# looked undocumented. Both floors passed while it did, because 21 types and
# 31 names still came through; the two-way comparison below is what caught it.
SKIN_TABLE = re.compile(
    r"^\|[ \t]*era[ \t]*\|[ \t]*type[ \t]*\|[ \t]*skins[ \t]*\|[^\n]*\n"
    r"^\|[-|: \t]+\n"
    r"((?:^\|[^\n]*\n)+)", re.MULTILINE)

# The BLOCK listing: the fenced block that enumerates the legal page blocks.
# Identified by the one kind that has been in it since the beginning rather
# than by position. The worked-example JSON further down writes `"kind":`
# with the key quoted, so it cannot be mistaken for this.
BLOCK_KIND = re.compile(r"(?<!\")\bkind:\s*\"([a-z]+)\"")

# Every place the document spells out the image kinds. Anchored on the two
# ends of the list, on one line, because the point of this assertion is that
# it must find BOTH copies -- see MIN_IMG_LISTS.
IMG_LIST = re.compile(r"\bavatar\b[a-z|\t ]*\bthumb\b")

# markup.js's two tables, and page.js's third.
JS_SIZES = re.compile(r"var\s+SIZES\s*=\s*\{(.*?)\}", re.DOTALL)
JS_IMG_SIZE = re.compile(r"var\s+IMG_SIZE\s*=\s*\{(.*?)\n\s*\};", re.DOTALL)
JS_KEY = re.compile(r"^\s*([a-z]+)\s*:\s*\[", re.MULTILINE)
JS_RE_IMG = re.compile(r"RE_IMG\s*=\s*/\^\\\[img:\(([a-z|]+)\)")


def _skins_from_doc(text, problems):
    """{type: set(skin)} as docs/AUTHORING.md states it."""
    match = SKIN_TABLE.search(text)
    if not match:
        problems.append(
            "docs/AUTHORING.md has no `| era | type | skins |` table to read. "
            "Its own caption calls tools/validate.py the authority and says "
            "'this table mirrors it', and nothing was mirroring anything")
        return {}
    table = {}
    for row in match.group(1).splitlines():
        cols = row.split("|")
        if len(cols) < 4:
            continue
        kinds = BACKTICKED.findall(cols[2])
        if not kinds:
            continue            # a separator or a continuation, not a row
        table.setdefault(kinds[0], set()).update(BACKTICKED.findall(cols[3]))
    return table


def check_contract_tables(root, problems, notes):
    """AUTHORING.md's lists of legal values, against what enforces them.

    README.md sends an author here first -- "read it first; the renderers will
    not guess at key names" -- and three of its tables had drifted from the
    code that rejects the wrong answer.

    The skins table says, above itself, "tools/validate.py (`SKINS`) is the
    authority; this table mirrors it". It did not. SKINS["social"] holds
    feedslate and the table did not mention it anywhere, while four of the six
    social sites were already wearing it -- so the contract offered a 2026
    social author no legal skin at all, and the majority answer was the
    missing one.

    PAGE_BLOCK_KINDS holds ten kinds and the BLOCK listing had nine. The
    missing one, `buttons`, is used by 22 of the 109 sites.

    And the image kinds are written five times: SIZES in app/markup.js, RE_IMG
    directly below it, IMG_SIZE in app/types/page.js, and this document twice.
    Round 14 added `button` to the first two -- under a comment in markup.js
    saying the two "must agree" -- and left the other three behind. A list
    written five times is this project's oldest disease; the path table was
    written down five times by hand and derived from the renderers in none of
    them. This makes all five answer to RE_IMG, which is the copy that decides
    whether a tag parses.

    Everything here is imported or read out of the source. Nothing is
    restated: a check that re-types a tuple agrees with whatever that tuple
    gets wrong next.
    """
    doc = root / "docs" / "AUTHORING.md"
    if not doc.is_file():
        problems.append("docs/AUTHORING.md is missing, so the contract an "
                        "author is told to read first cannot be checked")
        return 0
    text = doc.read_text(encoding="utf-8")

    sys.path.insert(0, str(root / "tools"))
    try:
        import validate as V
    except Exception as exc:                          # pragma: no cover
        problems.append("tools/validate.py will not import (%s), so the "
                        "authority for the skins and block tables cannot be "
                        "read" % exc)
        return 0

    conclusive = 0

    # ---- skins ----------------------------------------------------------
    stated = _skins_from_doc(text, problems)
    types_seen, names_seen = 0, 0
    for kind in sorted(V.SKINS):
        legal = set(V.SKINS[kind])
        listed = stated.get(kind, set())
        if kind in stated:
            types_seen += 1
        names_seen += len(legal)
        conclusive += len(legal | listed)
        for skin in sorted(legal - listed):
            problems.append(
                "tools/validate.py accepts `%s` for a `%s` site and "
                "docs/AUTHORING.md's skins table does not list it. An author "
                "reading the contract cannot pick a skin the validator is "
                "waiting for -- which is how `feedslate` stayed out of the "
                "document while four of the six social sites wore it"
                % (skin, kind))
        for skin in sorted(listed - legal):
            problems.append(
                "docs/AUTHORING.md's skins table offers `%s` for a `%s` site "
                "and tools/validate.py rejects it, so the contract is telling "
                "an author to write something that fails the build"
                % (skin, kind))
    for kind in sorted(set(stated) - set(V.SKINS)):
        problems.append(
            "docs/AUTHORING.md's skins table has a row for `%s`, which is not "
            "a type tools/validate.py knows" % kind)
    if types_seen < MIN_SKIN_TYPES:
        problems.append(
            "only %d type(s) were read out of the skins table (floor %d). The "
            "row parse has stopped matching, which reads exactly like every "
            "type agreeing" % (types_seen, MIN_SKIN_TYPES))
    if names_seen < MIN_SKIN_NAMES:
        problems.append(
            "only %d skin name(s) came out of tools/validate.py (floor %d)"
            % (names_seen, MIN_SKIN_NAMES))

    # ---- page blocks ----------------------------------------------------
    fenced = [b for b in FENCED.findall(text) if 'kind: "heading"' in b]
    if not fenced:
        problems.append(
            "docs/AUTHORING.md has no BLOCK listing to read -- no fenced "
            "block enumerating `kind: \"heading\"` -- so the legal page "
            "blocks are stated nowhere an author can find them")
        listed_blocks = set()
    else:
        listed_blocks = set()
        for block in fenced:
            listed_blocks.update(BLOCK_KIND.findall(block))
    legal_blocks = set(V.PAGE_BLOCK_KINDS)
    conclusive += len(legal_blocks | listed_blocks)
    for kind in sorted(legal_blocks - listed_blocks):
        problems.append(
            "tools/validate.py accepts a `%s` page block and "
            "docs/AUTHORING.md's BLOCK listing does not mention it. `buttons` "
            "was missing this way while 22 of the 109 sites used one"
            % kind)
    for kind in sorted(listed_blocks - legal_blocks):
        problems.append(
            "docs/AUTHORING.md's BLOCK listing offers a `%s` block and "
            "tools/validate.py rejects it" % kind)
    if len(legal_blocks) < MIN_BLOCK_KINDS:
        problems.append(
            "only %d page block kind(s) came out of tools/validate.py "
            "(floor %d)" % (len(legal_blocks), MIN_BLOCK_KINDS))

    # ---- image kinds, all five copies -----------------------------------
    markup = root / "app" / "markup.js"
    page = root / "app" / "types" / "page.js"
    if not markup.is_file() or not page.is_file():
        problems.append("app/markup.js or app/types/page.js is missing, so "
                        "the image kinds have no authority to answer to")
        return conclusive
    mtext = markup.read_text(encoding="utf-8")
    ptext = page.read_text(encoding="utf-8")

    m = JS_RE_IMG.search(mtext)
    if not m:
        problems.append(
            "app/markup.js's RE_IMG could not be read. It is the copy that "
            "decides whether an [img:...] tag parses at all, so every other "
            "copy of the list answers to it and there is nothing to answer to")
        return conclusive
    authority = [k for k in m.group(1).split("|") if k]
    if len(authority) < MIN_IMG_KINDS:
        problems.append(
            "only %d image kind(s) came out of RE_IMG (floor %d)"
            % (len(authority), MIN_IMG_KINDS))
    ordered = list(authority)
    authority = set(authority)

    for label, src, pattern in (("app/markup.js's SIZES", mtext, JS_SIZES),
                                ("app/types/page.js's IMG_SIZE", ptext,
                                 JS_IMG_SIZE)):
        found = pattern.search(src)
        if not found:
            problems.append("%s could not be read, so it cannot be held to "
                            "RE_IMG" % label)
            continue
        keys = set(JS_KEY.findall(found.group(1)))
        conclusive += len(authority | keys)
        for k in sorted(authority - keys):
            problems.append(
                "RE_IMG accepts `%s` and %s has no entry for it, so the tag "
                "parses and then draws at the wrong size or not at all. That "
                "is how 221 buttons across 22 walls rendered as grey boxes "
                "with their own seed printed inside" % (k, label))
        for k in sorted(keys - authority):
            problems.append(
                "%s can draw `%s` and RE_IMG will not match it, so the tag "
                "renders as its own source text" % (label, k))

    copies = IMG_LIST.findall(text)
    for copy in copies:
        spelled = set(w.strip() for w in copy.split("|") if w.strip())
        conclusive += len(authority | spelled)
        for k in sorted(authority - spelled):
            problems.append(
                "RE_IMG accepts the image kind `%s` and docs/AUTHORING.md "
                "leaves it out of `%s`" % (k, copy.strip()))
        for k in sorted(spelled - authority):
            problems.append(
                "docs/AUTHORING.md offers the image kind `%s` in `%s` and "
                "RE_IMG will not match it" % (k, copy.strip()))
    if len(copies) < MIN_IMG_LISTS:
        problems.append(
            "found %d spelled-out image-kind list(s) in docs/AUTHORING.md "
            "(floor %d). The document states the list in two separate "
            "sections and both of them went stale; a check that finds the "
            "first, agrees with it and stops is the bug this exists to catch"
            % (len(copies), MIN_IMG_LISTS))

    if not problems:
        notes.append(
            "the skins table and the BLOCK listing answer to tools/validate.py; "
            "%d other copies of the image kinds answer to RE_IMG (%s)"
            % (len(copies) + 2, "|".join(ordered)))
    return conclusive


def check_paths(root, repo, problems, notes):
    checked = 0
    for name in DOCS:
        path = root / name
        if not path.is_file():
            problems.append("%s is named in this check and is missing" % name)
            continue
        for token in path_claims(path.read_text(encoding="utf-8")):
            checked += 1
            if (root / token).exists() or (repo / token).exists():
                continue
            problems.append(
                "%s points a reader at `%s`, which is not in the repository. "
                "The seed-site list went wrong exactly this way -- it named "
                "five domains that did not exist -- and nothing noticed"
                % (name, token))
    if checked < MIN_PATHS:
        problems.append(
            "only %d path(s) named in the documents were checked (floor %d). "
            "The extraction has stopped matching, which reads exactly like "
            "every one of them being there" % (checked, MIN_PATHS))
    elif not problems:
        notes.append("%d file(s) the documents point at are all there"
                     % checked)
    return checked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    repo = root.parent

    problems, notes = [], []
    permissions = check_permissions(root, repo, problems, notes)
    regions = check_regions(root, problems, notes)
    paths = check_paths(root, repo, problems, notes)
    scripts = check_workflow_filter(repo, problems, notes)
    tables = check_contract_tables(root, problems, notes)

    print(f"  read  {len(DOCS)} documents and the workflow")
    print(f"        {permissions} declared permission(s), {regions} generated "
          f"region(s), {paths} path claim(s), {scripts} check scripts")
    print(f"        {tables} conclusive comparison(s) between the contract's "
          f"value tables and the code that enforces them")
    for n in notes:
        print(f"  ok    {n}")
    for p in problems:
        print(f"FAIL: {p}")
    if problems:
        print(f"\n{len(problems)} problem(s)")
        return 1
    print("\nOK: the documents say what the repository says.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
