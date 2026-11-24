package com.dafanshu.rolestudio;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** A validated private archive; never extracts entries into a filesystem tree. */
final class GalleryZipStore {
    static final long MAX_ARCHIVE = 2L * 1024 * 1024 * 1024;
    static final int MAX_ITEMS = 10000, MAX_MANIFEST = 4 * 1024 * 1024;
    static final int MAX_THUMB = 128 * 1024, MAX_IMAGE = 5 * 1024 * 1024;
    static final int PAGE = 100, CHUNK = 192 * 1024;
    private static final long SPACE_RESERVE = 32L * 1024 * 1024;
    private static final String MANIFEST = "manifest.json";
    private static final Object INSTALL_LOCK = new Object();
    private final File destination;

    record Item(int id, String slot, String name, List<String> tags) {}
    record Index(String revision, List<Item> items, Map<Integer, Item> byId) {}
    record Part(byte[] data, Integer nextOffset) {}
    private static Index current;
    private static File currentPath;
    private static ZipFile reader;

    GalleryZipStore(File files) {
        destination = new File(files, "role-studio-indexed-gallery.zip");
        File[] stale = files.listFiles((dir, name) -> name.startsWith("role-studio-gallery-stage-") && name.endsWith(".tmp"));
        if (stale != null) for (File file : stale) if (file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
    }

    Index status() throws IOException {
        synchronized (INSTALL_LOCK) { return open(); }
    }

    private Index open() throws IOException {
        if (!destination.isFile()) return null;
        if (current == null || !destination.equals(currentPath)) {
            closeReader();
            preflight(destination);
            reader = new ZipFile(destination);
            try {
                current = inspect(reader, false, () -> false);
                currentPath = destination;
            } catch (IOException | RuntimeException failure) { closeReader(); throw failure; }
        }
        return current;
    }

    interface Stopped { boolean get(); }
    private static void checkStopped(Stopped stopped) throws IOException {
        if (stopped.get()) throw new IOException("Gallery import interrupted");
    }

    Index install(InputStream input, Stopped stopped) throws IOException {
        if (input == null) throw new IOException("Missing gallery stream");
        File staged = File.createTempFile("role-studio-gallery-stage-", ".tmp", destination.getParentFile());
        try {
            try (var output = new FileOutputStream(staged)) {
                byte[] buffer = new byte[64 * 1024];
                long size = 0, nextSpaceCheck = 0;
                for (int n; (n = input.read(buffer)) != -1;) {
                    checkStopped(stopped);
                    if (n <= 0 || n > MAX_ARCHIVE - size) throw new IOException("Gallery ZIP size");
                    size += n;
                    output.write(buffer, 0, n);
                }
                output.getFD().sync();
            }
            preflight(staged);
            Index index;
            try (var zip = new ZipFile(staged)) {
                index = inspect(zip, true, stopped);
            }
            ZipFile replacement = new ZipFile(staged);
            boolean installed = false;
            try {
                synchronized (INSTALL_LOCK) {
                    checkStopped(stopped);
                    // On Android both descriptors remain valid across an atomic same-directory rename.
                    if (!staged.renameTo(destination)) throw new IOException("Gallery install rename failed");
                    closeReader();
                    reader = replacement;
                    current = index;
                    currentPath = destination;
                    installed = true;
                    return index;
                }
            } finally {
                if (!installed) replacement.close();
            }
        } finally {
            staged.delete();
        }
    }

    void clear() throws IOException {
        synchronized (INSTALL_LOCK) {
            if (destination.exists() && !destination.delete()) throw new IOException("Gallery remove failed");
            if (destination.equals(currentPath)) { closeReader(); current = null; currentPath = null; }
        }
    }

    private Index at(String revision) throws IOException {
        Index index = open();
        if (index == null || revision == null || !revision.equals(index.revision)) throw new IOException("Gallery changed");
        return index;
    }

    List<Item> page(String revision, Integer offset) throws IOException {
        synchronized (INSTALL_LOCK) {
            Index index = at(revision);
            if (offset == null || offset < 0 || offset >= index.items.size()) throw new IOException("Invalid page");
            return index.items.subList(offset, Math.min(index.items.size(), offset + PAGE));
        }
    }

    Part read(String revision, Integer id, String kind, Integer offset) throws IOException {
        synchronized (INSTALL_LOCK) {
            Index index = at(revision);
            if (id == null || !index.byId.containsKey(id) || !("thumb".equals(kind) || "image".equals(kind)) ||
                offset == null || offset < 0 || offset % CHUNK != 0) throw new IOException("Invalid gallery image");
            {
                ZipEntry entry = reader.getEntry(path(id, "thumb".equals(kind)));
                if (entry == null || offset >= entry.getSize()) throw new IOException("Invalid gallery image offset");
                try (var image = reader.getInputStream(entry)) {
                    for (int skipped = 0; skipped < offset;) {
                        long n = image.skip(offset - skipped);
                        if (n > 0) skipped += (int) n;
                        else if (image.read() != -1) skipped++;
                        else throw new IOException("Short gallery image");
                    }
                    int end = (int) Math.min(entry.getSize(), offset + CHUNK);
                    byte[] b = new byte[end - offset];
                    for (int read = 0; read < b.length;) {
                        int n = image.read(b, read, b.length - read);
                        if (n <= 0) throw new IOException("Short gallery image");
                        read += n;
                    }
                    return new Part(b, end < entry.getSize() ? end : null);
                }
            }
        }
    }

    private static void closeReader() {
        if (reader != null) try { reader.close(); } catch (IOException ignored) {}
        reader = null;
    }

    // Official exporter writes ordinary, single-volume ZIP with an uncommented EOCD.
    // Bound central-directory allocation before the platform ZIP reader parses it.
    static void preflight(File file) throws IOException {
        long size = file.length();
        if (size < 22 || size > MAX_ARCHIVE) throw new IOException("Invalid gallery ZIP length");
        try (var in = new RandomAccessFile(file, "r")) {
            in.seek(size - 22);
            if (in.readInt() != 0x504b0506 || in.readInt() != 0)
                throw new IOException("Unsupported gallery ZIP layout");
            int diskEntries = Short.toUnsignedInt(Short.reverseBytes(in.readShort()));
            int totalEntries = Short.toUnsignedInt(Short.reverseBytes(in.readShort()));
            long centralSize = Integer.toUnsignedLong(Integer.reverseBytes(in.readInt()));
            long centralOffset = Integer.toUnsignedLong(Integer.reverseBytes(in.readInt()));
            if (diskEntries != totalEntries || totalEntries < 3 || totalEntries > 1 + 2 * MAX_ITEMS ||
                centralSize < 46L * totalEntries || centralSize > 4L * 1024 * 1024 ||
                centralOffset + centralSize != size - 22 || in.readUnsignedShort() != 0)
                throw new IOException("Invalid gallery ZIP directory");
        }
    }

    private static String path(int id, boolean thumb) { return (thumb ? "thumbs/" : "images/") + id + ".jpg"; }

    static Index inspect(ZipFile zip, boolean validateContent, Stopped stopped) throws IOException {
        if (zip.size() > 1 + 2 * MAX_ITEMS) throw new IOException("Too many gallery files");
        ZipEntry manifest = zip.getEntry(MANIFEST);
        bounded(manifest, MAX_MANIFEST);
        try (var stream = zip.getInputStream(manifest); var output = new java.io.ByteArrayOutputStream()) {
            transfer(stream, manifest, output, false, stopped, new byte[32 * 1024]);
            JSONObject root = new JSONObject(StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(output.toByteArray())).toString());
            if (!"role-studio-gallery-zip".equals(root.getString("format")) || exactInt(root.get("version")) != 1)
                throw new IOException("Incompatible gallery format");
            JSONArray entries = root.getJSONArray("items");
            if (entries.length() < 1 || entries.length() > MAX_ITEMS || zip.size() != 1 + 2 * entries.length())
                throw new IOException("Wrong gallery entry count");
            List<Item> items = new ArrayList<>();
            Map<Integer, Item> byId = new HashMap<>();
            Set<String> remaining = new HashSet<>();
            remaining.add(MANIFEST);
            for (int i = 0; i < entries.length(); i++) {
                JSONObject obj = entries.getJSONObject(i);
                int id = exactInt(obj.get("id"));
                String slot = strictString(obj.get("slot")), name = metadataText(obj.get("name"), 120);
                if (id < 1 || id > entries.length() || !validSlot(slot))
                    throw new IOException("Invalid gallery item");
                JSONArray sourceTags = obj.getJSONArray("tags");
                if (sourceTags.length() > 12) throw new IOException("Too many gallery tags");
                List<String> tags = new ArrayList<>();
                for (int t = 0; t < sourceTags.length(); t++) {
                    tags.add(metadataText(sourceTags.get(t), 60));
                }
                Item item = new Item(id, slot, name, java.util.Collections.unmodifiableList(tags));
                if (byId.put(id, item) != null) throw new IOException("Duplicate gallery ID");
                remaining.add(path(id, true)); remaining.add(path(id, false));
                items.add(item);
            }
            byte[] buffer = new byte[64 * 1024];
            long logicalBytes = manifest.getSize();
            for (var e = zip.entries(); e.hasMoreElements();) {
                checkStopped(stopped);
                ZipEntry entry = e.nextElement();
                String name = entry.getName();
                if (!remaining.remove(name)) throw new IOException("Unexpected or duplicate gallery path");
                if (name.equals(MANIFEST)) continue;
                bounded(entry, name.startsWith("thumbs/") ? MAX_THUMB : MAX_IMAGE);
                logicalBytes += entry.getSize();
                if (logicalBytes > MAX_ARCHIVE) throw new IOException("Gallery total size");
                if (validateContent) {
                    try (var image = zip.getInputStream(entry)) {
                        transfer(image, entry, null, true, stopped, buffer);
                    }
                    try (var image = new DataInputStream(new BufferedInputStream(zip.getInputStream(entry), 8192))) {
                        jpegBounds(image, name.startsWith("thumbs/") ? 320 : 1280);
                    }
                }
            }
            if (!remaining.isEmpty()) throw new IOException("Missing gallery files");
            return new Index(UUID.randomUUID().toString(), java.util.Collections.unmodifiableList(items), java.util.Collections.unmodifiableMap(byId));
        } catch (org.json.JSONException malformed) {
            throw new IOException("Invalid gallery manifest", malformed);
        }
    }

