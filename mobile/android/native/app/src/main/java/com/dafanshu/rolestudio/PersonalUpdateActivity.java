package com.dafanshu.rolestudio;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.concurrent.Executors;

public final class PersonalUpdateActivity extends Activity {
    @CapacitorPlugin(name = "PersonalUpdate")
    public static final class Entry extends Plugin {
        @PluginMethod public void open(PluginCall call) {
            getActivity().runOnUiThread(() -> {
                getActivity().startActivity(new Intent(getActivity(), PersonalUpdateActivity.class));
                call.resolve();
            });
        }
    }

    private static final int ALLOW_INSTALL = 41;
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private final java.util.concurrent.ExecutorService executor = Executors.newSingleThreadExecutor();
    private PersonalUpdateVault vault;
    private PersonalUpdateClient.Release release;
    private long currentVersion;
    private EditText endpoint, token;
    private TextView feedback;
    private Button check, download, save, clear;
    private boolean busy;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        vault = new PersonalUpdateVault(this);
        try { currentVersion = installed().getLongVersionCode(); }
        catch (PackageManager.NameNotFoundException missing) { finish(); return; }

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        content.setPadding(pad, pad, pad, pad);
        ViewCompat.setOnApplyWindowInsetsListener(scroll, (view, insets) -> {
            var bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        scroll.addView(content);
        setContentView(scroll);
        ViewCompat.requestApplyInsets(scroll);

        TextView title = new TextView(this);
        title.setText("应用更新");
        title.setTextSize(24);
        content.addView(title);
        TextView info = new TextView(this);
        info.setText("当前版本：" + currentVersion + "\n只在你选择检查或下载时连接私有更新服务。");
        content.addView(info);

        endpoint = input("私有更新地址（https://…）", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        endpoint.setText(vault.endpoint());
        token = input("更新口令（64 位小写十六进制，可粘贴）", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        content.addView(endpoint);
        content.addView(token);
        save = button(content, "保存更新源", this::save);
        clear = button(content, "清除更新源", () -> new AlertDialog.Builder(this)
            .setMessage("清除保存的地址和更新口令？").setNegativeButton("取消", null)
            .setPositiveButton("清除", (dialog, which) -> clear()).show());
        check = button(content, "检查更新", this::check);
        download = button(content, "下载并安装", this::download);
        feedback = new TextView(this);
        feedback.setAccessibilityLiveRegion(TextView.ACCESSIBILITY_LIVE_REGION_POLITE);
        content.addView(feedback);
        button(content, "返回", this::finish);
        render(vault.endpoint().isEmpty() ? "先填写你的私有更新地址和口令。" : "更新源已保存。");
    }

    private EditText input(String label, int type) {
        EditText field = new EditText(this);
        field.setInputType(type);
        field.setSingleLine();
        field.setHint(label);
        field.setSaveEnabled(false);
        field.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO);
        return field;
    }

    private Button button(LinearLayout content, String caption, Runnable action) {
        Button b = new Button(this);
        b.setText(caption);
        b.setOnClickListener(ignored -> action.run());
        content.addView(b);
        return b;
    }

    private void render(String message) {
        busy = false;
        feedback.setText(message);
        save.setEnabled(true); clear.setEnabled(!vault.endpoint().isEmpty()); check.setEnabled(!vault.endpoint().isEmpty());
        endpoint.setEnabled(true); token.setEnabled(true);
        download.setEnabled(release != null);
    }

    private void run(String progress, Runnable action) {
        if (busy) return;
        busy = true;
        save.setEnabled(false); clear.setEnabled(false); check.setEnabled(false); download.setEnabled(false);
        endpoint.setEnabled(false); token.setEnabled(false);
        feedback.setText(progress);
        executor.execute(action);
    }

    private void deliver(Runnable action) {
        runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) action.run(); });
    }

    private void save() {
        var baseText = endpoint.getText().toString().trim();
        var entered = token.getText().toString().trim();
        try {
            var base = PersonalUpdateClient.origin(baseText);
            if (!PersonalUpdateClient.validToken(entered)) { render("请输入 64 位小写十六进制更新口令。"); return; }
            token.setText("");
            release = null;
            run("正在保存…", () -> {
                try {
                    vault.save(base, entered);
                    deliver(() -> { endpoint.setText(base.toString()); render("已保存，可以检查更新。"); });
                } catch (Exception failure) { deliver(() -> render("无法安全保存更新源。")); }
            });
        } catch (IllegalArgumentException invalid) { render("请输入 HTTPS 域名，不包含路径或参数。"); }
    }

    private void clear() {
        release = null;
        run("正在清除…", () -> {
            try {
                vault.clear();
                deliver(() -> { endpoint.setText(""); token.setText(""); render("已清除更新源。"); });
            } catch (Exception failure) { deliver(() -> render("无法清除更新源，请重试。")); }
        });
    }

    private void check() {
        release = null;
        run("正在检查更新…", () -> {
            try {
                var auth = vault.load();
                if (auth == null) { deliver(() -> render("请先保存更新源。")); return; }
                var found = PersonalUpdateClient.check(auth.origin(), auth.token());
                deliver(() -> {
                    release = found != null && found.version() > currentVersion ? found : null;
                    render(found == null ? "更新源暂未发布安装包。" : release == null
                        ? "当前没有更高版本。" : "发现新版 " + found.version() + "，约 " +
                        String.format(java.util.Locale.ROOT, "%.1f MB", found.size() / 1_000_000.0));
                });
            } catch (Exception failure) { deliver(() -> render(error(failure, "无法检查更新，请确认网络和更新源。"))); }
        });
    }

    private void download() {
        if (release == null || busy) return;
        if (!getPackageManager().canRequestPackageInstalls()) {
            try {
                startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())), ALLOW_INSTALL);
            } catch (Exception failure) { render("请在系统设置中允许角色工作台安装未知应用后重试。"); }
            return;
        }
        var selected = release;
        var directory = new File(getCacheDir(), "private-update");
        var apk = new File(directory, "verified/role-studio-update.apk");
        run("正在下载并校验签名…", () -> {
            File part = null;
            try {
                var auth = vault.load();
                if (auth == null || !(apk.getParentFile().isDirectory() || apk.getParentFile().mkdirs())) throw new IOException("无法保存更新包");
                part = File.createTempFile("download-", ".apk", directory);
                PersonalUpdateClient.download(auth.origin(), auth.token(), selected, part);
                verify(part, selected.version());
                if (Thread.currentThread().isInterrupted()) return;
                java.nio.file.Files.move(part.toPath(), apk.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                deliver(() -> install(apk));
            } catch (Exception failure) { deliver(() -> render(error(failure, "更新失败，请重新检查后再试。"))); }
            finally { if (part != null) part.delete(); }
        });
    }

    private PackageInfo installed() throws PackageManager.NameNotFoundException {
        return getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
    }

    private void verify(File apk, int version) throws Exception {
        var manager = getPackageManager();
        var candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        var current = installed();
        if (candidate == null || !getPackageName().equals(candidate.packageName)
            || candidate.getLongVersionCode() != version || version <= current.getLongVersionCode()
            || candidate.signingInfo == null || current.signingInfo == null) throw new IOException("更新包的包名或版本不正确");
        var expected = current.signingInfo.getApkContentsSigners();
        var actual = candidate.signingInfo.getApkContentsSigners();
        if (expected == null || actual == null || expected.length != 1 || actual.length != 1
            || !MessageDigest.isEqual(expected[0].toByteArray(), actual[0].toByteArray())) {
            throw new IOException("更新包签名与当前安装不一致");
        }
    }

    private void install(File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".private-update", apk);
            Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME)
                .setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            var target = getPackageManager().resolveActivity(install, PackageManager.MATCH_SYSTEM_ONLY | PackageManager.MATCH_DEFAULT_ONLY);
            if (target == null || target.activityInfo == null) throw new IllegalStateException();
            install.setClassName(target.activityInfo.packageName, target.activityInfo.name);
            startActivity(install);
            render("更新包已校验，请在安卓系统安装页面确认。");
        } catch (Exception failure) { render("无法打开系统安装界面，请检查安装权限。"); }
    }

    private static String error(Exception failure, String fallback) {
        // Never surface network exception internals, URLs, server bodies or credentials.
        String message = failure.getMessage();
        return failure instanceof IOException && message != null && message.matches("[\\p{IsHan}，。]+") ? message : fallback;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == ALLOW_INSTALL && !busy)
            render(getPackageManager().canRequestPackageInstalls() ? "已授权，请再点一次下载并安装。" : "未授权安装，未下载更新。");
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
