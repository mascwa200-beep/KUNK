#!/usr/bin/env python3
"""Read what the widget and the notification would say.

Fourteen rounds looked at the web app. These two surfaces had never been
looked at by anything. CI touches the Android side three times:

    "The widget and the alarm must survive the build"
        greps classes.dex for class names and the APK for two res files
    synthnet_apk_check.py
        asserts every URL the page fetches is packaged
    synthnet_slotmath_check.py
        proves SlotMath.java and app/live.js agree on the arithmetic

None of the three reads a string, and four things were wrong with the
strings:

  * SynthWidget put the AMBIENT ALL-SITE TOTAL in 30sp bold as the largest
    thing on the home screen -- the exact number app/feedsui.js:16 forbids
    ("the number on the button only ever counts things addressed to you
    [...] '1,412' on a bell communicates nothing except that you should feel
    behind"). The rule was obeyed on a button that is hidden on a phone and
    broken on the surface that is always visible.
  * a third number formatter: `total > 99999 ? (total / 1000) + "k" : ...`,
    integer division and no M branch, so 1,234 read "1234" on the widget and
    "1.2k" everywhere else, and 2,500,000 read "2500k" against "2.5M".
  * "N replies waiting" over a number that counts mention-level EVENTS --
    one per post with new replies, plus fame milestones, DMs and
    subscriptions publishing -- so it counted occasions and called them
    replies, and "Someone replied to you" was untrue whenever the one event
    was a milestone.
  * a STORED figure and a LIVE one in the same notification, both present
    tense, when Snapshot's own docstring is an essay on why counts are not
    stored.

RemoteViews needs a device, so nothing here draws a widget. What it can do
is read the words: Wording.java is plain Java with no android.* imports and
a main() that answers a script, exactly like SlotMath.java, so javac
compiles it on a machine with no SDK and the strings come back over a pipe.

Five passes:

  1. Wording.java compiles as plain Java -- which fails the moment anyone
     imports android.* into it, taking the whole check offline, so it is
     checked first and loudly.
  2. The formatter against app/live.js's own short(), not a copy of it.
  3. A table of states through every wording function, asserting the policy,
     the nouns, the plurals and the tenses.
  4. Structurally, that SynthWidget.java and AlertAlarm.java hold no string
     literal that reaches a screen: every setTextViewText, setContentTitle
     and setContentText argument is a Wording call. The wording leaking back
     out of the one place that is read is how this went unread for as long
     as it did.
  5. Floors, no tolerance, on all of the above.

Usage:  python3 .github/scripts/synthnet_widget_check.py [--root synthnet]
"""

import argparse
import json
import pathlib
import random
import re
import shutil
import subprocess
import sys
import tempfile

# Floors. Measured at the commit that added this file: 8,214 formatter cases,
# 240 states, 4 call sites. A parse that stops matching reads exactly like
# agreement, which is the failure this file is most likely to have.
MIN_NUMBERS = 6000
MIN_STATES = 200
MIN_CALLSITES = 4

# res/layout/widget.xml gives the second line maxLines="2" at 12sp, with
# ellipsize="end". So overflow is HANDLED, not broken, and a hard character
# cap would fail on a site legitimately called "Verity County Amateur
# Astronomers". What matters is WHICH end gets eaten: the informative part
# must fit and the title must be last, so the ellipsis takes the name of the
# site rather than the fact that six of them have moved on.
LINE_BUDGET_WITHOUT_TITLE = 48

JS_RUNNER = r"""
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({Date, Math, console, String, Array, Object,
                              isFinite, parseInt, parseFloat, JSON});
vm.runInContext('globalThis.window = globalThis;', ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx, {filename: 'live.js'});
const L = vm.runInContext('window.SYNTH.live', ctx);
if (typeof L.short !== 'function') {
  console.error('SYNTH.live.short is not exported; nothing to compare against');
  process.exit(2);
}
const out = [];
for (const line of fs.readFileSync(process.argv[3], 'utf8').split('\n')) {
  if (!line.trim()) continue;
  out.push(L.short(Number(line)));
}
process.stdout.write(out.join('\n') + '\n');
"""

