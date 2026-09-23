#!/usr/bin/env python3
"""Nothing authored may be dated far enough ahead to read as the future.

milbrooknow.com carried eleven corrections dated after the simulation's
EPOCH, the newest 27 days out. news.js renders the corrections page grouped
under absolute month headings and filters nothing, so the page showed an
"October 2026" heading in September, and under it:

    2026-10-13  An earlier version of this item referred to the team as
                Kerrin Consolidated.
    2026-10-14  The correction published on October 13 is withdrawn.

A correction withdrawing a correction, both of them in a month that has not
happened.

WHY THE LIMIT IS NOT ZERO. Straddling EPOCH by a few days is deliberate and
the content is built for it. halseycountynow.com has a boil-water advisory
told across four updates whose dates each match the weekday the text names
-- samples Thursday, second set Friday, laboratory shut Saturday, result
Monday -- running from two days before EPOCH to two days after, so the
sequence reads correctly as the clock advances into it. live.js's ago()
clamps a negative delta to "just now", which is what makes the near side of
that invisible rather than wrong.

So the line is drawn from the measurements, not from taste: the deliberate
straddle is at most 3 days, the fault was 27, and a week sits between them
with clear margin on both sides.

EPOCH is read out of app/live.js rather than restated here, because a
restated constant is the thing this project keeps finding in five places.

SECOND RULE: a weekday named beside a date must be that date's weekday.

1,838 authored strings name a day of the week, and 508 of them name one
beside a date specific enough to check. All 508 are right, which is the
reason this rule is worth writing down: the content is held to it by hand
today, and a hand-held invariant with no check is one edit from being
false. A wrong weekday is the purest form of the fault this project keeps
finding -- it renders perfectly, reads naturally, and is wrong only to
somebody holding a calendar.

Two tiers, and the second is deliberately timid:

  * The year is IN the phrase -- "Friday 4 September 2026", 425 of them.
    Zero inference, so a mismatch is a fact.
  * The year is not, but the record carries its own date -- a post's `at`,
    a form's `name`. 83 of them. Here the resolver offers every year within
    a year of that anchor and accepts the phrase if ANY of them makes the
    weekday true. That is much weaker than picking one year, and it is
    weaker on purpose: the first draft picked the closest year and reported
    two faults, and both were the draft's. verityquilters.net's March post
    saying "Show date confirmed, Saturday 3 October" means the coming
    October, which is 205 days out, not the previous one at 160. And
    verityschools.org's "Monday 29 March to Friday 2 April 2027" states its
    year once, at the far end of the range, for both halves.

Both are right. The resolver was wrong twice, and a checker that cries
wolf about correct content gets switched off, so it now only speaks when
no reading of the year can save the phrase.

Usage:  python3 .github/scripts/synthnet_chrono_check.py [--root synthnet]
"""
import argparse
import datetime
import json
import pathlib
import re
import sys

# How far past EPOCH authored content may be dated. See the docstring.
GRACE_DAYS = 7

# The formats actually present across the 109 site.json, found by sweeping
# them rather than assumed: four spellings of `at`, two of `time`, and prose.
DATE_FORMS = (
    (re.compile(r"^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}Z?$"), "ymd"),
    (re.compile(r"^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}$"), "ymd"),
    (re.compile(r"^(\d{4})-(\d{2})-(\d{2}) \d{2}:\d{2}$"), "ymd"),
    (re.compile(r"^(\d{4})-(\d{2})-(\d{2})$"), "ymd"),
    (re.compile(r"^(\d{2})/(\d{2})/(\d{4})$"), "mdy"),
)
MONTHS = ("January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December")
PROSE = re.compile(r"^(" + "|".join(MONTHS) + r") (\d{1,2}), (\d{4})$")

# A copyright line naming a year later than the simulation's own is the same
# fault in a different shape -- verity-careers-portal.com said 2028.
COPYRIGHT = re.compile(r"Copyright \([cC]\)\s*(\d{4})")

DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
        "Sunday")
