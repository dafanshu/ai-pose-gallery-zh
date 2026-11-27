package com.dafanshu.rolestudio;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class PersonalUpdateClient {
    static final String PACKAGE_NAME = "com.dafanshu.rolestudio";
    static final int MAX_VERSION = 2_100_000_000;
    static final int MAX_APK_BYTES = 64 * 1024 * 1024;
    private static final int MAX_MANIFEST_BYTES = 8192;
    record Release(int version, int size, String sha256) {}

    static URI origin(String source) {
        if (source.length() > 256) throw new IllegalArgumentException();
        URI uri = URI.create(source);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IllegalArgumentException();
        return URI.create("https://" + uri.getHost());
    }

    static boolean validToken(String token) { return token.matches("[a-f0-9]{64}"); }

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

    static String hex(byte[] value) {
        char[] chars = "0123456789abcdef".toCharArray();
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte b : value) result.append(chars[(b & 255) >>> 4]).append(chars[b & 15]);
        return result.toString();
    }

    static HttpsURLConnection open(URI base, String token, String path) throws IOException {
        var conn = (HttpsURLConnection) base.resolve(path).toURL().openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(12_000);
        conn.setReadTimeout(20_000);
        conn.setUseCaches(false);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        return conn;
    }

    private static int status(HttpsURLConnection conn) throws IOException {
        int code = conn.getResponseCode();
        if (code == 401 || code == 403) throw new IOException("更新口令无效或已撤销");
        if (code != 200 && code != 404) throw new IOException("更新服务暂不可用");
        return code;
    }

    static Release check(URI base, String token) throws Exception {
        var conn = open(base, token, "/v1/latest.json");
        try {
            if (status(conn) == 404) return null;
            try (var in = conn.getInputStream(); var out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (out.size() + n > MAX_MANIFEST_BYTES) throw new IOException("版本清单过大");
                    out.write(buf, 0, n);
                }
                return parse(new String(out.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { conn.disconnect(); }
    }

    static void download(URI base, String token, Release release, File file) throws Exception {
        var conn = open(base, token, "/v1/apk/" + release.version + "/" + release.sha256);
        long deadline = android.os.SystemClock.elapsedRealtime() + 180_000;
        var digest = MessageDigest.getInstance("SHA-256");
        try {
            if (status(conn) != 200) throw new IOException("更新包不存在，请重新检查");
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
