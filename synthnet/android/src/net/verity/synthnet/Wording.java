package net.verity.synthnet;

/**
 * Every word the widget and the notification put on a screen.
 *
 * WHY THIS FILE EXISTS. CI touches the Android side three times and, until
 * this class, none of those three read a single string. "The widget and the
 * alarm must survive the build" greps classes.dex for class names.
 * synthnet_apk_check.py asserts every URL the page fetches is packaged.
 * synthnet_slotmath_check.py proves SlotMath.java and app/live.js agree on
 * the arithmetic. On top of all of that sat the wording, unread by anything,
 * and it had four separate things wrong with it.
 *
 * DELIBERATELY NO ANDROID IMPORTS, for the same reason SlotMath.java has
 * none: .github/scripts/synthnet_widget_check.py compiles this with plain
 * javac on a machine with no SDK and no device, feeds main() a script of
 * states, and reads back what the two surfaces would say. RemoteViews needs
 * a device; a String does not.
 *
 * THE RULE THIS CLASS OBEYS is app/feedsui.js's, quoted there in full:
 *
 *     The number on the button only ever counts things addressed to you:
 *     replies to your posts, messages, the world reacting to you.
 *     Everything else -- sites you read having moved on -- gets a dot and
 *     no number. [...] "1,412" on a bell communicates nothing except that
 *     you should feel behind.
 *
 * SynthWidget put the ambient all-site total in 30sp bold as the largest
 * thing on the home screen: the exact number that sentence forbids, on the
 * one surface that is always visible, while the rule was obeyed on a button
 * that is hidden entirely on a phone.
 *
 * So: a number only for `mentions`, a phrase for everything else. The
 * ambient side names SITES rather than items on purpose -- six places have
 * moved on is information, and 1,412 items is a pressure gauge.
 *
 * MENTIONS IS A FLOOR, NOT A COUNT. It comes from app/alerts.js badge(),
 * written into the snapshot by app/hostbridge.js, and it cannot be
 * recomputed natively: it depends on bots.repliesFor(), which needs post
 * bodies, reply pools and a follower count, none of which cross the bridge.
 * hostbridge.js says so plainly -- "it is a snapshot and the notification
 * treats it as a floor rather than a live figure" -- and AlertAlarm did not:
 * it put the stored figure and a freshly recomputed total in one
 * notification, both present tense, so "3 replies waiting · 17 other things
 * happened too" could open a Feeds page saying five and two hundred. Here
 * the two never share a sentence, and they are written in different tenses.
 *
 * AND IT IS NOT A COUNT OF REPLIES. badge() counts mention-LEVEL EVENTS, and
 * alerts.js pushes those from four places: one per post that has new
 * replies, plus fame milestones, DMs and subscription publications. So the
 * old "3 replies waiting" counted posts and occasions, and the old "Someone
 * replied to you" was flatly untrue whenever that one event was a fame
 * milestone. The Feeds page's own tab calls this set Mentions, which is the
 * word used here.
 */
public final class Wording {

    private Wording() { }

    /** The big slot, when it holds a number. */
    public static final float SP_NUMBER = 30f;
    /** The big slot, when it holds a word. res/layout/widget.xml is 30sp. */
    public static final float SP_WORD = 18f;

    /** res/layout/widget.xml gives the second line maxLines="2" at 12sp. */
    public static final int LINE_BUDGET = 64;

    /** Below this, the network has not done anything worth interrupting for. */
    public static final int WORTH_MENTIONING = 40;

    /**
     * 12345 as "12.3k", the way app/live.js short() does it.
     *
     * That function is the app's only number formatter and SynthWidget had a
     * second one: `total > 99999 ? (total / 1000) + "k" : String.valueOf(total)`.
     * Integer division, a threshold two orders of magnitude off, and no M
     * branch at all, so 1,234 read "1234" on the home screen and "1.2k"
     * everywhere else, and 2,500,000 read "2500k" against "2.5M".
     *
     * synthnet_widget_check.py runs this and live.js over the same integers
     * and fails the build if they ever differ.
     */
    public static String count(int n) {
        if (n < 1000) return String.valueOf(n);
        if (n < 1000000) return fixed(n / 1000.0, n < 10000 ? 1 : 0) + "k";
        return fixed(n / 1000000.0, 1) + "M";
    }

    /**
     * JavaScript's Number.prototype.toFixed, exactly.
     *
     * Not `Math.floor(v * 10 + 0.5)`, which is the obvious translation and is
     * wrong. toFixed is specified on the EXACT value of the double -- "let n
     * be an integer for which n / 10^f - x is as close to zero as possible;
     * if there are two such n, pick the larger" -- and multiplying by ten
     * first rounds the value before the decision is made. Measured over 8,214
     * counts, the two disagreed on six of them, all of the form n.n50:
     * 1,150 read "1.2k" here and "1.1k" in app/live.js, because 1.15 as a
     * double is 1.14999999999999991, which toFixed rounds DOWN while
     * 1.15 * 10 rounds UP to exactly 11.5 first.
     *
     * new BigDecimal(double) is the exact binary value -- BigDecimal.valueOf
     * would go through Double.toString and re-introduce the same problem --
     * and HALF_UP is toFixed's "pick the larger n" on a genuine tie.
     */
    private static String fixed(double v, int digits) {
        return new java.math.BigDecimal(v)
                .setScale(digits, java.math.RoundingMode.HALF_UP)
                .toPlainString();
    }