_D, _M = "|".join(DAYS), "|".join(MONTHS)
# What may sit between a weekday and the date it names. A comma and a space is
# the common case; a dash is not. marchfield-coop.com said "The Blue Kestrel
# closed Saturday -- 27 November 2006", and 27 November 2006 was a Monday, and
# this check read straight past it for a whole round because the separator was
# not a space. A rule that only fires on the punctuation it expected is a rule
# with a hole in it exactly the shape of the next mistake.
_SEP = r"(?:,?\s+|\s*[-\u2013\u2014]{1,2}\s*)"
# Tier one: the year is in the phrase.
DATED_DAY = (
    re.compile(r"\b(" + _D + r")" + _SEP + r"(\d{1,2})(?:st|nd|rd|th)?\s+(" +
               _M + r"),?\s+((?:19|20)\d{2})\b"),
    re.compile(r"\b(" + _D + r")" + _SEP + r"(" + _M +
               r")\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b"),
)
# Tier two: it is not, and the record's own date has to supply it.
BARE_DAY = (
    re.compile(r"\b(" + _D + r")" + _SEP + r"(\d{1,2})(?:st|nd|rd|th)?\s+(" +
               _M + r")\b(?!,?\s+(?:19|20)\d{2})"),
    re.compile(r"\b(" + _D + r")" + _SEP + r"(" + _M +
               r")\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!,?\s+(?:19|20)\d{2})"),
)
YEAR = re.compile(r"\b((?:19|20)\d{2})\b")
# How far from a record's own date a bare weekday phrase may sit and still
# take its year from it. A year either side, so a December post naming a
# January date and a March post naming the coming October both resolve.
ANCHOR_DAYS = 400

# Floors. A regex that stops matching reports that every date is fine.
MIN_DATES = 2000
MIN_DATED_DAYS = 350


def read_epoch(root):
    """EPOCH out of app/live.js: `Date.UTC(2026, 8, 19, 0, 0, 0)`."""
    text = (root / "app" / "live.js").read_text(encoding="utf-8")
    m = re.search(r"EPOCH\s*=\s*Date\.UTC\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)",
                  text)
    if not m:
        return None
    # JS months are zero-based.
    return datetime.date(int(m.group(1)), int(m.group(2)) + 1, int(m.group(3)))


def parse_date(value):
    """A date, or None if the string is not one. Never raises."""
    s = value.strip()
    for rx, order in DATE_FORMS:
        m = rx.match(s)
        if not m:
            continue
        a, b, c = m.groups()
        y, mo, d = (a, b, c) if order == "ymd" else (c, a, b)
        try:
            return datetime.date(int(y), int(mo), int(d))
        except ValueError:
            return None            # 31 February and friends
    m = PROSE.match(s)
    if m:
        try:
            return datetime.date(int(m.group(3)),
                                 MONTHS.index(m.group(1)) + 1,
                                 int(m.group(2)))
        except ValueError:
            return None
    return None


def walk(node, path, out, chain=()):
    """Collect (json path, string, enclosing objects) for every string.

    The chain is what lets a bare "Saturday 3 October" find the year: the
    nearest enclosing object that states a full date somewhere on its own
    scalar fields is the record the phrase belongs to.
    """
    if isinstance(node, dict):
        inner = chain + (node,)
        for k, v in node.items():
            walk(v, path + "." + str(k), out, inner)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, path + "[" + str(i) + "]", out, chain)
    elif isinstance(node, str):
        out.append((path, node, chain))


def anchor_dates(obj):
    """Full dates stated on one object's own scalar fields."""
    out = []
    for value in obj.values():
        if not isinstance(value, str):
            continue
        d = parse_date(value)
        if d is not None:
            out.append(d)
        for rx in DATED_DAY:
            for m in rx.finditer(value):
                a, b = m.group(2), m.group(3)
                mon, day = (b, a) if b in MONTHS else (a, b)
                try:
                    out.append(datetime.date(int(m.group(4)),
                                             MONTHS.index(mon) + 1, int(day)))
                except ValueError:
                    pass
    return out


