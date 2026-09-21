#!/usr/bin/env python3
"""One SYNTH.live.counter() key must never be fed two different bases.

This is the mechanism behind a real bug rather than a hypothetical one.
market.js printed a category's size on the index and again on that
category's own page, both through

    SYNTH.live.counter('market:cat:' + id, <base>, 24)

with the same key and a different base -- the index counted the authored
listings, the category page counted those plus the generated ones. Same
key, two seeds, two numbers for one category, on every category of all four
market sites. classifieds.verity.net said Vehicles (121) on its index and
"142 listings indexed" on the Vehicles page.

counter(key, base, perDay) is `base + floor(days since EPOCH * perDay)`
jittered by a hash of the key, so a shared key is a deliberate statement
that two call sites are printing THE SAME NUMBER. Differing bases make that
statement false, silently, and only on a page nobody compared side by side.

This is a text-level parse of the renderers, not a JS parser: it reads the
call, splits the arguments at top-level commas, and compares the base
expressions as written. Two call sites that compute the same base through
differently-spelled expressions would be reported as a disagreement, which
is the safe direction to be wrong in -- it is noisy, not blind.

Keys are grouped by their STRING LITERALS, not by the text of the whole
expression. The first version of this file grouped by the raw text, and so
it passed clean on the market bug re-introduced on purpose: the index wrote
`'market:cat:' + cats[i].id` and the category page wrote `'market:cat:' +
cat.id`, which are one key at runtime and two different strings on the
page. A check that cannot catch the one bug it was written for is not a
check. The literals are what make two call sites the same key; the variable
part is the thing that varies.

That grouping is deliberately coarse: two call sites whose literals match
but whose variables never take the same value would be reported even though
nothing collides at runtime. Again the safe direction -- and there are none
today, which is asserted below rather than assumed.

The coverage floors below are what stop the parse quietly matching nothing
after a refactor, which would read exactly like a clean sweep.
"""
import argparse
import pathlib
import re
import sys

CALL = re.compile(r"\b(counter|online)\(\s*")
LITERAL = re.compile(r"'([^']*)'|\"([^\"]*)\"")

# What the parse must still find, or it has stopped working. Today there are
# 45 keyed call sites and 8 keys used from two places; these sit below that
# so an ordinary edit does not trip them, and far enough above zero that a
# broken regex does. The first draft of the whole-file version matched a
# greedy `(?:.|\n)+` and swallowed the rest of each file -- 3 calls parsed,
# nothing shared -- and these two lines are the only reason that showed up
# as a failure instead of as a pass.
MIN_KEYS = 40
MIN_SHARED = 6


def split_args(rest):
    """Top-level comma split of an argument list, stopping at its ')'."""
    depth = 0
    parts = []
    cur = ""
    for ch in rest:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            if depth == 0:
                break
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    parts.append(cur.strip())
    return parts


def skeleton(key):
    """The string literals in a key expression, in order.

    'market:cat:' + cats[i].id  ->  ('market:cat:',)
    'market:cat:' + cat.id      ->  ('market:cat:',)   same key
    'agg:' + dom + ':pts:' + id ->  ('agg:', ':pts:')
    'agg:' + dom + ':live:' + i ->  ('agg:', ':live:')  different key
    """
    return tuple(a or b for a, b in LITERAL.findall(key))


def base_form(expr):
    """A base expression with the ARGUMENTS of any call blanked out.

        catBase(data, cats[i].id)  ->  catBase(…)
        catBase(data, cat.id)      ->  catBase(…)     same base
        30 + n * 7                 ->  30 + n * 7
        30 + hits.length * 7       ->  30 + hits.length * 7   different

    Two call sites printing one number through one shared key have to say
    so in a way a reader can check, and one named function called from both
    is that way. Arithmetic spelled out twice is not: `30 + n * 7` and
    `30 + hits.length * 7` were the same number for exactly as long as
    nobody edited either line, and before that they were the bug.

    Blanking the arguments is what lets the check accept a shared helper
    called with a loop variable on one page and a local on the other, while
    still refusing two hand-written sums.
    """
    out = []
    depth = 0
    for ch in expr:
        if ch == "(":
            depth += 1
            if depth == 1:
                out.append("(…")
            continue
        if ch == ")":
            depth -= 1
            if depth == 0:
                out.append(")")
            continue
        if depth == 0:
            out.append(ch)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()

    files = sorted(root.glob("app/*.js")) + sorted(root.glob("app/types/*.js"))
    if not files:
        print(f"FAIL: no renderer sources under {root}/app")
        return 1

    keys = {}
    for f in files:
        rel = f.relative_to(root)
        # Whole file, not line by line. The first version read one line at a
        # time, so wrapping a call across two lines -- which is what putting
        # the shared market helper in made it do -- dropped it from the
        # parse without a word. A check that stops seeing the file it was
        # written for reads identically to a clean sweep.
        src = f.read_text()
        for m in CALL.finditer(src):
            parts = split_args(src[m.end():])
            if len(parts) < 3:
                continue
            key = parts[0]
            # Only calls whose key is a literal or a concatenation
            # involving one -- `counter(key, base, perDay)` inside a
            # local wrapper names no key and is not a call site.
            sk = skeleton(key)
            if not sk:
                continue
            line = src.count("\n", 0, m.start()) + 1
            keys.setdefault(sk, []).append((f"{rel}:{line}", key, parts[1]))

    problems = []
    shared = 0
    for sk, uses in sorted(keys.items()):
        if len(uses) < 2:
            continue
        shared += 1
        bases = sorted({base_form(b) for _, _, b in uses})
        if len(bases) > 1:
            where = "; ".join(f"{loc} ({key}) feeds {b!r}"
                              for loc, key, b in uses)
            problems.append(
                f"the key {' + … + '.join(sk)!r} is fed {len(bases)} "
                f"different bases -- {where}. Two pages printing one number "
                "is what a shared key means, so they will print two")

    if len(keys) < MIN_KEYS:
        problems.append(
            f"only {len(keys)} keyed counter/online calls were parsed, under "
            f"the floor of {MIN_KEYS}. The parse has stopped matching, which "
            "reads exactly like a clean sweep")
    if shared < MIN_SHARED:
        problems.append(
            f"only {shared} key(s) are used from more than one call site, "
            f"under the floor of {MIN_SHARED}. This check asserts nothing "
            "about a key used once, so with none shared it asserts nothing "
            "at all")

    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1

    print(f"  ok  {len(keys)} keyed counter/online call sites across "
          f"{len(files)} files")
    print(f"  ok  {shared} key(s) printed from two places, each from one base")
    print()
    print("OK: no live counter key is seeded two different ways.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
