package com.dafanshu.rolestudio;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

final class PersonalUpdateClient {
    static final String PACKAGE_NAME = "com.dafanshu.rolestudio";
    private static final String REPO = "dafanshu/ai-pose-gallery-zh";
    private static final String API = "https://api.github.com/repos/" + REPO + "/releases?per_page=30&page=";
    private static final String ASSETS = "https://github.com/" + REPO + "/releases/download/";
    private static final String TAG_PREFIX = "role-studio-android-v";
    private static final Pattern TAG = Pattern.compile(TAG_PREFIX + "([1-9][0-9]{0,9})");
    private static final Set<String> DOWNLOAD_HOSTS = Set.of("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com");
    static final int MAX_VERSION = 2_100_000_000;
    static final int MAX_APK_BYTES = 64 * 1024 * 1024;
    record Release(int version, int size, String sha256) {}

    static Release parse(String body) throws Exception {
        JSONObject json = new JSONObject(body);
        if (!Integer.valueOf(1).equals(json.get("schema"))
                || !PACKAGE_NAME.equals(json.get("applicationId"))
                || !(json.get("versionCode") instanceof Integer version) || version < 1 || version > MAX_VERSION
                || !(json.get("size") instanceof Integer size) || size < 1 || size > MAX_APK_BYTES
                || !(json.get("sha256") instanceof String sha) || !sha.matches("[a-f0-9]{64}")) {
            throw new IOException("版本清单无效");
        }
        return new Release(version, size, sha);
    }

    static int selectVersion(JSONArray entries, int best) {
        for (int i = 0; i < entries.length(); ++i) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry == null || !Boolean.FALSE.equals(entry.opt("draft")) || !Boolean.TRUE.equals(entry.opt("prerelease"))) continue;
            var match = TAG.matcher(entry.optString("tag_name"));
            if (!match.matches()) continue;
            long number = Long.parseLong(match.group(1));
            if (number <= best || number > MAX_VERSION) continue;
            JSONArray assets = entry.optJSONArray("assets");
            if (assets == null) continue;
            boolean manifest = false, apk = false;
            for (int j = 0; j < assets.length(); ++j) {
                JSONObject asset = assets.optJSONObject(j);
                if (asset == null || !"uploaded".equals(asset.optString("state"))) continue;
                String name = asset.optString("name");
                manifest |= "update.json".equals(name);
                apk |= apkName((int) number).equals(name);
            }
            if (manifest && apk) best = (int) number;
        }
        return best;
    }

    private static String apkName(int version) { return "role-studio-personal-" + version + ".apk"; }
    private static URI asset(int version, String file) { return URI.create(ASSETS + TAG_PREFIX + version + "/" + file); }

    static boolean trusted(URI uri, boolean download) {
        String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null || uri.getUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getRawFragment() != null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return download ? DOWNLOAD_HOSTS.contains(host) : "api.github.com".equals(host);
    }

    static String hex(byte[] value) {
        char[] chars = "0123456789abcdef".toCharArray();
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte b : value) result.append(chars[(b & 255) >>> 4]).append(chars[b & 15]);
        return result.toString();
    }

    private static HttpsURLConnection open(URI uri, boolean download) throws IOException {
        for (int redirect = 0; redirect <= 4; ++redirect) {
            if (!trusted(uri, download)) throw new IOException("已拦截不受信任的更新地址");
            var conn = (HttpsURLConnection) uri.toURL().openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(12_000);
            conn.setReadTimeout(20_000);
            conn.setUseCaches(false);
            conn.setRequestProperty("User-Agent", "RoleStudio-Android-Updater");
            if (!download) conn.setRequestProperty("Accept", "application/vnd.github+json");
            try {
                int code = conn.getResponseCode();
                if (code == 200) return conn;
                if (download && (code == 301 || code == 302 || code == 303 || code == 307 || code == 308)) {
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.length() > 8192) throw new IOException("更新下载地址无效");
                    uri = uri.resolve(location);
                    conn.disconnect();
                    continue;
                }
                if (code == 403 || code == 429) throw new IOException("更新服务请求受限，请稍后重试");
                if (code == 404) throw new IOException("更新文件暂不可用");
                throw new IOException("更新服务暂不可用");
            } catch (IOException | RuntimeException failure) {
                conn.disconnect();
                throw failure;
            }
        }
        throw new IOException("更新下载跳转次数过多");
    }

    private static String read(URI uri, boolean download, int max) throws IOException {
        var conn = open(uri, download);
        try (var in = conn.getInputStream(); var out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                if (out.size() + n > max) throw new IOException("版本清单过大");
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally { conn.disconnect(); }
    }

    static Release check(long currentVersion) throws Exception {
        int version = 0;
        // Do not use /releases/latest: Harness has its own releases in this same repository.
        for (int page = 1; page <= 3; ++page) {
            var releases = new JSONArray(read(URI.create(API + page), false, 2 * 1024 * 1024));
            version = selectVersion(releases, version);
            if (releases.length() < 30) break;
        }
        if (version == 0) return null;
        if (version <= currentVersion) return new Release(version, 0, "");
        var release = parse(read(asset(version, "update.json"), true, 8192));
        if (release.version != version) throw new IOException("版本清单与发布标签不一致");
        return release;
    }

    static void download(Release release, File file) throws Exception {
        var conn = open(asset(release.version, apkName(release.version)), true);
        long deadline = android.os.SystemClock.elapsedRealtime() + 180_000;
        var digest = MessageDigest.getInstance("SHA-256");
        try {
            if (conn.getContentLengthLong() >= 0 && conn.getContentLengthLong() != release.size)
                throw new IOException("更新包大小不正确");
            try (var in = conn.getInputStream(); var out = new FileOutputStream(file)) {
                byte[] buf = new byte[32768];
                int n, total = 0;
                while ((n = in.read(buf)) != -1) {
                    if (Thread.currentThread().isInterrupted() || android.os.SystemClock.elapsedRealtime() > deadline)
                        throw new IOException("下载已中断或超时");
                    total += n;
                    if (total > release.size) throw new IOException("更新包大小不正确");
                    digest.update(buf, 0, n);
                    out.write(buf, 0, n);
                }
                if (total != release.size || !hex(digest.digest()).equals(release.sha256))
                    throw new IOException("更新包完整性校验失败");
            }
        } finally { conn.disconnect(); }
    }
}
