package net.verity.synthnet;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * The wall clock, in Java.
 *
 * Everything this app shows is a pure function of the time: a feed item is
 * pool[hash(key, slot) % pool.length] where slot is minutes-since-epoch over
 * an interval. Nothing is stored and nothing is random, which is what lets
 * the network have moved while the app was shut without anything having run.
 *
 * The widget and the notification need the same answers with no WebView
 * anywhere -- the app is closed, there is no JavaScript engine, and there is
 * certainly no network. Caching the last numbers the page computed would not
 * do: the whole point is that the count keeps growing with the clock, so a
 * cached number is wrong within minutes and increasingly wrong for as long as
 * the app stays closed, which is exactly when it is being read.
 *
 * So the arithmetic is reimplemented here. That is a duplicate, and duplicates
 * drift, so .github/scripts/synthnet_slotmath_check.py runs this class and
 * app/live.js over the same inputs and fails the build if they ever disagree.
 *
 * DELIBERATELY NO ANDROID IMPORTS. This class is plain Java so that check can
 * compile and run it with javac on a machine with no SDK and no device.
 *
 * On the arithmetic itself: JavaScript numbers are IEEE754 doubles, and
 * `(h * 16777619) >>> 0` is a double multiply -- whose product exceeds 2^53
 * and is therefore ROUNDED -- followed by a truncation to uint32. A 32-bit
 * integer multiply in Java is exact and would give different answers. So the
 * FNV step below is done in double arithmetic on purpose, matching the
 * rounding rather than the intent. The mixing in rng() is different: it is
 * Math.imul and bitwise operators throughout, which are exact int32, so that
 * one uses Java ints.
 */
public final class SlotMath {

    /** Must equal EPOCH in app/live.js. */
    public static final long EPOCH;
    static {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(2026, Calendar.SEPTEMBER, 19, 0, 0, 0);
        EPOCH = c.getTimeInMillis();
    }

    private static final long MINUTE = 60000L;
    private static final double TWO32 = 4294967296.0;

    /** Reach by hour of day. Mirrors HOUR_WEIGHT in app/live.js. */
    private static final double[] HOUR_WEIGHT = {
        0.34, 0.28, 0.22, 0.20, 0.22, 0.30,
        0.48, 0.66, 0.82, 0.88, 0.86, 0.90,
        1.00, 0.92, 0.84, 0.84, 0.92, 1.04,
        1.18, 1.30, 1.34, 1.22, 0.92, 0.58
    };

    /** Sunday..Saturday. Mirrors DAY_WEIGHT in app/live.js. */
    private static final double[] DAY_WEIGHT = {
        1.06, 0.92, 0.97, 0.99, 1.00, 1.08, 1.12
    };

    private static final double QUIET_FLOOR = 0.34;

    private SlotMath() { }

    /**
     * FNV-1a as JavaScript computes it, rounding and all. See the class note.
     */
    public static long hash32(String s) {
        double h = 2166136261.0;
        for (int i = 0; i < s.length(); i++) {
            // `h ^= c` in JavaScript is ToInt32(h) ^ ToInt32(c), and ToInt32
            // is SIGNED: the result lives in [-2^31, 2^31). Keeping it
            // unsigned here looks harmless and is not -- it changes the
            // magnitude of the product below, which changes where the double
            // rounds, which changes the hash. Every seed on the network came
            // out different until this cast was added.
            int signed = ((int) (long) h) ^ s.charAt(i);

            // Deliberately a double multiply. The product reaches 2^55, past
            // the 53 bits a double carries, so it is rounded -- and it is
            // rounded in JavaScript too, identically, because both are
            // IEEE754. An exact 32-bit integer multiply here would be the
            // more obvious translation and would give different answers.
            h = (double) signed * 16777619.0;

            h = h % TWO32;              // ToUint32
            if (h < 0) h += TWO32;
        }
        return (long) h;
    }

