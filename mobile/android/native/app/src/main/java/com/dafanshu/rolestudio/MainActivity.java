package com.dafanshu.rolestudio;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.util.Collections;

public final class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(RoleStudioPlugin.class);
        registerPlugin(PersonalUpdateActivity.Entry.class);
        // Capacitor 8.6.2 registers app plugins after its built-ins. Remove direct
        // access to generic native HTTP and to changing the app's bundled web root.
        registerPlugin(DisabledHttp.class);
        registerPlugin(DisabledWebRoot.class);
        super.onCreate(state);
    }

    @CapacitorPlugin(name = "CapacitorHttp")
    public static final class DisabledHttp extends Plugin {}

    @CapacitorPlugin(name = "WebView")
    public static final class DisabledWebRoot extends Plugin {}

    private static boolean isBundledAsset(Uri uri) {
        String path = uri.getPath();
        return "https".equals(uri.getScheme()) && "localhost".equals(uri.getHost())
            && uri.getUserInfo() == null && uri.getPort() == -1 && path != null && !path.startsWith("/_capacitor_");
    }

    @Override protected void load() {
        super.load();
        WebView web = getBridge().getWebView();
        WebView.setWebContentsDebuggingEnabled(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setSupportMultipleWindows(false);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isBundledAsset(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isBundledAsset(uri) && "GET".equals(request.getMethod())) {
                    var local = super.shouldInterceptRequest(view, request);
                    if (local != null) return local;
                } else if (!request.isForMainFrame() && ("data".equals(uri.getScheme()) || "blob".equals(uri.getScheme()))) {
                    return null; // Local image previews, never a navigation destination.
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
    }
}