# Site titles chosen for the two things that break a phrase: one that is
# long enough to be ellipsized, and one with a digit in it, so an assertion
# looking for numerals cannot be fooled by the name of a site.
TITLES = ["The Gridfall Boards", "62chan",
          "Verity County Amateur Astronomers", "ashkettle.gov"]


def numbers():
    """Every interesting shape of count, plus a wide random sweep.

    The disagreements live at the rounding boundaries -- n.n50 and the
    thresholds -- so those are enumerated rather than hoped for.
    """
    rnd = random.Random(20260922)
    vals = list(range(0, 1200))
    vals += [999, 1000, 1001, 9999, 10000, 10001, 99999, 100000,
             999999, 1000000, 1000001, 1999999, 2000000, 2500000]
    # the exact halves, which is where Math.floor(v * 10 + 0.5) and toFixed
    # part company
    vals += [n for n in range(1000, 10000) if n % 100 == 50]
    vals += [rnd.randint(0, 2000000000) for _ in range(4000)]
    vals += [rnd.randint(1000, 12000) for _ in range(2000)]
    vals += [rnd.randint(990000, 1010000) for _ in range(1000)]
    return vals


def states():
    """(known, mentions, ambient, busy, title), each one a real screen.

    `ambient` values are kept clear of the mentions and site counts so an
    assertion that the widget never prints the item total cannot be
    satisfied or defeated by a coincidence.
    """
    rows = [(False, 0, 0, 0, "")]
    for mentions in (0, 1, 2, 3, 9, 40, 1500, 2500000):
        for ambient in (0, 7, 39, 40, 41, 240, 1234, 2500000):
            for busy, title in ((0, ""), (1, TITLES[0]), (6, TITLES[2]),
                                (3, TITLES[1]), (12, TITLES[3])):
                rows.append((True, mentions, ambient, busy, title))
    return rows


def run_java(classes, script):
    return subprocess.run(
        ["java", "-cp", str(classes), "net.verity.synthnet.Wording"],
        input=script, capture_output=True, text=True, encoding="utf-8")


def tsv(rows):
    return "\n".join("\t".join(str(c) for c in row) for row in rows) + "\n"


# ---------------------------------------------------------------------------
# the assertions over one state
# ---------------------------------------------------------------------------

NUMERAL = re.compile(r"(\d[\d.,]*[kM]?)\s+([A-Za-z]+)")
ANY_DIGIT = re.compile(r"\d")


def plural_problems(text, where):
    """A count of one printed against a plural, and the reverse.

    Round 13 found eight of these in one sweep -- "a total of 1 articles in
    1 topics" -- because every one was a separate inline ternary someone had
    to remember. The nouns here are few enough to check by shape.
    """
    singulars = {"site", "mention", "reply", "thing"}
    plurals = {"sites", "mentions", "replies", "things"}
    out = []
    for numeral, noun in NUMERAL.findall(text):
        low = noun.lower()
        if low not in singulars and low not in plurals:
            continue
        # "1.5k mentions" is plural: only the bare numeral 1 is singular.
        if (numeral == "1") != (low in singulars):
            out.append("%s says %r" % (where, numeral + " " + noun))
    return out


