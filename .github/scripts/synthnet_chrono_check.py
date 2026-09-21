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

# Floors. A regex that stops matching reports that every date is fine.
MIN_DATES = 2000


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


def walk(node, path, out):
    """Collect (json path, string) for every string in the document."""
    if isinstance(node, dict):
        for k, v in node.items():
            walk(v, path + "." + str(k), out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, path + "[" + str(i) + "]", out)
    elif isinstance(node, str):
        out.append((path, node))


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
    files = sorted((root / "net" / "sites").glob("*/site.json"))
    if not files:
        print(f"FAIL: no site.json under {root}/net/sites")
        return 1

    for f in files:
        site = json.loads(f.read_text(encoding="utf-8"))
        dom = site.get("domain", f.parent.name)
        strings = []
        walk(site.get("data") or {}, "data", strings)

        for where, value in strings:
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
    if not copyrights:
        problems.append(
            "no copyright line was found at all, so that half of this check "
            "asserted nothing")

    print(f"  ok  {parsed} authored date(s) across {len(files)} sites, none "
          f"later than {limit}")
    print(f"  ok  {copyrights} copyright line(s), none later than {epoch.year}")
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
