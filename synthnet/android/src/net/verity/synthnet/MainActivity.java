package net.verity.synthnet;

import android.app.Activity;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Synthnet, as an app.
 *
 * The whole synthetic internet ships inside the APK under assets/. This
 * activity is the browser around it: a WebView that answers its own requests
 * out of those assets and never touches a network.
 *
 * "Never touches a network" is not a promise in a comment -- the manifest
 * declares no INTERNET permission at all, so Android refuses any socket this
 * process tries to open. If something in here ever did reach for the network,
 * it would fail rather than quietly succeed. That is the strongest form the
 * offline guarantee can take.
 *
 * Assets are served from a virtual https origin rather than file:// on
 * purpose. Under file:// the browser treats every file as a separate opaque
 * origin, which breaks fetch() of the site's own JSON, breaks localStorage,
 * and would force the awkward workarounds (setAllowFileAccessFromFileURLs)
 * that exist mainly as a security footgun. A single https origin makes the
 * page behave exactly as it does under tools/serve.py, so the app and the
 * served site are the same code path rather than two that drift.
 *
 * Deliberately framework-only: no androidx, no Gradle dependency resolution.
 * That keeps the build to aapt2 + javac + d8 + apksigner, which is why it can
 * be built and verified in CI in about a minute with nothing to download.
 */
public class MainActivity extends Activity {

    /**
     * The host the WebView believes it is talking to. This exact name is the
     * one Android reserves for app-served assets, so it can never collide with
     * a real site, and it is treated as a secure origin.
     */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/index.html";

    private static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html");
        MIME.put("css", "text/css");
        MIME.put("js", "text/javascript");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("ico", "image/x-icon");
        MIME.put("txt", "text/plain");
        MIME.put("md", "text/markdown");
    }

    private WebView web;

    /** Pending result of an <input type="file"> the page opened. */
    private ValueCallback<Uri[]> pendingFiles;
    private static final int PICK_FILE = 4011;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // The site keeps per-viewer preferences (which tab, which zoom) in
        // localStorage, and reads are already wrapped in try/catch, but there
        // is no reason to make them fail here.
        s.setDomStorageEnabled(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        // Nothing is fetched over http(s) for real, but leaving these on would
        // let a stray absolute URL in future content silently try.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebViewClient(new AssetClient(getAssets()));

        /* Without a WebChromeClient an <input type="file"> in a WebView does
         * nothing at all -- no picker, no error, no console message. The page
         * looks broken and there is nothing to debug. This is what makes
         * "import a content pack" work inside the app.
         *
         * ACTION_OPEN_DOCUMENT hands back a single readable URI through the
         * Storage Access Framework. It needs no permission: the user picking
         * the file IS the grant. The app still declares none, and CI still
         * checks that. */
        web.setWebChromeClient(new FilePicker(this));

        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(START_URL);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (pendingFiles == null) return;

        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[] { data.getData() };
        }
        // Passing null on cancel is required, not optional: it is what releases
        // the page's file input. Skip it and the next pick silently fails.
        pendingFiles.onReceiveValue(result);
        pendingFiles = null;
    }

    /** Keeps the current page and history across a rotation. */
    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /**
     * The hardware/gesture back button walks the synthetic internet's own
     * history first, and only leaves the app once there is nothing to go back
     * to. Without this, back closes the app from the first link you follow.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /**
     * Opens a file picker when the page uses an <input type="file">.
     *
     * A named class rather than an anonymous one on purpose: d8 fails to
     * dex an anonymous WebChromeClient here, because the override signature
     * references the nested type WebChromeClient.FileChooserParams and the
     * inner-class metadata javac emits for the anonymous case is not enough
     * for it to resolve. The failure is a bare NullPointerException inside
     * the dexer with no reference to this file, so it is worth not
     * rediscovering.
     */
    private static final class FilePicker extends WebChromeClient {
        private final MainActivity host;

        FilePicker(MainActivity host) { this.host = host; }

        @Override
        public boolean onShowFileChooser(WebView view,
                                         ValueCallback<Uri[]> callback,
                                         WebChromeClient.FileChooserParams params) {
            if (host.pendingFiles != null) {
                // A picker was already open. Cancel the old callback or the
                // page waits forever on a promise that never settles.
                host.pendingFiles.onReceiveValue(null);
            }
            host.pendingFiles = callback;

            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            try {
                host.startActivityForResult(intent, PICK_FILE);
            } catch (Exception noPicker) {
                host.pendingFiles = null;
                callback.onReceiveValue(null);
                return false;
            }
            return true;
        }
    }

    private static final class AssetClient extends WebViewClient {
        private final AssetManager assets;

        AssetClient(AssetManager assets) {
            this.assets = assets;
        }

        /**
         * Refuse to navigate anywhere but our own assets. Everything inside the
         * site routes through its own synth:// scheme in JavaScript and never
         * reaches this method; anything that does get here is either a bug or
         * an absolute URL that should not exist in an offline project.
         */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !ASSET_HOST.equals(request.getUrl().getHost());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (!"GET".equalsIgnoreCase(request.getMethod())) return null;
            return serve(request.getUrl());
        }

        private WebResourceResponse serve(Uri uri) {
            if (!ASSET_HOST.equals(uri.getHost())) {
                // Not ours. Returning a 404 rather than null stops the WebView
                // attempting a real network fetch that the missing INTERNET
                // permission would fail anyway, with a less obvious error.
                return notFound();
            }

            String path = uri.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            // Strip the leading slash; asset paths are relative.
            String assetPath = path.startsWith("/") ? path.substring(1) : path;

            // Refuse to walk out of the asset tree.
            if (assetPath.contains("..")) return notFound();

            try {
                InputStream in = assets.open(assetPath);
                WebResourceResponse res = new WebResourceResponse(mimeFor(assetPath), "utf-8", in);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    res.setStatusCodeAndReasonPhrase(200, "OK");
                }
                return res;
            } catch (IOException missing) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            WebResourceResponse res = new WebResourceResponse(
                    "text/plain", "utf-8",
                    new ByteArrayInputStream(new byte[0]));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                res.setStatusCodeAndReasonPhrase(404, "Not Found");
            }
            return res;
        }

        private String mimeFor(String path) {
            int dot = path.lastIndexOf('.');
            if (dot < 0) return "application/octet-stream";
            String ext = path.substring(dot + 1).toLowerCase();
            String mime = MIME.get(ext);
            return mime != null ? mime : "application/octet-stream";
        }
    }
}
