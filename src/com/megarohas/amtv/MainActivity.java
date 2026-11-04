package com.megarohas.amtv;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityManager;
import android.view.accessibility.AccessibilityNodeProvider;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * music.apple.com full screen in a WebView, driven by the remote through {@link Cursor},
 * with Guaranteed 1600px Desktop Width & Lyrics Button locked across phones, 1080p TVs, and 4K TVs.
 */
public class MainActivity extends Activity {
    static final String TAG = "amtv";
    private static final String HOME = "https://music.apple.com/";
    private static final int TARGET_DESKTOP_WIDTH_PX = 1600;
    private static final Pattern STOREFRONT = Pattern.compile("[a-z]{2}");
    private static final ViewGroup.LayoutParams FILL = new ViewGroup.LayoutParams(-1, -1);

    private FrameLayout pages;                                // the main page, popups/fullscreen on top
    private WebView web;
    private int lastAppliedScale = -1;                        // avoid resetting IME by calling setInitialScale redundantly
    private int lastViewportWidthPx = -1;
    private final ArrayList<WebView> popups = new ArrayList<>();
    private View customView;                                  // HTML5 Fullscreen custom view
    private WebChromeClient.CustomViewCallback customViewCallback;
    private Cursor cursor;
    private String pageJs;
    private String signinJs;                                  // remote-friendly look for Apple's sign-in popup
    private boolean pageReady;
    private View splash;                                      // until the Apple Music page renders
    private TextView splashStatus;
    private FrameLayout root;
    private final Runnable splashTimeout = this::hideSplash;
    private int splashGen;                                    // which showing of the splash a "ready" lifts
    private boolean started, dreaming;
    private volatile boolean screenReader;                    // TalkBack & co are on: they read the page itself
    private final AccessibilityManager.AccessibilityStateChangeListener a11yChanged = on -> checkScreenReader();
    private final AccessibilityManager.TouchExplorationStateChangeListener touchChanged = on -> checkScreenReader();

