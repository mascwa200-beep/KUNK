#!/usr/bin/env python3
"""Prove the Java clock and the JavaScript clock agree, exactly.

The app shows what it shows because of one function: a feed item is
pool[hash(key, slot) % pool.length], where slot is minutes-since-epoch over an
interval. app/live.js computes that for the page. android/.../SlotMath.java
computes it for the home-screen widget and the notification, because when the
app is closed there is no WebView to ask -- and a cached number would be wrong
within minutes and increasingly wrong for exactly as long as the app stays
shut, which is when it is being read.

That is a duplicate implementation, and duplicates drift. The drift here would
be quiet and nasty: the widget would say four new replies and the app would
show seven, with nothing failing anywhere.

Worse, the two languages disagree about arithmetic unless you are careful.
JavaScript numbers are IEEE754 doubles, so `(h * 16777619) >>> 0` is a double
multiply whose product exceeds 2^53 and is therefore rounded before being
truncated to uint32. The obvious Java translation -- a 32-bit int multiply --
is exact, and gives different hashes. SlotMath.hash32 deliberately does that
step in double arithmetic to match the rounding rather than the intent, and
this check is the only thing that says whether that was right.

Both implementations are fed the same script and their output compared line
for line.

Usage:  python3 .github/scripts/synthnet_slotmath_check.py [--root synthnet]
"""

import argparse
import json
import pathlib
import random
import shutil
import subprocess
import sys
import tempfile


def build_script():
    """The same questions, in a fixed order, for both implementations."""
    rnd = random.Random(20260919)
    lines = [["epoch"]]

    words = ["threads:boards.gridfall.net", "wire:now.verityledger.com",
             "agg:gridline.social:front", "farm:kestrel-journal.net",
             "shop:deals:shopwell.store", "", "a", "éèê",
             "the quick brown fox jumps over the lazy dog",
             "x" * 200]
    for w in words:
        lines.append(["hash32", w])
        lines.append(["rng", w])
    # Random keys, because the interesting failures are in the rounding and
    # those only show up on some inputs.
    for _ in range(400):
        key = "".join(rnd.choice("abcdefghijklmnopqrstuvwxyz0123456789.:-")
                      for _ in range(rnd.randint(1, 40)))
        lines.append(["hash32", key])
        lines.append(["rng", key])

    # Every hour of a week, so the whole busyness curve is covered.
    base = 1789084800000  # a Saturday, well after the epoch
    for h in range(24 * 7):
        lines.append(["busyness", str(base + h * 3600000)])

    for key in ("threads:boards.gridfall.net", "wire:now.verityledger.com"):
        for interval in (4, 7, 9, 11, 13):
            for slot in range(0, 4000, 137):
                lines.append(["slotLive", key, str(slot), str(interval)])

    now = base + 9 * 3600000
    for days in (0, 1, 3, 7, 30):
        for interval in (4, 9, 11):
            lines.append(["countSince", "threads:boards.gridfall.net",
                          str(interval), str(now - days * 86400000), str(now)])

    return lines