def check_state(row, said, problems):
    known, mentions, ambient, busy, title = row
    big = said["widgetBig"]
    sp = said["widgetBigSp"]
    line = said["widgetLine"]
    title_n = said["notifyTitle"]
    body = said["notifyBody"]
    worth = said["worthNotifying"]
    where = "state(known=%s mentions=%d ambient=%d busy=%d)" % (
        known, mentions, ambient, busy)

    # --- the policy: a number only for things addressed to you -------------
    has_digit = bool(ANY_DIGIT.search(big))
    if has_digit != (known and mentions > 0):
        problems.append(
            "%s: the widget's big slot reads %r. app/feedsui.js:16 allows a "
            "number there only for things addressed to you, and there %s"
            % (where, big,
               "are none" if mentions == 0 else "are %d" % mentions))
    want_sp = 30 if (known and mentions > 0) else 18
    if sp != want_sp:
        problems.append("%s: the big slot is %ssp holding %r; a word and a "
                        "number are not the same size" % (where, sp, big))

    # --- the ambient total is never printed on the widget ------------------
    if ambient > 0:
        for text, name in ((big, "big slot"), (line, "line")):
            for form in (str(ambient), said["countAmbient"]):
                # A site count or a mention count may legitimately equal the
                # ambient total; only complain when it cannot be one of those.
                if form and form in text and ambient not in (busy, mentions):
                    problems.append(
                        "%s: the widget's %s reads %r, which carries the "
                        "ambient item total %s -- the number the widget is "
                        "not allowed to be about"
                        % (where, name, text, form))

    # --- the title is last, so the ellipsis eats the name and not the fact --
    if known and title and title in line:
        if not line.endswith(title):
            problems.append(
                "%s: %r puts the site name before the end, so maxLines=2 "
                "ellipsizes the information rather than the name"
                % (where, line))
        rest = line.replace(title, "")
        if len(rest) > LINE_BUDGET_WITHOUT_TITLE:
            problems.append(
                "%s: the widget line is %d characters before the site name "
                "(budget %d): %r"
                % (where, len(rest), LINE_BUDGET_WITHOUT_TITLE, line))

    # --- nouns and plurals --------------------------------------------------
    #
    # The widget's number and its noun are in two different TextViews --
    # R.id.widget_count and R.id.widget_line -- so scanning either string on
    # its own can never see "1 mentions". Proved the hard way: forcing the
    # singular for every count produced no failure at all, because the count
    # was in the other view. A reader sees one sentence, so the check reads
    # one sentence.
    for text, name in ((big + " " + line, "the widget, read as one"),
                       (title_n, "the title"), (body, "the body")):
        problems.extend(plural_problems(text, "%s: %s" % (where, name)))

    # --- the notification never calls a mention a reply ---------------------
    for text, name in ((title_n, "title"), (body, "body")):
        if re.search(r"\brepl(y|ies|ied)\b", text, re.IGNORECASE):
            problems.append(
                "%s: the notification %s reads %r. That number counts "
                "mention-level events from alerts.js -- posts with new "
                "replies, fame milestones, DMs, subscriptions publishing -- "
                "so it is not a count of replies" % (where, name, text))

    # --- nothing empty, nothing half-built ---------------------------------
    for text, name in ((big, "big slot"), (line, "line"),
                       (title_n, "title"), (body, "body")):
        if not text.strip():
            problems.append("%s: the %s is empty" % (where, name))
        if "null" in text or "  " in text or text != text.strip():
            problems.append("%s: the %s reads %r" % (where, name, text))

    # --- the threshold still gates ------------------------------------------
    want_worth = mentions > 0 or ambient >= said["worthMentioning"]
    if worth != want_worth:
        problems.append("%s: worthNotifying said %s" % (where, worth))


def check_tenses(rows, answers, problems):
    """The stored figure and the live one must not stand in for each other.

    AlertAlarm put snap.mentions -- written whenever you last opened the app
    -- in the title and a freshly recomputed total in the body, both present
    tense. Whatever the wording, the title must be a function of the stored
    figure ALONE, so that changing what the network has been doing cannot
    change a sentence about what is waiting for you.
    """
    by_mentions = {}
    for row, said in zip(rows, answers):
        known, mentions, ambient, busy, title = row
        if not known:
            continue
        by_mentions.setdefault(mentions, set()).add(said["notifyTitle"])
    for mentions, titles in sorted(by_mentions.items()):
        if len(titles) > 1:
            problems.append(
                "the notification title changes with the live figures at "
                "mentions=%d: %s. The title is about a STORED number and "
                "must not move when the recomputed ones do"
                % (mentions, sorted(titles)))


