package net.verity.synthnet;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * The notification half: a ping when the network has moved enough to be worth
 * mentioning.
 *
 * MECHANISM, and why this one. An inexact repeating alarm re-armed on each
 * fire, plus a BOOT_COMPLETED receiver to survive a restart. That needs two
 * permissions -- POST_NOTIFICATIONS (one runtime prompt, API 33+) and
 * RECEIVE_BOOT_COMPLETED (normal, invisible) -- and NEITHER GRANTS ANY
 * NETWORK ACCESS. The app still declares no INTERNET permission, so Android
 * still refuses every socket this process tries to open. The offline
 * guarantee is untouched; what changed is that "zero permissions" is no
 * longer literally true, which is why the CI gate is now an allowlist that
 * still fails the build on anything network-shaped.
 *
 * What was deliberately NOT used:
 *
 *   setExactAndAllowWhileIdle     needs SCHEDULE_EXACT_ALARM, which Android
 *                                 14 denies by default for apps targeting 33+
 *                                 and which would have to be granted by hand
 *                                 in a settings screen nobody visits. Nothing
 *                                 here is worth waking a phone on time for.
 *   a foreground service          three or four more permissions and a
 *                                 permanent notification, to tell you a
 *                                 fictional forum has new posts.
 *   anything in the WebView       Android WebView implements none of the
 *                                 Notifications API, Web Push, service-worker
 *                                 notifications, or the Badging API. There is
 *                                 no web path to this at all; it has to be
 *                                 native.
 *
 * STATED PLAINLY: on Samsung, Xiaomi and OnePlus, an app you have not opened
 * for a few days gets throttled to roughly one delivery a day, or none --
 * Samsung's default moves anything unused for three days into "sleeping
 * apps". No framework mechanism fixes that. It is most of why the widget
 * exists alongside this, since a widget is never throttled that way.
 */
public class AlertAlarm extends BroadcastReceiver {

    static final String ACTION_CHECK = "net.verity.synthnet.CHECK";
    static final String CHANNEL_ID = "synthnet_activity";
    private static final int NOTIFICATION_ID = 7311;
    private static final int REQUEST_CODE = 7311;

    /** Roughly every three hours. Inexact: the OS batches it with other work. */
    private static final long PERIOD_MS = 3L * 60 * 60 * 1000;

    /** Never ping more often than this, whatever the alarm does. */
    private static final long QUIET_MS = 5L * 60 * 60 * 1000;

    /* The threshold below which the network has not done anything worth
     * interrupting for lives in Wording.WORTH_MENTIONING, beside the sentence
     * it gates, so the check that reads the wording also reads the number
     * that decides whether the wording ever appears. */

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            // Alarms do not survive a reboot, so re-arm. (The app is also in
            // the stopped state until its first launch after install, so this
            // only ever helps once you have actually opened it.)
            schedule(context);
            SynthWidget.refreshAll(context);
            return;
        }

        if (ACTION_CHECK.equals(action)) {
            try {
                maybeNotify(context);
            } finally {
                // Re-arm every time rather than using setRepeating: an
                // inexact repeat that the OS defers can bunch up, and this way
                // the next one is always measured from the last actual fire.
                schedule(context);
            }
            SynthWidget.refreshAll(context);
        }
    }

    /* --- scheduling -------------------------------------------------------- */

    static void schedule(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        long at = System.currentTimeMillis() + PERIOD_MS;
        try {
            // Inexact on purpose: no permission, and the OS is free to batch
            // it with whatever else it is waking for, which is the polite
            // thing to do for something this unimportant.
            alarms.set(AlarmManager.RTC, at, pending(context));
        } catch (SecurityException denied) {
            // Nothing to fall back to, and nothing broken: the widget still
            // recomputes from the clock every time it draws.
        }
    }

    static void cancel(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pending(context));
    }

    private static PendingIntent pending(Context context) {
        Intent intent = new Intent(context, AlertAlarm.class);
        intent.setAction(ACTION_CHECK);
        return PendingIntent.getBroadcast(
                context, REQUEST_CODE, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /* --- the notification --------------------------------------------------- */

    static boolean notificationsAllowed(Context context) {
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= 33) {
            // The literal string rather than Manifest.permission.POST_NOTIFICATIONS,
            // so this compiles against whatever platform jar the build machine
            // happens to have. build.sh picks the newest stable one it finds.
            if (context.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return manager.areNotificationsEnabled();
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.channel_name),
                // LOW: it appears in the drawer without a sound or a
                // heads-up banner. A fictional county's forum being busy is
                // not worth making a phone buzz, and an app that buzzes for
                // this gets its notifications turned off within a day.
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(context.getString(R.string.channel_desc));
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    private void maybeNotify(Context context) {
        if (!notificationsAllowed(context)) return;

        long now = System.currentTimeMillis();
        if (now - Snapshot.lastNotified(context) < QUIET_MS) return;

        Snapshot snap = Snapshot.load(context);
        if (!snap.known()) return;

        int total = snap.totalUnread(now);
        int busy = snap.busySites(now);
        if (!Wording.worthNotifying(snap.mentions, total)) return;

        Snapshot.Site top = snap.busiest(now);
        String topTitle = top == null ? null : top.title;

        // The title is built from the stored figure and the body from the
        // live ones, in different tenses, and they never share a sentence.
        // They used to: `snap.mentions + " replies waiting"` over
        // `total + " other things happened too"`, both present tense, one of
        // them a floor written whenever you last opened the app. See Wording.
        String title = Wording.notifyTitle(snap.mentions);
        String body = Wording.notifyBody(snap.mentions, total, busy, topTitle);

        Intent open = new Intent(context, MainActivity.class);
        open.setAction(MainActivity.ACTION_OPEN_FEEDS);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(
                context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);

        Notification notification = builder
                .setSmallIcon(R.drawable.ic_stat_synthnet)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build();

        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.notify(NOTIFICATION_ID, notification);
        Snapshot.markNotified(context, now);
    }
}
