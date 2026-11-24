package com.dafanshu.rolestudio;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.Base64;
import java.util.UUID;

/** Short-lived, bounded SAF bridge sessions. The WebView owns the backup schema. */
final class BackupDocuments {
    static final int MAX_BYTES = 50 * 1024 * 1024;
    static final int CHUNK_BYTES = 192 * 1024;
    private static final String PREFIX = "role-studio-backup-session-";

    interface Destination {
        OutputStream open() throws IOException;
        void discard();
    }

    record Read(String token, int size) {}
    private record ReadSession(Read descriptor, File file) {}
    private record WriteSession(String token, int size, File file, Destination destination) {}

    private final File cacheDir;
    private ReadSession reading;
    private WriteSession writing;
    private int written;

    BackupDocuments(File cacheDir) {
        this.cacheDir = cacheDir;
        long expiry = System.currentTimeMillis() - 24 * 60 * 60 * 1000L;
        File[] stale = cacheDir.listFiles((dir, name) -> name.startsWith(PREFIX) && name.endsWith(".tmp"));
        if (stale != null) for (File file : stale) if (file.lastModified() < expiry) file.delete();
    }

    static boolean validSize(Integer size) { return size != null && size > 0 && size <= MAX_BYTES; }

    synchronized Read stage(InputStream input) throws IOException {
        closeRead(null);
        if (input == null) throw new IOException("Missing backup input");
        File file = File.createTempFile(PREFIX, ".tmp", cacheDir);
        int size = 0;
        try (var output = new FileOutputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            for (int count; (count = input.read(buffer)) != -1;) {
                if (count <= 0 || count > MAX_BYTES - size) throw new IOException("Invalid backup stream length");
                output.write(buffer, 0, count);
                size += count;
            }
            if (!validSize(size)) throw new IOException("Empty backup");
        } catch (IOException | RuntimeException failure) {
            file.delete();
            throw failure;
        }
        Read result = new Read(UUID.randomUUID().toString(), size);
        reading = new ReadSession(result, file);
        return result;
    }

    synchronized String read(String token, Integer offset) throws IOException {
        if (reading == null || token == null || !token.equals(reading.descriptor.token)
            || offset == null || offset < 0 || offset >= reading.descriptor.size || offset % CHUNK_BYTES != 0) {
            throw new IOException("Invalid backup read range");
        }
        byte[] buffer = new byte[Math.min(CHUNK_BYTES, reading.descriptor.size - offset)];
        try (var input = new RandomAccessFile(reading.file, "r")) {
            input.seek(offset);
            input.readFully(buffer);
        }
        return Base64.getEncoder().encodeToString(buffer);
    }

    synchronized void closeRead(String token) {
        if (reading != null && (token == null || token.equals(reading.descriptor.token))) {
            reading.file.delete();
            reading = null;
        }
    }

    synchronized String create(int size, Destination destination) throws IOException {
        if (!validSize(size) || destination == null || writing != null) throw new IOException("Backup write session not available");
        File file = File.createTempFile(PREFIX, ".tmp", cacheDir);
        writing = new WriteSession(UUID.randomUUID().toString(), size, file, destination);
        written = 0;
        return writing.token;
    }

    private WriteSession writer(String token) throws IOException {
        if (writing == null || token == null || !token.equals(writing.token)) throw new IOException("Backup write session ended");
        return writing;
    }

    synchronized void write(String token, Integer offset, String encoded) throws IOException {
        WriteSession state = writer(token);
        int expected = Math.min(CHUNK_BYTES, state.size - written);
        if (offset == null || offset != written || expected <= 0
            || encoded == null || encoded.length() != ((expected + 2) / 3) * 4) {
            throw new IOException("Invalid backup chunk size or offset");
        }
        byte[] bytes = Base64.getDecoder().decode(encoded);
        if (bytes.length != expected) throw new IOException("Invalid decoded backup chunk size");
        try (var output = new FileOutputStream(state.file, true)) {
            output.write(bytes);
        }
        written += bytes.length;
    }

    synchronized void finish(String token) throws IOException {
        WriteSession state = writer(token);
        boolean committed = false;
        try {
            if (written != state.size || state.file.length() != state.size) throw new IOException("Incomplete backup");
            try (var input = new FileInputStream(state.file); var output = state.destination.open()) {
                if (output == null) throw new IOException("Missing backup output");
                byte[] buffer = new byte[32 * 1024];
                int copied = 0;
                for (int count; (count = input.read(buffer)) != -1;) {
                    if (count <= 0 || count > state.size - copied) throw new IOException("Invalid backup output length");
                    output.write(buffer, 0, count);
                    copied += count;
                }
                if (copied != state.size) throw new IOException("Incomplete backup output");
                output.flush();
            }
            committed = true;
        } finally {
            releaseWrite(!committed);
        }
    }

    synchronized void cancel(String token) {
        if (writing != null && (token == null || token.equals(writing.token))) releaseWrite(true);
    }

    private void releaseWrite(boolean discard) {
        WriteSession state = writing;
        writing = null;
        written = 0;
        state.file.delete();
        if (discard) {
            try { state.destination.discard(); }
            catch (RuntimeException ignored) { /* Some document providers cannot remove their new placeholder. */ }
        }
    }

    synchronized void close() {
        closeRead(null);
        cancel(null);
    }
}