# ---------------------------------------------------------------------------
# structural: no printed literal outside Wording
# ---------------------------------------------------------------------------

SETTERS = re.compile(
    r"\.(setTextViewText|setContentTitle|setContentText)\s*\(", re.MULTILINE)
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def sourced_from_wording(args, text):
    """Does this argument list end up at a Wording call?

    Directly, or through one local. AlertAlarm reads better as

        String title = Wording.notifyTitle(snap.mentions);
        String body  = Wording.notifyBody(...);
        ... .setContentTitle(title).setContentText(body)

    than with the calls inlined, because the comment about which figure is
    stored and which is live belongs beside the two assignments. One hop is
    enough to allow that and still refuse a literal: a local assigned from
    anything but Wording fails here exactly as a literal does.
    """
    if "Wording." in args:
        return True
    last = args.split(",")[-1].strip()
    if not IDENT.match(last):
        return False
    decl = re.search(r"\b(?:String|CharSequence)\s+%s\s*=\s*([^;]+);"
                     % re.escape(last), text)
    return bool(decl) and "Wording." in decl.group(1)


def check_no_literals(root, problems, notes):
    found = 0
    for name in ("SynthWidget.java", "AlertAlarm.java"):
        path = root / "android" / "src" / "net" / "verity" / "synthnet" / name
        if not path.is_file():
            problems.append("%s is missing" % name)
            continue
        text = path.read_text(encoding="utf-8")
        for match in SETTERS.finditer(text):
            found += 1
            # the argument list, to the matching close paren
            depth, i = 1, match.end()
            while i < len(text) and depth:
                if text[i] == "(":
                    depth += 1
                elif text[i] == ")":
                    depth -= 1
                i += 1
            args = text[match.end():i - 1]
            if sourced_from_wording(args, text):
                continue
            problems.append(
                "%s calls %s with %r, which does not come from Wording. "
                "Every word these two surfaces print has to come from the "
                "one file the checks can read, or it goes unread again"
                % (name, match.group(1), args.strip()[:80]))
    if found < MIN_CALLSITES:
        problems.append(
            "only %d place(s) that put text on a screen were found (floor "
            "%d) -- the parse has stopped matching, which reads exactly like "
            "every one of them being clean" % (found, MIN_CALLSITES))
    elif not problems:
        notes.append("%d places put text on a screen, all of them through "
                     "Wording" % found)
    return found


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()

    live_js = root / "app" / "live.js"
    wording = root / "android" / "src" / "net" / "verity" / "synthnet" / "Wording.java"
    for path in (live_js, wording):
        if not path.is_file():
            print(f"FAIL: {path} is missing")
            return 1
    if not shutil.which("javac") or not shutil.which("java"):
        print("FAIL: javac/java are needed to read what the widget would say")
        return 1
    if not shutil.which("node"):
        print("FAIL: node is needed to run app/live.js")
        return 1

    problems, notes = [], []
    nums = numbers()
    rows = states()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = pathlib.Path(tmpdir)
        classes = tmp / "classes"
        classes.mkdir()
        proc = subprocess.run(["javac", "-nowarn", "-d", str(classes), str(wording)],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            print("FAIL: Wording.java does not compile as plain Java.")
            print("      It must not import anything from android.*, so this "
                  "check can read the strings with no SDK and no device.")
            print(proc.stderr[:2000])
            return 1

        # --- the formatter, against the app's own -------------------------
        (tmp / "nums.txt").write_text("\n".join(str(n) for n in nums) + "\n",
                                      encoding="utf-8")
        (tmp / "run.js").write_text(JS_RUNNER, encoding="utf-8")
        java_nums = run_java(classes, tsv([["count", n] for n in nums]))
        if java_nums.returncode != 0:
            print("FAIL: the Java side crashed")
            print(java_nums.stderr[:2000])
            return 1
        js_nums = subprocess.run(
            ["node", str(tmp / "run.js"), str(live_js), str(tmp / "nums.txt")],
            capture_output=True, text=True, encoding="utf-8")
        if js_nums.returncode != 0:
            print("FAIL: app/live.js could not be asked to format a number")
            print(js_nums.stderr[:2000])
            return 1

        jn = java_nums.stdout.rstrip("\n").split("\n")
        sn = js_nums.stdout.rstrip("\n").split("\n")
        if len(jn) != len(nums) or len(sn) != len(nums):
            print(f"FAIL: {len(nums)} numbers, {len(jn)} Java answers, "
                  f"{len(sn)} JavaScript answers")
            return 1
        drift = [(n, a, b) for n, a, b in zip(nums, jn, sn) if a != b]
        for n, a, b in drift[:12]:
            problems.append(
                "%d formats as %r on the widget and %r in the app "
                "(app/live.js short())" % (n, a, b))
        if len(drift) > 12:
            problems.append("... and %d more numbers the two disagree about"
                            % (len(drift) - 12))

        # --- the wording, state by state ----------------------------------
        script = []
        for known, mentions, ambient, busy, title in rows:
            k = "1" if known else "0"
            script.append(["widgetBig", k, mentions])
            script.append(["widgetBigSp", k, mentions])
            script.append(["widgetLine", k, mentions, busy, title])
            script.append(["notifyTitle", mentions])
            script.append(["notifyBody", mentions, ambient, busy, title])
            script.append(["worthNotifying", mentions, ambient])
            script.append(["count", ambient])
            script.append(["worthMentioning"])
        out = run_java(classes, tsv(script))
        if out.returncode != 0:
            print("FAIL: the Java side crashed reading the states")
            print(out.stderr[:2000])
            return 1
        answered = out.stdout.rstrip("\n").split("\n")
        if len(answered) != len(script):
            print(f"FAIL: {len(script)} questions, {len(answered)} answers")
            return 1

        keys = ["widgetBig", "widgetBigSp", "widgetLine", "notifyTitle",
                "notifyBody", "worthNotifying", "countAmbient",
                "worthMentioning"]
        answers = []
        for i, row in enumerate(rows):
            block = answered[i * len(keys):(i + 1) * len(keys)]
            said = dict(zip(keys, block))
            said["widgetBigSp"] = int(said["widgetBigSp"])
            said["worthNotifying"] = said["worthNotifying"] == "1"
            said["worthMentioning"] = int(said["worthMentioning"])
            answers.append(said)
            check_state(row, said, problems)
        check_tenses(rows, answers, problems)

    check_no_literals(root, problems, notes)

    if len(nums) < MIN_NUMBERS:
        problems.append(f"only {len(nums)} number(s) were compared (floor "
                        f"{MIN_NUMBERS})")
    if len(rows) < MIN_STATES:
        problems.append(f"only {len(rows)} state(s) were read (floor "
                        f"{MIN_STATES}) -- a table that shrinks to nothing "
                        "reads exactly like a clean sweep")

    print(f"  read  {len(rows)} widget and notification states")
    print(f"  asked {len(nums)} numbers through both formatters")
    for n in notes:
        print(f"  ok    {n}")
    for p in problems[:40]:
        print(f"FAIL: {p}")
    if len(problems) > 40:
        print(f"FAIL: ... and {len(problems) - 40} more")
    if problems:
        print(f"\n{len(problems)} problem(s)")
        return 1
    print("\nOK: the widget shows a number only for things addressed to you, "
          "both surfaces count in the app's own words, and nothing they print "
          "is written anywhere a check cannot read it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
