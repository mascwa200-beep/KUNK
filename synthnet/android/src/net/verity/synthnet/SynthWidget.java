package net.verity.synthnet;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * The home-screen widget: what the network has been doing while you were not
 * looking at it.
 *
 * This is the half of "tell me when things happen" that costs NOTHING. An
 * AppWidgetProvider is a BroadcastReceiver plus an XML file -- no permission
 * of any kind, no runtime prompt to decline, re-registered after a reboot by
 * the system, and never subject to the battery managers that throttle alarms
 * on Samsung and Xiaomi into roughly one delivery a day. If the notification
 * half gets strangled by an OEM, this keeps working.
 *
 * What it costs instead: it only exists if you place it, it cannot update
 * faster than every thirty minutes (updatePeriodMillis has a hard floor and
 * smaller values are silently clamped), and it makes no sound.
 *
 * The numbers are recomputed here, from SlotMath and the clock, every time it
 * draws. They are not read from anywhere. That is why the widget keeps
 * climbing for a week with the app never opened.
 */
public class SynthWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            manager.updateAppWidget(id, build(context));
        }
    }

    /** Also called by Bridge after the page saves a snapshot. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SynthWidget.class));
        if (ids == null) return;
        for (int id : ids) {
            manager.updateAppWidget(id, build(context));
        }
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget);

        Snapshot snap = Snapshot.load(context);
        long now = System.currentTimeMillis();

        String big;
        String line;

        if (!snap.known()) {
            big = "—";
            line = "Open Synthnet once and this fills in.";
        } else {
            int total = snap.totalUnread(now);
            int busy = snap.busySites(now);
            Snapshot.Site top = snap.busiest(now);

            big = total > 99999 ? (total / 1000) + "k" : String.valueOf(total);
            if (total == 0) {
                big = "0";
                line = "Nothing new. This will not last.";
            } else if (top != null) {
                line = busy == 1
                        ? "new on " + top.title
                        : "new across " + busy + " sites · mostly " + top.title;
            } else {
                line = "new since you looked";
            }
        }

        views.setTextViewText(R.id.widget_count, big);
        views.setTextViewText(R.id.widget_line, line);

        // Tapping anywhere opens the app. FLAG_IMMUTABLE is required from
        // API 31 and is correct here anyway -- nothing should be able to fill
        // in extras on our behalf.
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);

        return views;
    }
}
