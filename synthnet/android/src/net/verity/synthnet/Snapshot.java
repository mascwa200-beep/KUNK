package net.verity.synthnet;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What the page knows, in a form the widget and the alarm can read with no
 * WebView running.
 *
 * The app stores almost nothing on purpose -- everything is derived from the
 * clock. But the widget wakes up with the app closed and no JavaScript engine
 * anywhere, so it needs two things it cannot work out for itself: when you
 * last looked at each site, and which streams that site watches. Both are
 * small, both change only when you use the app, and neither is content.
 *
 * The counts themselves are NOT stored. They are recomputed by SlotMath every
 * time the widget draws, because a stored count is wrong within minutes and
 * increasingly wrong for exactly as long as the app stays closed -- which is
 * precisely when the widget is being read.
 *
 * Written by Bridge from inside the page; read by SynthWidget and AlertAlarm.
 */
public final class Snapshot {

    private static final String PREFS = "synthnet_snapshot";
    private static final String KEY_JSON = "snapshot";
    private static final String KEY_NOTIFIED = "last_notified";

    /** One site you have opened. */
    public static final class Site {
        public final String domain;
        public final String title;
        public final long at;              /* when you last looked */
        public final String[] feedKeys;
        public final int[] feedIntervals;

        Site(String domain, String title, long at, String[] keys, int[] intervals) {
            this.domain = domain;
            this.title = title;
            this.at = at;
            this.feedKeys = keys;
            this.feedIntervals = intervals;
        }

        /** How much has arrived here since you looked. */
        public int unread(long now) {
            int n = 0;
            for (int i = 0; i < feedKeys.length; i++) {
                n += SlotMath.countSince(feedKeys[i], feedIntervals[i], at, now);
            }
            return n;
        }
    }

    public final String handle;
    public final long seenAt;
    public final int mentions;       /* things addressed to you, at write time */
    public final Site[] sites;

    private Snapshot(String handle, long seenAt, int mentions, Site[] sites) {
        this.handle = handle;
        this.seenAt = seenAt;
        this.mentions = mentions;
        this.sites = sites;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_JSON, json).apply();
    }

    /** Never null: an app that has not been opened yet reports nothing. */
    public static Snapshot load(Context ctx) {
        String json = prefs(ctx).getString(KEY_JSON, null);
        if (json == null) return empty();
        try {
            JSONObject root = new JSONObject(json);
            JSONArray rows = root.optJSONArray("sites");
            int n = rows == null ? 0 : rows.length();
            Site[] sites = new Site[n];
            for (int i = 0; i < n; i++) {
                JSONObject row = rows.getJSONObject(i);
                JSONArray feeds = row.optJSONArray("feeds");
                int fn = feeds == null ? 0 : feeds.length();
                String[] keys = new String[fn];
                int[] intervals = new int[fn];
                for (int f = 0; f < fn; f++) {
                    JSONObject feed = feeds.getJSONObject(f);
                    keys[f] = feed.optString("key", "");
                    intervals[f] = feed.optInt("interval", 0);
                }
                sites[i] = new Site(
                        row.optString("domain", ""),
                        row.optString("title", row.optString("domain", "")),
                        row.optLong("at", 0L),
                        keys, intervals);
            }
            return new Snapshot(
                    root.optString("handle", ""),
                    root.optLong("seenAt", 0L),
                    root.optInt("mentions", 0),
                    sites);
        } catch (Exception malformed) {
            // A half-written or hand-edited snapshot must not take the widget
            // down; an empty one just means "nothing to report yet".
            return empty();
        }
    }

    private static Snapshot empty() {
        return new Snapshot("", 0L, 0, new Site[0]);
    }

    public boolean known() {
        return sites.length > 0 || seenAt > 0;
    }

    /** Total arrivals across every site you have opened. */
    public int totalUnread(long now) {
        int n = 0;
        for (Site s : sites) n += s.unread(now);
        return n;
    }

    /** How many sites have anything new at all. */
    public int busySites(long now) {
        int n = 0;
        for (Site s : sites) if (s.unread(now) > 0) n++;
        return n;
    }

    /** The site with the most waiting, or null. */
    public Site busiest(long now) {
        Site best = null;
        int bestN = 0;
        for (Site s : sites) {
            int n = s.unread(now);
            if (n > bestN) { bestN = n; best = s; }
        }
        return best;
    }

    /* --- notification throttling ------------------------------------------
     *
     * Kept here rather than in the receiver because it is state about the
     * snapshot, and because the widget must never reset it. */

    static long lastNotified(Context ctx) {
        return prefs(ctx).getLong(KEY_NOTIFIED, 0L);
    }

    static void markNotified(Context ctx, long at) {
        prefs(ctx).edit().putLong(KEY_NOTIFIED, at).apply();
    }
}