    /**
     * mulberry32, one draw. Unlike the hash above this is Math.imul and
     * bitwise operators end to end, which are exact int32 in both languages,
     * so plain Java ints are correct here.
     */
    public static double rng(String seed) {
        int a = (int) hash32(seed);
        a = a + 0x6D2B79F5;
        int t = a;
        t = (t ^ (t >>> 15)) * (t | 1);
        t ^= t + ((t ^ (t >>> 7)) * (t | 61));
        return ((t ^ (t >>> 14)) & 0xFFFFFFFFL) / TWO32;
    }

    /**
     * How busy the network is at a given moment: 4am on a Tuesday against 9pm
     * on a Saturday. Never zero -- a quiet hour should stretch a feed out, not
     * empty it.
     *
     * Local time on purpose. The simulated county keeps the same hours as
     * whoever is holding the phone, which is the only version of this that
     * feels right.
     */
    public static double busyness(long at) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        double hourOfDay = c.get(Calendar.HOUR_OF_DAY) + c.get(Calendar.MINUTE) / 60.0;
        int lo = ((int) Math.floor(hourOfDay)) % 24;
        int hi = (lo + 1) % 24;
        double frac = hourOfDay - Math.floor(hourOfDay);
        double hour = HOUR_WEIGHT[lo] + (HOUR_WEIGHT[hi] - HOUR_WEIGHT[lo]) * frac;
        double w = hour * DAY_WEIGHT[c.get(Calendar.DAY_OF_WEEK) - 1];
        if (w < QUIET_FLOOR) return QUIET_FLOOR;
        return w > 1 ? 1 : w;
    }

    /** Did anything get posted in this slot? Deterministic per (key, slot). */
    public static boolean slotLive(String key, long slot, int intervalMin) {
        long at = EPOCH + slot * intervalMin * MINUTE;
        return rng(key + ":live:" + slot) < busyness(at);
    }

    /**
     * How many things have arrived on one stream since a moment. The same
     * question app/alerts.js asks, with the same cap: a month away is "lots",
     * not a reason to count to forty thousand on the main thread.
     */
    public static int countSince(String key, int intervalMin, long since, long now) {
        if (intervalMin <= 0) return 0;
        long nowSlot = (now - EPOCH) / (intervalMin * MINUTE);
        long sinceSlot = (since - EPOCH) / (intervalMin * MINUTE);
        if (sinceSlot < 0) sinceSlot = nowSlot - 1;
        long from = Math.max(sinceSlot + 1, nowSlot - 600);
        int n = 0;
        for (long s = from; s <= nowSlot; s++) {
            if (slotLive(key, s, intervalMin)) n++;
        }
        return n;
    }

    /**
     * A command-line entry point, used only by the CI cross-check against
     * app/live.js. Reads "op arg..." lines on stdin and prints one answer per
     * line, so the checker can feed both implementations the same script.
     */
    public static void main(String[] args) throws java.io.IOException {
        java.io.BufferedReader in = new java.io.BufferedReader(
                new java.io.InputStreamReader(System.in, "UTF-8"));
        StringBuilder out = new StringBuilder();
        String line;
        while ((line = in.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            String[] p = line.split("\t", -1);
            if (p[0].equals("hash32")) {
                out.append(hash32(p[1]));
            } else if (p[0].equals("rng")) {
                out.append(String.format(java.util.Locale.ROOT, "%.12f", rng(p[1])));
            } else if (p[0].equals("busyness")) {
                out.append(String.format(java.util.Locale.ROOT, "%.12f",
                        busyness(Long.parseLong(p[1]))));
            } else if (p[0].equals("slotLive")) {
                out.append(slotLive(p[1], Long.parseLong(p[2]),
                        Integer.parseInt(p[3])) ? "1" : "0");
            } else if (p[0].equals("countSince")) {
                out.append(countSince(p[1], Integer.parseInt(p[2]),
                        Long.parseLong(p[3]), Long.parseLong(p[4])));
            } else if (p[0].equals("epoch")) {
                out.append(EPOCH);
            } else {
                out.append("?");
            }
            out.append('\n');
        }
        System.out.print(out);
    }
}
