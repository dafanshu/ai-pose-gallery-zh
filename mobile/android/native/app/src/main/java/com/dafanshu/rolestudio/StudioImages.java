package com.dafanshu.rolestudio;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;

final class StudioImages {
    static final int MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
    static final int MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
    private static final int PICK_SIDE = 1024;
    private static final byte[] PNG = {(byte)137, 80, 78, 71, 13, 10, 26, 10};
    static final class Encoded {
        final byte[] bytes;
        final String mime;
        Encoded(byte[] bytes, String mime) { this.bytes = bytes; this.mime = mime; }
    }
    static final class Picked {
        final String dataUrl;
        final String name;
        Picked(String dataUrl, String name) { this.dataUrl = dataUrl; this.name = name; }
    }

    static Picked fromPicker(ContentResolver resolver, Uri uri) throws IOException {
        if (!"content".equals(uri.getScheme())) throw new IOException("Unsupported document");
        var bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri), (decoder, info, source) -> {
            int width = info.getSize().getWidth(), height = info.getSize().getHeight();
            if ((long) width * height > 120_000_000L) throw new IllegalArgumentException("Image too large");
            float scale = Math.min(1f, (float) PICK_SIDE / Math.max(width, height));
            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
            decoder.setTargetSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        });
        byte[] bytes;
        try (var output = new ByteArrayOutputStream()) {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IOException("PNG encoding failed");
            bytes = output.toByteArray();
        } finally { bitmap.recycle(); }
        if (bytes.length > MAX_REFERENCE_BYTES) throw new IOException("Encoded reference too large");
        String name = "参考图.png";
        try (var cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) name = pngName(cursor.getString(0).replaceFirst("\\.[^.]+$", ""));
        } catch (RuntimeException ignored) { /* An optional name should not lose a valid image. */ }
        return new Picked(pngDataUrl(bytes), name);
    }

    static String pngDataUrl(byte[] bytes) {
        return "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    static Encoded reference(String dataUrl) {
        if (dataUrl == null) throw new IllegalArgumentException("Missing reference");
        String mime = dataUrl.startsWith("data:image/png;base64,") ? "image/png"
            : dataUrl.startsWith("data:image/jpeg;base64,") ? "image/jpeg" : null;
        if (mime == null) throw new IllegalArgumentException("Unsupported reference format");
        byte[] bytes = decode(dataUrl.substring(dataUrl.indexOf(',') + 1), MAX_REFERENCE_BYTES);
        validateImage(bytes, mime, 4096);
        return new Encoded(bytes, mime);
    }

    static byte[] outputPng(String base64) {
        byte[] bytes = decode(base64, MAX_OUTPUT_BYTES);
        validateImage(bytes, "image/png", 4096);
        return bytes;
    }

    private static byte[] decode(String value, int maxBytes) {
        if (value == null || value.length() == 0 || value.length() > ((maxBytes + 2) / 3) * 4 || value.length() % 4 != 0) {
            throw new IllegalArgumentException("Invalid image encoding or size");
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/') continue;
            if (c == '=' && (i == value.length() - 1 || i == value.length() - 2 && value.charAt(i + 1) == '=')) continue;
            throw new IllegalArgumentException("Invalid base64");
        }
        byte[] bytes = Base64.decode(value, Base64.NO_WRAP);
        if (bytes.length == 0 || bytes.length > maxBytes) throw new IllegalArgumentException("Image exceeds size limit");
        return bytes;
    }

    private static void validateImage(byte[] bytes, String mime, int maxSide) {
        var opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        if (!mime.equals(opts.outMimeType) || opts.outWidth <= 0 || opts.outHeight <= 0 || opts.outWidth > maxSide || opts.outHeight > maxSide) {
            throw new IllegalArgumentException("Invalid image dimensions or type");
        }
        if ("image/png".equals(mime) && (bytes.length < PNG.length || !Arrays.equals(PNG, Arrays.copyOf(bytes, PNG.length)))) {
            throw new IllegalArgumentException("Invalid PNG");
        }
    }

    private static String pngName(String name) {
        String hint = name == null ? "" : name.replaceFirst("(?i)\\.png$", "").replaceAll("[^\\p{L}\\p{N}._ -]", "_")
            .replaceFirst("^[. ]+", "").trim();
        if (hint.codePointCount(0, hint.length()) > 80) hint = hint.substring(0, hint.offsetByCodePoints(0, 80));
        return (hint.isEmpty() ? "role-studio-" + System.currentTimeMillis() : hint) + ".png";
    }

    static void save(ContentResolver resolver, String dataUrl, String name) throws IOException {
        String prefix = "data:image/png;base64,";
        if (dataUrl == null || !dataUrl.startsWith(prefix)) throw new IllegalArgumentException("Only PNG results can be saved");
        byte[] bytes = outputPng(dataUrl.substring(prefix.length()));
        Uri target = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), imageValues(name));
        if (target == null) throw new IOException("Album unavailable");
        try {
            try (var output = resolver.openOutputStream(target, "w")) {
                if (output == null) throw new IOException("Album not writable");
                output.write(bytes);
            }
            var finished = new ContentValues();
            finished.put(MediaStore.Images.Media.IS_PENDING, 0);
            if (resolver.update(target, finished, null, null) != 1) throw new IOException("Album publication failed");
        } catch (Exception failure) {
            try { resolver.delete(target, null, null); } catch (Exception ignored) { /* OS cleans up pending items. */ }
            throw failure;
        }
    }

    private static ContentValues imageValues(String name) {
        var values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, pngName(name));
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/RoleStudio");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        return values;
    }
}
