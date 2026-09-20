package net.verity.synthnet;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.webkit.JavascriptInterface;

/**
 * The one thing the page can call in the app.
 *
 * Exposed as window.SynthHost. It takes a snapshot of what the page knows --
 * when you last looked at each site and which streams that site watches -- so
 * the widget and the notification can keep computing counts long after the
 * WebView is gone. See Snapshot for why the counts themselves are not stored.
 *
 * On addJavascriptInterface, which is normally a serious hazard: the risk is
 * remote content reaching native code. There is no remote content. The app
 * holds no INTERNET permission, so the process cannot open a socket at all,
 * and AssetClient.shouldOverrideUrlLoading refuses to navigate anywhere but
 * the asset host. Everything that can call this shipped inside the APK.
 *
 * The surface is also deliberately tiny and one-directional: two methods, both
 * taking a string, neither returning anything the page did not already have.
 * There is nothing here to escalate into.
 */
public final class Bridge {

    private final Context app;

    Bridge(Context context) {
        // The application context, not the activity: this outlives the
        // activity and holding that would leak it.
        this.app = context.getApplicationContext();
    }

    /**
     * Store the page's snapshot and refresh the widget.
     *
     * Called by app/hostbridge.js after every navigation, which is cheap
     * (a few hundred bytes to SharedPreferences) and means the widget is
     * never more stale than your last use of the app.
     */
    @JavascriptInterface
    public void saveSnapshot(String json) {
        if (json == null || json.length() == 0 || json.length() > 64000) return;
        Snapshot.save(app, json);
        nudgeWidget();
    }

    /**
     * Ask for the notification permission, from a tap in the page rather than
     * out of nowhere on first launch.
     *
     * A permission dialog that appears before anyone knows what the app is
     * gets declined, and on Android 13+ a declined POST_NOTIFICATIONS is
     * final until the app is reinstalled. So the page asks when you turn
     * alerts on, and not before.
     */
    @JavascriptInterface
    public void requestAlerts() {
        Intent intent = new Intent(app, MainActivity.class);
        intent.setAction(MainActivity.ACTION_ASK_NOTIFY);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            app.startActivity(intent);
        } catch (Exception noActivity) {
            // Nothing sensible to do; the page's own settings still work.
        }
    }

    /** True when the OS will actually show what we post. */
    @JavascriptInterface
    public boolean alertsEnabled() {
        return AlertAlarm.notificationsAllowed(app);
    }

    private void nudgeWidget() {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(app);
            ComponentName widget = new ComponentName(app, SynthWidget.class);
            int[] ids = manager.getAppWidgetIds(widget);
            if (ids == null || ids.length == 0) return;   // not placed
            Intent intent = new Intent(app, SynthWidget.class);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            app.sendBroadcast(intent);
        } catch (Exception ignored) {
            // A widget that fails to refresh is not a reason to break the page.
        }
    }
}