    // Leaving the app pauses the music; the TV's screensaver (a "dream") does not count as leaving.
    private final BroadcastReceiver dreams = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            dreaming = Intent.ACTION_DREAMING_STARTED.equals(i.getAction());
        }
    };
    private final Runnable pauseIfLeft = () -> {
        if (started || dreaming) return;
        Log.i(TAG, "left the app: pause");
        web.evaluateJavascript("try{MusicKit.getInstance().pause()}catch(e){}", null);
    };
    private String storefrontReload;                          // the storefront the site was reopened in
    private String pendingPlay;                               // `--es play ra.…`, kept until the page takes it

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(true);         // reachable only through adb
        CookieManager.getInstance().setAcceptCookie(true);
        AccessibilityManager am = (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
        am.addAccessibilityStateChangeListener(a11yChanged);
        am.addTouchExplorationStateChangeListener(touchChanged);
        checkScreenReader();

        pages = new FrameLayout(this);
        pages.setBackgroundColor(Color.BLACK);
        web = newPage(true);
        pages.addView(web, FILL);
        web.addJavascriptInterface(new Bridge(), "AmtvNative");

        root = new FrameLayout(this);
        root.addView(pages, FILL);
        setContentView(root);
        showSplash(str("status_starting"));

        cursor = new Cursor(this, this::activeTarget, () -> web.evaluateJavascript("window.__amtv&&__amtv.wake(2500)", null));
        cursor.setVisibility(View.INVISIBLE);                 // shown as soon as splash lifts
        pages.post(this::attachCursor);

        signinJs = raw("signin");
        pageJs = "window.__amtvVersion=" + js(versionName()) + ";\n" + raw("page");

        applyGuaranteed1600pxViewport(web, true);
        web.loadUrl(home());
        playFrom(getIntent());

        IntentFilter f = new IntentFilter(Intent.ACTION_DREAMING_STARTED);
        f.addAction(Intent.ACTION_DREAMING_STOPPED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(dreams, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(dreams, f);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (web != null) applyGuaranteed1600pxViewport(web, false);
    }

    /**
     * Guaranteed 1600px Desktop Width & Lyrics Button:
     * Locked via applyGuaranteed1600pxViewport on layout changes and page load
     * across phones, 1080p TVs, and 4K TVs.
     * Only calls v.setInitialScale when the computed scale actually changes so an open soft keyboard
     * (IME) is never dismissed by a redundant page-scale reset during SPA pushState or IME layout passes.
     */
    private void applyGuaranteed1600pxViewport(WebView v, boolean forceScale) {
        if (v == null) return;
        WebSettings s = v.getSettings();
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        int widthPx = v.getWidth();
        if (widthPx <= 0 && pages != null) widthPx = pages.getWidth();
        if (widthPx <= 0) {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            widthPx = Math.max(dm.widthPixels, dm.heightPixels);
        }
        if (widthPx > 0) {
            int scalePercent = Math.max(1, (int) Math.round((widthPx * 100.0) / TARGET_DESKTOP_WIDTH_PX));
            if (forceScale || scalePercent != lastAppliedScale) {
                lastAppliedScale = scalePercent;
                lastViewportWidthPx = widthPx;
                v.setInitialScale(scalePercent);
            }
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        started = true;
        pages.removeCallbacks(pauseIfLeft);
        checkScreenReader();
    }

    @Override
    protected void onStop() {
        super.onStop();
        started = false;
        pages.postDelayed(pauseIfLeft, 1200);
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        playFrom(i);
    }

    private void playFrom(Intent i) {
        String cmd = i == null ? null : i.getStringExtra("cmd");
        if (cmd != null && cmd.matches("next|prev|pause|play|toggle|favorite|unfavorite")) {
            Log.i(TAG, "cmd " + cmd);
            web.evaluateJavascript("window.__tv&&__tv.command('" + cmd + "')", null);
        }
        String id = i == null ? null : i.getStringExtra("play");
        if (id == null || !id.matches("[A-Za-z0-9._-]{1,100}")) return;
        Log.i(TAG, "play " + id);
        showSplash(str("status_play"));
        pendingPlay = id;
        flushPlay();
    }

    private void flushPlay() {
        if (pendingPlay == null || !pageReady) return;
        web.evaluateJavascript("window.__amtvPlay='" + pendingPlay + "';window.__tv&&__tv.flushPlay()", null);
    }

    /** A see-through panel window over the activity: redrawing it leaves the page's window alone. */
    private void attachCursor() {
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(-1, -1,
                WindowManager.LayoutParams.TYPE_APPLICATION_PANEL,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.token = pages.getWindowToken();
        lp.setTitle("amtv cursor");
        getWindowManager().addView(cursor, lp);
    }

    private final ArrayList<android.animation.Animator> splashAnims = new ArrayList<>();

    /**
     * Lightweight monochrome Apple Music loading screen matching the uploaded black-and-white logo:
     * a circular (round) white badge with a frosted outer halo ring, soft pearlescent glow, and
     * monochrome pulsing dots.
     */
    private View makeSplash() {
        float dp = getResources().getDisplayMetrics().density;
        FrameLayout f = new FrameLayout(this);
        f.setBackgroundColor(0xFF070709);

        android.graphics.drawable.GradientDrawable glowBg = new android.graphics.drawable.GradientDrawable();
        glowBg.setGradientType(android.graphics.drawable.GradientDrawable.RADIAL_GRADIENT);
        glowBg.setColors(new int[] { 0x33FFFFFF, 0x14E5E5EA, 0x00000000 });
        glowBg.setGradientRadius(240 * dp);
        View glow = new View(this);
        glow.setBackground(glowBg);
        f.addView(glow, new FrameLayout.LayoutParams((int) (480 * dp), (int) (480 * dp), Gravity.CENTER));

        android.widget.LinearLayout col = new android.widget.LinearLayout(this);
        col.setOrientation(android.widget.LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        f.addView(col, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        f.setClipChildren(false);
        col.setClipChildren(false);
        col.setClipToPadding(false);

        int outerSize = (int) (152 * dp);
        int innerSize = (int) (132 * dp);
        FrameLayout badgeWrap = new FrameLayout(this);
        badgeWrap.setClipChildren(false);

        android.graphics.drawable.GradientDrawable haloRingBg = new android.graphics.drawable.GradientDrawable();
        haloRingBg.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        haloRingBg.setColor(0x10FFFFFF);
        haloRingBg.setStroke((int) Math.max(1, 1.2f * dp), 0x38FFFFFF);
        View haloRing = new View(this);
        haloRing.setBackground(haloRingBg);
        badgeWrap.addView(haloRing, new FrameLayout.LayoutParams(outerSize, outerSize, Gravity.CENTER));

        android.graphics.drawable.GradientDrawable whiteDisc = new android.graphics.drawable.GradientDrawable();
        whiteDisc.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        whiteDisc.setColor(Color.WHITE);
        whiteDisc.setStroke((int) Math.max(1, 1.5f * dp), 0xFFE5E5EA);

        ImageView tile = new ImageView(this);
        tile.setBackground(whiteDisc);
        tile.setImageDrawable(getDrawable(res("ic_launcher_fg", "drawable")));
        tile.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int pad = (int) (10 * dp);
        tile.setPadding(pad, pad, pad, pad);
        tile.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View v, Outline o) {
                o.setOval(0, 0, v.getWidth(), v.getHeight());
            }
        });
        tile.setClipToOutline(true);
        badgeWrap.addView(tile, new FrameLayout.LayoutParams(innerSize, innerSize, Gravity.CENTER));
        col.addView(badgeWrap, new android.widget.LinearLayout.LayoutParams(outerSize, outerSize));

        TextView title = new TextView(this);
        title.setText(getApplicationInfo().loadLabel(getPackageManager()));
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setLetterSpacing(0.02f);
        title.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD));
        android.widget.LinearLayout.LayoutParams tp = new android.widget.LinearLayout.LayoutParams(-2, -2);
        tp.topMargin = (int) (22 * dp);
        col.addView(title, tp);

        android.widget.LinearLayout dots = new android.widget.LinearLayout(this);
        android.widget.LinearLayout.LayoutParams dp0 = new android.widget.LinearLayout.LayoutParams(-2, -2);
        dp0.topMargin = (int) (26 * dp);
        col.addView(dots, dp0);
        for (int i = 0; i < 3; i++) {
            android.graphics.drawable.GradientDrawable c = new android.graphics.drawable.GradientDrawable();
            c.setShape(android.graphics.drawable.GradientDrawable.OVAL);
            c.setColor(i == 1 ? 0xFFD1D1D6 : 0xFFFFFFFF);
            View d = new View(this);
            d.setBackground(c);
            d.setAlpha(0.22f);
            android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams((int) (8 * dp), (int) (8 * dp));
            lp.leftMargin = lp.rightMargin = (int) (6 * dp);
            dots.addView(d, lp);
            loop(android.animation.ObjectAnimator.ofFloat(d, View.ALPHA, 0.22f, 0.95f), 520, i * 170L);
        }

        splashStatus = new TextView(this);
        splashStatus.setTextColor(0xFF98989F);
        splashStatus.setTextSize(14);
        splashStatus.setGravity(Gravity.CENTER);
        splashStatus.setAlpha(0f);
        android.widget.LinearLayout.LayoutParams sp = new android.widget.LinearLayout.LayoutParams((int) (420 * dp), -2);
        sp.topMargin = (int) (16 * dp);
        col.addView(splashStatus, sp);

        col.setAlpha(0f);
        col.setScaleX(0.92f);
        col.setScaleY(0.92f);
        col.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(500)
                .setInterpolator(new android.view.animation.DecelerateInterpolator()).start();
        loop(android.animation.ObjectAnimator.ofPropertyValuesHolder(glow,
                android.animation.PropertyValuesHolder.ofFloat(View.ALPHA, 0.5f, 1f),
                android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 0.94f, 1.06f),
                android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.94f, 1.06f)), 1600, 0);
        loop(android.animation.ObjectAnimator.ofPropertyValuesHolder(haloRing,
                android.animation.PropertyValuesHolder.ofFloat(View.ALPHA, 0.45f, 0.95f),
                android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 0.96f, 1.06f),
                android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.96f, 1.06f)), 1600, 0);
        loop(android.animation.ObjectAnimator.ofPropertyValuesHolder(tile,
                android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.03f),
                android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.03f)), 1600, 0);
        return f;
    }

    private void loop(android.animation.ObjectAnimator a, long ms, long delay) {
        a.setDuration(ms);
        a.setStartDelay(delay);
        a.setRepeatCount(android.animation.ValueAnimator.INFINITE);
        a.setRepeatMode(android.animation.ValueAnimator.REVERSE);
        a.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator());
        a.start();
        splashAnims.add(a);
    }

    private int R_string(String name) {
        return res(name, "string");
    }

    private String str(String name, Object... args) {
        return localized().getString(R_string(name), args);
    }

    private android.content.res.Resources localized() {
        String l = getSharedPreferences("amtv", MODE_PRIVATE).getString("lang", "");
        if (l.isEmpty()) return getResources();
        Configuration c = new Configuration(getResources().getConfiguration());
        c.setLocale(new java.util.Locale(l));
        return createConfigurationContext(c).getResources();
    }

    private int res(String name, String type) {
        int id = getResources().getIdentifier(name, type, getPackageName());
        return id != 0 ? id : getResources().getIdentifier(name, type, MainActivity.class.getPackage().getName());
    }

    private void showSplash(String status) {
        splashGen++;
        pages.removeCallbacks(splashTimeout);
        pages.postDelayed(splashTimeout, 20000);
        if (splash != null) { setStatus(status); return; }
        splash = makeSplash();
        root.addView(splash, FILL);
        setStatus(status);
    }

    private final java.util.ArrayDeque<String> statusQueue = new java.util.ArrayDeque<>();
    private long statusSince;
    private boolean statusFading;
    private final Runnable statusPump = this::pumpStatus;

    private void setStatus(String text) {
        if (splashStatus == null || text == null) return;
        String last = statusQueue.isEmpty() ? splashStatus.getText().toString() : statusQueue.peekLast();
        if (text.equals(last)) return;
        while (statusQueue.size() >= 3) statusQueue.pollFirst();
        statusQueue.add(text);
        pumpStatus();
    }

    private void pumpStatus() {
        TextView t = splashStatus;
        if (t == null || statusFading || statusQueue.isEmpty()) return;
        long wait = statusSince + 1000 - android.os.SystemClock.uptimeMillis();
        if (t.getText().length() > 0 && wait > 0) {
            pages.removeCallbacks(statusPump);
            pages.postDelayed(statusPump, wait);
            return;
        }
        String next = statusQueue.poll();
        statusFading = true;
        t.animate().cancel();
        t.animate().alpha(0f).setDuration(t.getText().length() > 0 ? 180 : 0).withEndAction(() -> {
            t.setText(next);
            statusSince = android.os.SystemClock.uptimeMillis();
            t.animate().alpha(1f).setDuration(280).withEndAction(() -> { statusFading = false; pumpStatus(); });
        });
    }

    private void hideSplash() {
        if (splash == null) return;
        long wait = splashStatus != null && splashStatus.getText().length() > 0
                ? statusSince + 600 - android.os.SystemClock.uptimeMillis() : 0;
        if (statusFading) wait = Math.max(wait, 250);
        if (wait > 0) {
            statusQueue.clear();
            pages.removeCallbacks(splashTimeout);
            pages.postDelayed(this::hideSplash, wait);
            return;
        }
        View v = splash;
        splash = null;
        splashStatus = null;
        statusQueue.clear();
        statusFading = false;
        pages.removeCallbacks(statusPump);
        pages.removeCallbacks(splashTimeout);
        cursor.setVisibility(View.VISIBLE);
        cursor.show();
        v.animate().alpha(0).setDuration(300).withEndAction(() -> {
            for (android.animation.Animator a : splashAnims) a.cancel();
            splashAnims.clear();
            ((ViewGroup) v.getParent()).removeView(v);
        });
        Log.i(TAG, "splash off");
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    private String raw(String name) {
        int id = res(name, "raw");
        if (id == 0) return "";
        try (InputStream in = getResources().openRawResource(id)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private WebView top() {
        return popups.isEmpty() ? web : popups.get(popups.size() - 1);
    }

    private View activeTarget() {
        return customView != null ? customView : top();
    }

    private String home() {
        String sf = getSharedPreferences("amtv", MODE_PRIVATE).getString("storefront", "");
        return STOREFRONT.matcher(sf).matches() ? "https://music.apple.com/" + sf + "/home" : HOME;
    }

    private void checkScreenReader() {
        AccessibilityManager am = (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
        screenReader = am.isTouchExplorationEnabled() || !am.getEnabledAccessibilityServiceList(
                AccessibilityServiceInfo.FEEDBACK_SPOKEN | AccessibilityServiceInfo.FEEDBACK_BRAILLE).isEmpty();
    }

    private WebView newPage(boolean lock1600Viewport) {
        WebView v = new WebView(this) {
            @Override
            public AccessibilityNodeProvider getAccessibilityNodeProvider() {
                return screenReader ? super.getAccessibilityNodeProvider() : null;
            }
        };
        v.setFocusable(true);
        v.setFocusableInTouchMode(true);
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(desktop(s.getUserAgentString()));
        CookieManager.getInstance().setAcceptThirdPartyCookies(v, true);
        v.setBackgroundColor(Color.BLACK);
        v.setWebViewClient(client);
        v.setWebChromeClient(chrome);

        if (lock1600Viewport) {
            applyGuaranteed1600pxViewport(v, true);
            // Only re-evaluate scale if horizontal width actually changed (never on vertical IME inset changes)
            v.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
                int newW = right - left;
                int oldW = oldRight - oldLeft;
                if (newW > 0 && newW != oldW && newW != lastViewportWidthPx) {
                    applyGuaranteed1600pxViewport(v, false);
                }
            });
        }
        return v;
    }

    private static String desktop(String ua) {
        Matcher m = Pattern.compile("Chrome/(\\d+)").matcher(ua);
        String major = m.find() ? m.group(1) : "140";
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                + major + ".0.0.0 Safari/537.36";
    }

    private static boolean apple(Uri u) {
        String h = u == null ? null : u.getHost();
        return h != null && (h.equals("apple.com") || h.endsWith(".apple.com"));
    }

    private static boolean useless(Uri u) {
        String host = u.getHost(), path = u.getPath();
        if (host == null || path == null) return false;
        if (host.equals("mvod.itunes.apple.com") && path.startsWith("/itunes-assets/")) return true;
        return host.equals("xp.apple.com");
    }

    private WebResourceResponse empty() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(204, "No Content");
        return r;
    }

    private final WebViewClient client = new WebViewClient() {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (useless(u)) return empty();
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            if (r.isForMainFrame()) {
                Log.i(TAG, "navigate " + r.getUrl() + " redirect=" + r.isRedirect() + " gesture=" + r.hasGesture());
                if (!pageReady) setStatus(str("status_opening"));
            }
            String scheme = r.getUrl().getScheme();
            if ("https".equals(scheme) || "http".equals(scheme)) return false;
            Log.i(TAG, "not opening " + r.getUrl());
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, Bitmap favicon) {
            if (v == web && apple(Uri.parse(url))) {
                pageReady = false;
                applyGuaranteed1600pxViewport(v, false);
            }
        }

        @Override
        public void onPageCommitVisible(WebView v, String url) {
            if (v == web && apple(Uri.parse(url)) && !pageReady) {
                applyGuaranteed1600pxViewport(v, false);
                v.evaluateJavascript(pageJs, null);
            }
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (v != web) {
                if (signinPage(url) && !signinJs.isEmpty()) {
                    v.evaluateJavascript(signinJs, null);
                }
                cursor.setVisibility(View.VISIBLE);
                cursor.show();
                return;
            }
            if (!apple(Uri.parse(url))) return;
            Log.i(TAG, "page finished " + url);
            // Note: Apple Music's router (history.pushState, e.g. when clicking Search) also fires
            // onPageFinished. Run pageJs and scale setup only once per document load so we never
            // reset the IME / soft keyboard when navigating to /search.
            if (!pageReady) {
                setStatus(str("status_interface"));
                applyGuaranteed1600pxViewport(v, false);
                v.evaluateJavascript(pageJs, null);
                pageReady = true;
            }
            flushPlay();
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame()) return;
            Log.w(TAG, "load failed: " + e.getDescription() + " " + r.getUrl());
            hideSplash();
            String url = r.getUrl().toString();
            String html = "<html><body style='background:#000;color:#ddd;font:22px sans-serif;"
                    + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0'"
                    + " onclick=\"location.replace(" + TextUtils.htmlEncode(js(url)) + ")\">"
                    + "<p>" + TextUtils.htmlEncode(str("error_open", r.getUrl().getHost())) + "</p>"
                    + "<p style='color:#888;font-size:16px'>" + TextUtils.htmlEncode(String.valueOf(e.getDescription())) + "</p>"
                    + "<p>" + TextUtils.htmlEncode(str("error_retry")) + "</p></body></html>";
            v.loadDataWithBaseURL(null, html, "text/html", "utf-8", url);
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            Log.w(TAG, "renderer gone, crashed=" + d.didCrash());
            if (v == web) {
                pageReady = false;
                lastAppliedScale = -1;
                if (customView != null) {
                    pages.removeView(customView);
                    customView = null;
                    customViewCallback = null;
                }
                for (WebView p : popups) { pages.removeView(p); p.destroy(); }
                popups.clear();
                pages.removeView(web);
                web.destroy();
                web = newPage(true);
                web.addJavascriptInterface(new Bridge(), "AmtvNative");
                pages.addView(web, 0, FILL);
                web.loadUrl(home());
            } else {
                close(v);
            }
            return true;
        }
    };

    private final WebChromeClient chrome = new WebChromeClient() {
        @Override
        public void onPermissionRequest(PermissionRequest r) {
            for (String res : r.getResources()) {
                if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(res) && apple(r.getOrigin())) {
                    r.grant(new String[] { res });
                    return;
                }
            }
            Log.i(TAG, "denied " + TextUtils.join(",", r.getResources()) + " for " + r.getOrigin());
            r.deny();
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            customView.setBackgroundColor(Color.BLACK);
            pages.addView(customView, FILL);
            cursor.setVisibility(View.VISIBLE);
            cursor.show();
            Log.i(TAG, "entered fullscreen custom view");
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            pages.removeView(customView);
            customView = null;
            if (customViewCallback != null) {
                customViewCallback.onCustomViewHidden();
                customViewCallback = null;
            }
            cursor.setVisibility(View.VISIBLE);
            cursor.show();
            Log.i(TAG, "exited fullscreen custom view");
        }

        @Override
        public boolean onCreateWindow(WebView v, boolean dialog, boolean gesture, Message result) {
            WebView p = newPage(false);
            popups.add(p);
            pages.addView(p, FILL);
            ((WebView.WebViewTransport) result.obj).setWebView(p);
            result.sendToTarget();
            cursor.setVisibility(View.VISIBLE);
            cursor.show();
            Log.i(TAG, "popup opened");
            return true;
        }

        @Override
        public void onCloseWindow(WebView w) {
            close(w);
        }
    };

    private final class Bridge {
        @JavascriptInterface
        public void mode(String m) {
            runOnUiThread(() -> {
                cursor.setVisibility(View.VISIBLE);
                cursor.show();
            });
        }

        @JavascriptInterface
        public void keyboard() {
            runOnUiThread(() -> {
                View targetView = activeTarget();
                targetView.setFocusable(true);
                targetView.setFocusableInTouchMode(true);
                targetView.requestFocus();
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null) {
                    imm.showSoftInput(targetView, InputMethodManager.SHOW_IMPLICIT);
                }
            });
        }

        @JavascriptInterface
        public void ready() {
            runOnUiThread(() -> {
                if (!pageReady) return;
                int gen = splashGen;
                web.postVisualStateCallback(0, new WebView.VisualStateCallback() {
                    @Override
                    public void onComplete(long id) {
                        if (gen == splashGen) hideSplash();
                    }
                });
            });
        }

        @JavascriptInterface
        public void status(String text) {
            if (text == null) return;
            String t = text.length() > 80 ? text.substring(0, 80) + "…" : text;
            runOnUiThread(() -> setStatus(t));
        }

        @JavascriptInterface
        public void played() {
            runOnUiThread(() -> pendingPlay = null);
        }

        @JavascriptInterface
        public void playing(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                Log.i(TAG, on ? "keep screen on" : "screen may sleep");
            });
        }

        @JavascriptInterface
        public void lang(String l) {
            if (l != null && l.matches("|en|ru")) getSharedPreferences("amtv", MODE_PRIVATE).edit().putString("lang", l).apply();
        }

        @JavascriptInterface
        public void storefront(String account, String page) {
            if (account == null || !STOREFRONT.matcher(account).matches()) return;
            getSharedPreferences("amtv", MODE_PRIVATE).edit().putString("storefront", account).apply();
            if (account.equals(page)) return;
            runOnUiThread(() -> {
                if (account.equals(storefrontReload)) return;
                storefrontReload = account;
                Log.i(TAG, "storefront " + page + " -> " + account + ": reopening the site");
                showSplash(str("status_region"));
                pageReady = false;
                web.loadUrl(home());
            });
        }

        @JavascriptInterface
        public void reload() {
            runOnUiThread(() -> {
                showSplash(str("status_interface"));
                pageReady = false;
                web.reload();
            });
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(() -> moveTaskToBack(true));
        }
    }

    private static boolean signinPage(String url) {
        String h = url == null ? null : Uri.parse(url).getHost();
        return "idmsa.apple.com".equals(h) || "authorize.music.apple.com".equals(h);
    }

    private void close(WebView p) {
        if (!popups.remove(p)) return;
        pages.removeView(p);
        p.destroy();
        cursor.setVisibility(View.VISIBLE);
        cursor.show();
        Log.i(TAG, "popup closed");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (splash != null && k != KeyEvent.KEYCODE_BACK) return true;
        if (Cursor.handles(k)) return cursor.onKey(e);
        if (k == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP && !e.isCanceled()) back();
            return true;
        }
        String js = media(k);
        if (js != null) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                web.evaluateJavascript("(function(){try{var m=MusicKit.getInstance();" + js
                        + "}catch(e){console.log('amtv media: '+e)}})()", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private static String media(int k) {
        switch (k) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_HEADSETHOOK:
                return "m.isPlaying?m.pause():m.play()";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "m.play()";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: case KeyEvent.KEYCODE_MEDIA_STOP: return "m.pause()";
            case KeyEvent.KEYCODE_MEDIA_NEXT: return "m.skipToNextItem()";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: return "m.skipToPreviousItem()";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "m.seekToTime(m.currentPlaybackTime+15)";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "m.seekToTime(Math.max(0,m.currentPlaybackTime-15))";
        }
        return null;
    }

    private void back() {
        cursor.show();
        if (customView != null) {
            web.evaluateJavascript("if(document.fullscreenElement||document.webkitFullscreenElement){(document.exitFullscreen||document.webkitExitFullscreen).call(document)}", null);
            chrome.onHideCustomView();
            return;
        }
        if (!popups.isEmpty()) {
            WebView p = top();
            if (p.canGoBack()) p.goBack();
            else close(p);
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(dreams);
        AccessibilityManager am = (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
        am.removeAccessibilityStateChangeListener(a11yChanged);
        am.removeTouchExplorationStateChangeListener(touchChanged);
        if (cursor.isAttachedToWindow()) getWindowManager().removeViewImmediate(cursor);
        for (WebView p : popups) p.destroy();
        web.destroy();
        super.onDestroy();
    }

    private static String js(String s) {
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("<", "\\x3c") + "'";
    }
}