JS_RUNNER = r"""
const fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({Date, Math, console, String, Array, Object,
                              isFinite, parseInt, parseFloat, JSON});
vm.runInContext('globalThis.window = globalThis;', ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx, {filename: 'live.js'});
const L = vm.runInContext('window.SYNTH.live', ctx);

const fix = (n) => n.toFixed(12);
const out = [];
for (const line of fs.readFileSync(process.argv[3], 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const p = line.split('\t');
  switch (p[0]) {
    case 'epoch':     out.push(String(L.EPOCH)); break;
    case 'hash32':    out.push(String(L.hash32(p[1]))); break;
    case 'rng':       out.push(fix(L.rng(p[1])())); break;
    case 'busyness':  out.push(fix(L.busyness(Number(p[1])))); break;
    case 'slotLive':  out.push(L.slotLive(p[1], Number(p[2]), Number(p[3])) ? '1' : '0'); break;
    case 'countSince': {
      // alerts.js does this inline; mirror it exactly here.
      const key = p[1], interval = Number(p[2]), since = Number(p[3]), now = Number(p[4]);
      const nowSlot = Math.floor((now - L.EPOCH) / (interval * 60000));
      let sinceSlot = Math.floor((since - L.EPOCH) / (interval * 60000));
      if (sinceSlot < 0) sinceSlot = nowSlot - 1;
      const from = Math.max(sinceSlot + 1, nowSlot - 600);
      let n = 0;
      for (let s = from; s <= nowSlot; s++) if (L.slotLive(key, s, interval)) n++;
      out.push(String(n));
      break;
    }
    default: out.push('?');
  }
}
process.stdout.write(out.join('\n') + '\n');
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="synthnet")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()

    live_js = root / "app" / "live.js"
    slot_java = root / "android" / "src" / "net" / "verity" / "synthnet" / "SlotMath.java"
    for path in (live_js, slot_java):
        if not path.is_file():
            print(f"FAIL: {path} is missing")
            return 1

    if not shutil.which("javac") or not shutil.which("java"):
        print("FAIL: javac/java are needed to cross-check the widget arithmetic")
        return 1
    if not shutil.which("node"):
        print("FAIL: node is needed to run app/live.js")
        return 1

    script = build_script()
    text = "\n".join("\t".join(row) for row in script) + "\n"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = pathlib.Path(tmpdir)
        (tmp / "script.tsv").write_text(text, encoding="utf-8")
        (tmp / "run.js").write_text(JS_RUNNER, encoding="utf-8")

        # SlotMath.java is plain Java with no Android imports, precisely so it
        # can be compiled here with no SDK and no device.
        classes = tmp / "classes"
        classes.mkdir()
        proc = subprocess.run(
            ["javac", "-nowarn", "-d", str(classes), str(slot_java)],
            capture_output=True, text=True)
        if proc.returncode != 0:
            print("FAIL: SlotMath.java does not compile as plain Java.")
            print("      (it must not import anything from android.*, so this "
                  "check can run without an SDK)")
            print(proc.stderr[:2000])
            return 1

        java_out = subprocess.run(
            ["java", "-cp", str(classes), "net.verity.synthnet.SlotMath"],
            input=text, capture_output=True, text=True)
        if java_out.returncode != 0:
            print("FAIL: the Java side crashed")
            print(java_out.stderr[:2000])
            return 1

        js_out = subprocess.run(
            ["node", str(tmp / "run.js"), str(live_js), str(tmp / "script.tsv")],
            capture_output=True, text=True)
        if js_out.returncode != 0:
            print("FAIL: the JavaScript side crashed")
            print(js_out.stderr[:2000])
            return 1

    jrows = java_out.stdout.strip().split("\n")
    srows = js_out.stdout.strip().split("\n")

    if len(jrows) != len(srows) or len(jrows) != len(script):
        print(f"FAIL: {len(script)} questions, {len(jrows)} Java answers, "
              f"{len(srows)} JavaScript answers")
        return 1

    mismatches = []
    for i, (row, j, s) in enumerate(zip(script, jrows, srows)):
        if j == s:
            continue
        # Floating point answers are compared to a tolerance; a difference in
        # the last place is not drift, and slotLive only compares against a
        # threshold anyway.
        if row[0] in ("rng", "busyness"):
            try:
                if abs(float(j) - float(s)) < 1e-9:
                    continue
            except ValueError:
                pass
        mismatches.append((row, j, s))

    if mismatches:
        print(f"FAIL: the Java clock and the JavaScript clock disagree on "
              f"{len(mismatches)} of {len(script)} answers.")
        print("      The widget and the app would show different numbers, and "
              "nothing else would notice.\n")
        for row, j, s in mismatches[:12]:
            print(f"  {' '.join(row)[:70]}")
            print(f"      java: {j}")
            print(f"      js:   {s}")
        return 1

    kinds = {}
    for row in script:
        kinds[row[0]] = kinds.get(row[0], 0) + 1
    print("OK: the Java and JavaScript clocks agree on all "
          f"{len(script)} answers (" +
          ", ".join(f"{v} {k}" for k, v in sorted(kinds.items())) + ").")
    return 0


if __name__ == "__main__":
    sys.exit(main())