def weekday_problems(strings, dom):
    """(problems, dated, anchored) for one site's strings."""
    problems, dated, anchored = [], 0, 0
    for where, value, chain in strings:
        for rx in DATED_DAY:
            for m in rx.finditer(value):
                a, b = m.group(2), m.group(3)
                mon, day = (b, a) if b in MONTHS else (a, b)
                try:
                    d = datetime.date(int(m.group(4)), MONTHS.index(mon) + 1,
                                      int(day))
                except ValueError:
                    continue
                dated += 1
                if DAYS[d.weekday()] != m.group(1):
                    problems.append(
                        f"{dom} {where} says {m.group(0)!r}, and {d} was a "
                        f"{DAYS[d.weekday()]}")

        bare = [m for rx in BARE_DAY for m in rx.finditer(value)]
        if not bare:
            continue
        anchors = []
        for obj in reversed(chain):          # nearest enclosing record first
            anchors = anchor_dates(obj)
            if anchors:
                break
        if not anchors:
            continue
        for m in bare:
            a, b = m.group(2), m.group(3)
            mon, day = (b, a) if b in MONTHS else (a, b)
            years = set()
            for anc in anchors:
                years.update((anc.year - 1, anc.year, anc.year + 1))
            # A year stated later in the same breath, for "29 March to 2
            # April 2027", where one year serves both ends of a range.
            for ym in YEAR.finditer(value[m.end():m.end() + 40]):
                years.add(int(ym.group(1)))
            cands = []
            for y in sorted(years):
                try:
                    c = datetime.date(y, MONTHS.index(mon) + 1, int(day))
                except ValueError:
                    continue
                if any(abs((c - anc).days) <= ANCHOR_DAYS for anc in anchors) \
                        or y in {int(x.group(1)) for x in
                                 YEAR.finditer(value[m.end():m.end() + 40])}:
                    cands.append(c)
            if not cands:
                continue
            anchored += 1
            if not any(DAYS[c.weekday()] == m.group(1) for c in cands):
                problems.append(
                    f"{dom} {where} says {m.group(0)!r}, and no year its "
                    f"record could mean makes that a {m.group(1)} -- "
                    + ", ".join(f"{c} was a {DAYS[c.weekday()]}"
                                for c in cands[:3]))
    return problems, dated, anchored


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()

    epoch = read_epoch(root)
    if epoch is None:
        print("FAIL: could not read EPOCH out of app/live.js")
        return 1
    limit = epoch + datetime.timedelta(days=GRACE_DAYS)

    problems, parsed, copyrights = [], 0, 0
    dated_days = anchored_days = 0
    files = sorted((root / "net" / "sites").glob("*/site.json"))
    if not files:
        print(f"FAIL: no site.json under {root}/net/sites")
        return 1

    for f in files:
        site = json.loads(f.read_text(encoding="utf-8"))
        dom = site.get("domain", f.parent.name)
        strings = []
        walk(site.get("data") or {}, "data", strings)

        wp, wd, wa = weekday_problems(strings, dom)
        problems.extend(wp)
        dated_days += wd
        anchored_days += wa

        for where, value, _chain in strings:
            d = parse_date(value)
            if d is not None:
                parsed += 1
                if d > limit:
                    problems.append(
                        f"{dom} {where} is dated {value} -- {(d - epoch).days} "
                        f"days after EPOCH ({epoch}), past the {GRACE_DAYS}-day "
                        "straddle the content is built for")
            for m in COPYRIGHT.finditer(value):
                copyrights += 1
                year = int(m.group(1))
                if year > epoch.year:
                    problems.append(
                        f"{dom} {where} claims copyright {year}, later than "
                        f"the simulation's own year ({epoch.year})")

    if parsed < MIN_DATES:
        problems.append(
            f"only {parsed} date(s) parsed, under the floor of {MIN_DATES}. "
            "The formats have moved and this check is reading past them, "
            "which looks exactly like a clean sweep")
    if dated_days < MIN_DATED_DAYS:
        problems.append(
            f"only {dated_days} fully-specified weekday phrase(s) were read, "
            f"under the floor of {MIN_DATED_DAYS}. That is the tier with no "
            "inference in it, so losing it loses the half of this rule worth "
            "trusting")
    if not copyrights:
        problems.append(
            "no copyright line was found at all, so that half of this check "
            "asserted nothing")

    print(f"  ok  {parsed} authored date(s) across {len(files)} sites, none "
          f"later than {limit}")
    print(f"  ok  {copyrights} copyright line(s), none later than {epoch.year}")
    print(f"  ok  {dated_days} weekday+date phrase(s) name the right weekday, "
          f"and {anchored_days} more do once the record supplies the year")
    print()
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems[:12]:
            print(f"  - {p}")
        if len(problems) > 12:
            print(f"  … and {len(problems) - 12} more")
        return 1
    print("OK: nothing authored is dated into a month that has not happened.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
