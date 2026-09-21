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

SECOND RULE: a key must name the site it is printed on.

The same mechanism has a second failure mode, and it had thirteen instances.
A key built out of a row id and nothing else is shared by every site that
happens to use that id -- and the ids are not unique across sites, because
nothing ever said they had to be:

    36 of 123 market listing ids are on two sites
    23 of 187 shop product ids are on two sites
    18 of  20 qa question ids are on two sites
     4 of  46 shop category ids are on two sites

So `counter('market:views:' + l.id, 40, 130)` printed ONE number for two
unrelated listings. classifieds.verity.net's l-001 (a chest freezer in
Gridfall) and gridfall-buysell.net's l-001 (a different thing, different
seller) both read "804 views · 2 watching now", at the same instant,
drifting in lockstep for ever. shop.js was worse and clearer: urgencyBanner
is called three times, twice with ctx.site.domain and once with a bare
product id, so two unrelated stores agreed to the digit on "8,036 watching"
and "58 people are looking at this right now".

Domain-scoping is the convention the code already follows -- 40 of the 53
keyed call sites carried the site before this check existed, and every seed
variable in dash.js and stream.js is built from ctx.site.domain. These
thirteen were the ones that did not, and nothing could tell.

The rule is checked through one level of indirection in both directions: a
key spelled as a local variable is resolved to that variable's assignment,
and a key that names a PARAMETER of its enclosing function is resolved to
the arguments its callers pass. The second half is what reaches
urgencyBanner, whose key is `'shop:urgent:' + seed` and whose scope lives
entirely in its three call sites.
"""
import argparse
import pathlib
import re
import sys

CALL = re.compile(r"\b(counter|online)\(\s*")
# stream() picks pool rows by key, so it shares a key's fate: one key, one
# sequence. shop.js printed the same generated review under the same product
# id on two different stores through 'shop:rev:' + p.id.
SCOPED_CALL = re.compile(r"\b(counter|online|stream)\(\s*")
LITERAL = re.compile(r"'([^']*)'|\"([^\"]*)\"")
# What counts as naming the site.
SITE = re.compile(r"\bdomain\b|ctx\.site|S\.site|\bsiteKey\b")
IDENT = re.compile(r"[A-Za-z_$][\w$]*")
FUNC = re.compile(r"^[ \t]*function\s+(\w+)\s*\(([^)]*)\)", re.M)
# Identifiers in a key that are never the site: literals' neighbours.
BUILTIN = {"String", "Number", "encodeURIComponent", "join", "toLowerCase",
           "id", "length", "slice", "Math", "floor", "i", "j", "idx"}

# What the parse must still find, or it has stopped working. Today there are
# 45 keyed call sites and 8 keys used from two places; these sit below that
# so an ordinary edit does not trip them, and far enough above zero that a
# broken regex does. The first draft of the whole-file version matched a
# greedy `(?:.|\n)+` and swallowed the rest of each file -- 3 calls parsed,
# nothing shared -- and these two lines are the only reason that showed up
# as a failure instead of as a pass.
MIN_KEYS = 40
MIN_SHARED = 6
# Counter, online AND stream keys read for site scope. 53 today.
MIN_SCOPED = 45


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


def enclosing(src, pos):
    """(name, [params]) of the function the offset sits in, or None.

    Nearest preceding `function name(...)` at the start of a line. The
    renderers are one IIFE of top-level named functions each, so this is
    exact for them rather than approximate.
    """
    best = None
    for m in FUNC.finditer(src):
        if m.start() > pos:
            break
        best = m
    if best is None:
        return None
    return best.group(1), [p.strip() for p in best.group(2).split(",") if p.strip()]


def var_value(src, pos, name):
    """The last `var name = <expr>;` written before pos, or None."""
    rx = re.compile(r"\bvar\s+" + re.escape(name) + r"\s*=\s*([^;\n]+)")
    val = None
    for m in rx.finditer(src, 0, pos):
        val = m.group(1)
    return val


def caller_args(src, fn, index):
    """Every argument passed at position `index` to calls of fn in src.

    Skips the definition itself. Returns None if nothing calls it, which is
    a different answer from "nothing names the site" and is reported as its
    own failure -- an unreachable scope is not a satisfied one.
    """
    out = []
    for m in re.finditer(r"\b" + re.escape(fn) + r"\(\s*", src):
        head = src.rfind("\n", 0, m.start())
        if re.match(r"^[ \t]*function\s", src[head + 1:m.end()]):
            continue
        parts = split_args(src[m.end():])
        if len(parts) > index:
            out.append(parts[index])
    return out or None


def names_site(src, pos, key):
    """Does this key expression name the site, directly or one hop away?

    Returns (True, how) or (False, why).
    """
    if SITE.search(key):
        return True, "directly"
    fn = enclosing(src, pos)
    params = fn[1] if fn else []
    for ident in set(IDENT.findall(re.sub(r"'[^']*'|\"[^\"]*\"", "", key))):
        if ident in BUILTIN:
            continue
        if ident in params:
            args = caller_args(src, fn[0], params.index(ident))
            if args is None:
                return False, (f"{ident} is a parameter of {fn[0]}() and "
                               "nothing in this file calls it, so no call "
                               "site can be supplying the scope")
            bare = [a for a in args if not SITE.search(a)]
            if bare:
                return False, (f"{ident} comes from {fn[0]}(), and "
                               f"{len(bare)} of its {len(args)} call sites "
                               f"pass no site: {', '.join(sorted(bare))}")
            return True, f"via {fn[0]}()'s {len(args)} call sites"
        val = var_value(src, pos, ident)
        if val and SITE.search(val):
            return True, f"via var {ident}"
    return False, "the key names no site and neither does anything it is built from"


def scope_problems(files, root):
    """Every counter/online/stream key that is not scoped to one site."""
    problems = []
    checked = 0
    for f in files:
        rel = f.relative_to(root)
        src = f.read_text()
        for m in SCOPED_CALL.finditer(src):
            parts = split_args(src[m.end():])
            if len(parts) < 2:
                continue
            key = parts[0]
            if not skeleton(key):
                continue          # a wrapper's `counter(key, …)`, not a key
            checked += 1
            ok, why = names_site(src, m.start(), key)
            if not ok:
                line = src.count("\n", 0, m.start()) + 1
                problems.append(
                    f"{rel}:{line} {m.group(1)}({key}) is not scoped to a "
                    f"site -- {why}. Two sites reusing that id print one "
                    "number, or one sequence, for two different things")
    return problems, checked


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

    scoped, n_scoped = scope_problems(files, root)
    problems.extend(scoped)
    if n_scoped < MIN_SCOPED:
        problems.append(
            f"only {n_scoped} counter/online/stream call sites were read for "
            f"scope, under the floor of {MIN_SCOPED}. Nothing was asserted")

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
    print(f"  ok  {n_scoped} counter/online/stream keys, every one scoped to "
          "one site")
    print()
    print("OK: no live key is seeded two different ways, and none is shared "
          "by two sites.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