    private static String plural(int n, String one, String many) {
        return n == 1 ? one : many;
    }

    /* --- the widget --------------------------------------------------------
     *
     * Two pieces of information and nothing else, which is what
     * res/layout/widget.xml's own comment asks for. */

    public static String widgetBig(boolean known, int mentions) {
        if (!known) return "—";
        if (mentions > 0) return count(mentions);
        return "Quiet for you";
    }

    public static float widgetBigSp(boolean known, int mentions) {
        return (known && mentions > 0) ? SP_NUMBER : SP_WORD;
    }

    public static String widgetLine(boolean known, int mentions,
                                    int busySites, String topTitle) {
        if (!known) return "Open Synthnet once and this fills in.";
        String ambient = ambient(busySites, topTitle);
        if (mentions > 0) {
            return plural(mentions, "mention", "mentions") + " · " + ambient;
        }
        return ambient;
    }

    /**
     * What the rest of the network has been doing. Never the item total: see
     * the rule at the top of this file.
     */
    private static String ambient(int busySites, String topTitle) {
        String top = title(topTitle);
        if (busySites <= 0 || top == null) {
            return "Nothing new anywhere. This will not last.";
        }
        if (busySites == 1) return "New on " + top;
        return "Busy across " + busySites + " sites · mostly " + top;
    }

    /* --- the notification --------------------------------------------------
     *
     * The stored figure and the live one go in separate sentences, in
     * different tenses, so neither can stand in for the other. */

    public static boolean worthNotifying(int mentions, int ambient) {
        return mentions > 0 || ambient >= WORTH_MENTIONING;
    }

    /** Draws on `mentions` and nothing else. */
    public static String notifyTitle(int mentions) {
        if (mentions <= 0) return "The county has been busy";
        // Not "Someone replied to you": one mention-level event can be a fame
        // milestone, a DM or a newsletter going out.
        if (mentions == 1) return "Something is waiting for you";
        return count(mentions) + " mentions waiting";
    }

    /** Draws on the live figures and nothing else. */
    public static String notifyBody(int mentions, int ambient,
                                    int busySites, String topTitle) {
        String top = title(topTitle);
        if (ambient <= 0 || top == null) {
            return mentions > 0
                    ? "Nothing else has moved since you last looked."
                    : "Across the sites you read.";
        }
        String much = count(ambient) + " new across " + busySites + " "
                + plural(busySites, "site", "sites") + ", mostly " + top;
        return mentions > 0 ? ("Since you last looked, " + much + ".")
                            : (much + ".");
    }

    /** A site title we would rather not print half of. */
    private static String title(String raw) {
        if (raw == null) return null;
        String t = raw.trim();
        return t.isEmpty() ? null : t;
    }

    /* --- the script runner -------------------------------------------------
     *
     * Reads TSV on stdin, one question per line, and prints one answer per
     * line -- the same shape SlotMath.main() uses, so the check can drive
     * both the same way. */

    public static void main(String[] args) throws java.io.IOException {
        java.io.BufferedReader in = new java.io.BufferedReader(
                new java.io.InputStreamReader(System.in, "UTF-8"));
        StringBuilder out = new StringBuilder();
        String line;
        while ((line = in.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            String[] p = line.split("\t", -1);
            if (p[0].equals("count")) {
                out.append(count(Integer.parseInt(p[1])));
            } else if (p[0].equals("widgetBig")) {
                out.append(widgetBig(flag(p[1]), Integer.parseInt(p[2])));
            } else if (p[0].equals("widgetBigSp")) {
                out.append((long) widgetBigSp(flag(p[1]), Integer.parseInt(p[2])));
            } else if (p[0].equals("widgetLine")) {
                out.append(widgetLine(flag(p[1]), Integer.parseInt(p[2]),
                        Integer.parseInt(p[3]), p[4]));
            } else if (p[0].equals("worthNotifying")) {
                out.append(worthNotifying(Integer.parseInt(p[1]),
                        Integer.parseInt(p[2])) ? "1" : "0");
            } else if (p[0].equals("notifyTitle")) {
                out.append(notifyTitle(Integer.parseInt(p[1])));
            } else if (p[0].equals("notifyBody")) {
                out.append(notifyBody(Integer.parseInt(p[1]), Integer.parseInt(p[2]),
                        Integer.parseInt(p[3]), p[4]));
            } else if (p[0].equals("lineBudget")) {
                out.append(LINE_BUDGET);
            } else if (p[0].equals("worthMentioning")) {
                out.append(WORTH_MENTIONING);
            } else {
                out.append("?");
            }
            out.append('\n');
        }
        // Explicitly UTF-8, not System.out, whose charset is whatever the
        // machine happens to default to. These strings carry an em dash and a
        // middle dot; on a machine defaulting to ASCII they came back as "?"
        // and the check would have been comparing mangled text against
        // mangled text and calling it agreement.
        java.io.Writer w = new java.io.OutputStreamWriter(
                new java.io.FileOutputStream(java.io.FileDescriptor.out), "UTF-8");
        w.write(out.toString());
        w.flush();
    }

    private static boolean flag(String s) {
        return "1".equals(s) || "true".equals(s);
    }
}