    private static String strictString(Object value) throws IOException {
        if (!(value instanceof String)) throw new IOException("Invalid gallery text");
        return (String) value;
    }

    private static String metadataText(Object value, int max) throws IOException {
        String text = strictString(value);
        if (text.isEmpty() || text.length() > max || edgeWhitespace(text.codePointAt(0)) ||
            edgeWhitespace(text.codePointBefore(text.length()))) throw new IOException("Invalid gallery metadata length or whitespace");
        for (int i = 0; i < text.length();) {
            int cp = text.codePointAt(i), type = Character.getType(cp);
            if (type == Character.CONTROL || type == Character.FORMAT || type == Character.SURROGATE)
                throw new IOException("Invalid gallery metadata control");
            i += Character.charCount(cp);
        }
        return text;
    }

    private static boolean edgeWhitespace(int cp) {
        return Character.isWhitespace(cp) || Character.isSpaceChar(cp) || cp == 0xfeff;
    }

    private static boolean validSlot(String slot) {
        return "portrait".equals(slot) || "costume".equals(slot) || "pose".equals(slot);
    }

    static void jpegBounds(DataInputStream image, int maxSide) throws IOException {
        if (image.readUnsignedShort() != 0xffd8) throw new IOException("Invalid JPEG");
        for (int markerCount = 0; markerCount < 512; markerCount++) {
            if (image.readUnsignedByte() != 255) throw new IOException("Invalid JPEG marker");
            int marker = image.readUnsignedByte();
            for (int fill = 0; marker == 255 && fill < 16; fill++) marker = image.readUnsignedByte();
            if (marker < 0xc0 || marker == 255 || marker == 0xd8 || marker == 0xd9 || marker == 0xda ||
                (marker >= 0xd0 && marker <= 0xd7)) throw new IOException("Missing JPEG frame");
            int length = image.readUnsignedShort();
            if (length < 2) throw new IOException("Invalid JPEG marker length");
            if (marker == 0xc0 || marker == 0xc1 || marker == 0xc2) {
                if (length < 8 || image.readUnsignedByte() != 8) throw new IOException("Unsupported JPEG frame");
                int height = image.readUnsignedShort(), width = image.readUnsignedShort();
                if (width < 1 || height < 1 || width > maxSide || height > maxSide)
                    throw new IOException("JPEG dimensions exceed the gallery limit");
                return;
            }
            if (marker <= 0xcf && marker != 0xc4) throw new IOException("Unsupported JPEG frame");
            int remaining = length - 2;
            while (remaining > 0) {
                int skipped = image.skipBytes(remaining);
                if (skipped == 0) { image.readUnsignedByte(); skipped = 1; }
                remaining -= skipped;
            }
        }
        throw new IOException("Too many JPEG headers");
    }

