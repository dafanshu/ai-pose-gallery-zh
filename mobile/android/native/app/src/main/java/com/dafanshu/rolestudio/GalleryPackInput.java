package com.dafanshu.rolestudio;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.UUID;

/** Holds only the explicitly selected document, briefly staged in private app cache. */
final class GalleryPackInput {
    static final int MAX_BYTES = 40 * 1024 * 1024;
    static final int CHUNK_BYTES = 192 * 1024;
    private static final String PREFIX = "role-studio-gallery-import-";
    private final File cacheDir;
    private File file;
    private String token;
    private int size;

    GalleryPackInput(File cacheDir) {
        this.cacheDir = cacheDir;
        long expired = System.currentTimeMillis() - 24 * 60 * 60 * 1000L;
        File[] stale = cacheDir.listFiles((dir, name) -> name.startsWith(PREFIX) && name.endsWith(".tmp"));
        if (stale != null) for (File entry : stale) if (entry.lastModified() < expired) entry.delete();
    }

    synchronized String stage(InputStream input) throws IOException {
        close();
        if (input == null) throw new IOException("Missing document");
        int length = 0;
        file = File.createTempFile(PREFIX, ".tmp", cacheDir);
        try (var output = new FileOutputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            for (int count; (count = input.read(buffer)) != -1;) {
                if (count > MAX_BYTES - length) throw new IOException("Gallery exceeds limit");
                if (count == 0) throw new IOException("Invalid document stream");
                output.write(buffer, 0, count);
                length += count;
            }
            if (length == 0) throw new IOException("Empty gallery");
        } catch (IOException | RuntimeException failure) {
            close();
            throw failure;
        }
        size = length;
        token = UUID.randomUUID().toString();
        return token;
    }

    synchronized int size(String requested) throws IOException {
        if (token == null || !token.equals(requested)) throw new IOException("Import session ended");
        return size;
    }

    synchronized byte[] chunk(String requested, int offset) throws IOException {
        int length = size(requested);
        if (offset < 0 || offset >= length) throw new IOException("Invalid gallery chunk offset");
        byte[] bytes = new byte[Math.min(CHUNK_BYTES, length - offset)];
        try (var input = new RandomAccessFile(file, "r")) {
            input.seek(offset);
            input.readFully(bytes);
        }
        return bytes;
    }

    synchronized void close(String requested) {
        if (token != null && token.equals(requested)) close();
    }

    synchronized void close() {
        token = null;
        size = 0;
        if (file != null) file.delete();
        file = null;
    }
}
