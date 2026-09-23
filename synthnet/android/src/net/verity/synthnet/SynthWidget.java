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
 *
 * Every word this puts on the screen comes from Wording, which is plain Java
 * with no Android imports so that .github/scripts/synthnet_widget_check.py
 * can compile it and read back what this would say. Nothing here holds a
 * string literal that reaches a screen; the check asserts that, because the
 * wording leaking back out is how it went unread for as long as it did.
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

        boolean known = snap.known();
        int mentions = snap.mentions;
        int busy = known ? snap.busySites(now) : 0;
        Snapshot.Site top = known ? snap.busiest(now) : null;
        String topTitle = top == null ? null : top.title;

        views.setTextViewText(R.id.widget_count, Wording.widgetBig(known, mentions));
        views.setTextViewText(R.id.widget_line,
                Wording.widgetLine(known, mentions, busy, topTitle));

        // The big slot holds a number or a word depending on whether there is
        // anything addressed to you, and thirty-point bold is a size for a
        // number. COMPLEX_UNIT_SP is 2; the constant lives in
        // android.util.TypedValue, which Wording deliberately cannot import.
        views.setTextViewTextSize(R.id.widget_count, 2 /* SP */,
                Wording.widgetBigSp(known, mentions));

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