    private static int exactInt(Object value) throws IOException {
        if (!(value instanceof Integer)) throw new IOException("Invalid gallery integer");
        return (Integer) value;
    }

    private static void bounded(ZipEntry e, int max) throws IOException {
        if (e == null || e.isDirectory() || e.getMethod() != ZipEntry.STORED || e.getSize() <= 0 ||
            e.getSize() > max || e.getCompressedSize() != e.getSize() || e.getCrc() < 0)
            throw new IOException("Invalid or unbounded gallery entry");
    }

    private static void transfer(InputStream input, ZipEntry e, java.io.OutputStream output, boolean jpeg, Stopped stopped, byte[] buffer) throws IOException {
        CRC32 crc = new CRC32();
        long size = 0;
        int previous = -1, last = -1;
        for (int n; (n = input.read(buffer)) != -1;) {
            checkStopped(stopped);
            if (n <= 0 || n > e.getSize() - size) throw new IOException("Gallery entry length mismatch");
            if (size == 0 && jpeg && (n < 3 || (buffer[0] & 255) != 255 || (buffer[1] & 255) != 216 || (buffer[2] & 255) != 255))
                throw new IOException("Invalid gallery JPEG header");
            if (n >= 2) previous = buffer[n - 2] & 255;
            else previous = last;
            last = buffer[n - 1] & 255;
            size += n;
            crc.update(buffer, 0, n);
            if (output != null) output.write(buffer, 0, n);
        }
        if (size != e.getSize() || crc.getValue() != e.getCrc() || (jpeg && (previous != 255 || last != 217)))
            throw new IOException("Gallery entry integrity check failed");
    }
}
