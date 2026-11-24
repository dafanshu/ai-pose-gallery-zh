package com.dafanshu.rolestudio;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class GalleryZipStoreTest {
    @Rule public TemporaryFolder privateFiles = new TemporaryFolder();

    private static byte[] jpeg(int width, int size) {
        byte[] output = new byte[size];
        byte[] frame = {(byte) 255, (byte) 216, (byte) 255, (byte) 192, 0, 11, 8, 0, 1,
            (byte) (width >>> 8), (byte) width, 1, 1, 0x11, 0};
        System.arraycopy(frame, 0, output, 0, frame.length);
        output[size - 2] = (byte) 255;
        output[size - 1] = (byte) 217;
        return output;
    }

    private static void write(ZipOutputStream zip, String path, byte[] body, boolean stored) throws IOException {
        ZipEntry entry = new ZipEntry(path);
        if (stored) {
            entry.setMethod(ZipEntry.STORED);
            entry.setSize(body.length);
            CRC32 crc = new CRC32();
            crc.update(body);
            entry.setCrc(crc.getValue());
        }
        zip.putNextEntry(entry);
        zip.write(body);
        zip.closeEntry();
    }

    private static byte[] pack(String title, String thumbPath, int thumbWidth, boolean stored, byte[] image) throws IOException {
        var buffer = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(buffer)) {
            String meta = "{\"format\":\"role-studio-gallery-zip\",\"version\":1,\"items\":[{\"id\":1,\"slot\":\"portrait\",\"name\":\""
                + title + "\",\"tags\":[\"测试\"]}]}";
            write(zip, "manifest.json", meta.getBytes(StandardCharsets.UTF_8), stored);
            write(zip, thumbPath, jpeg(thumbWidth, 64), stored);
            write(zip, "images/1.jpg", image, stored);
        }
        return buffer.toByteArray();
    }

    @Test public void chunksReassembleExactImageAndReplacementInvalidatesPriorRevision() throws Exception {
        var store = new GalleryZipStore(privateFiles.getRoot());
        var image = jpeg(1280, GalleryZipStore.CHUNK + 17);
        var pack = pack("测试人像", "thumbs/1.jpg", 320, true, image);
        var first = store.install(new ByteArrayInputStream(pack), () -> false);
        var parts = store.page(first.revision(), 0);
        assertEquals("测试人像", parts.get(0).name());
        assertEquals("测试", parts.get(0).tags().get(0));
        var head = store.read(first.revision(), 1, "image", 0);
        assertArrayEquals(Arrays.copyOf(image, GalleryZipStore.CHUNK), head.data());
        var tail = store.read(first.revision(), 1, "image", head.nextOffset());
        assertArrayEquals(Arrays.copyOfRange(image, GalleryZipStore.CHUNK, image.length), tail.data());
        assertNull(tail.nextOffset());
        try {
            var second = store.install(new ByteArrayInputStream(pack), () -> false);
            assertNotEquals(first.revision(), second.revision());
            assertThrows(IOException.class, () -> store.read(first.revision(), 1, "image", 0));
        } finally { store.clear(); }
        assertNull(store.status());
    }

    @Test public void failedReplaceKeepsPriorArchiveAndCleansStage() throws Exception {
        var store = new GalleryZipStore(privateFiles.getRoot());
        var image = jpeg(100, 64);
        var valid = pack("人像", "thumbs/1.jpg", 100, true, image);
        var old = store.install(new ByteArrayInputStream(valid), () -> false);
        try {
            for (byte[] bad : new byte[][] {
                pack("人像", "../1.jpg", 100, true, image),
                pack("人像", "thumbs/1.jpg", 321, true, image),
                pack("人像", "thumbs/1.jpg", 100, false, image),
                pack(" " + "人像", "thumbs/1.jpg", 100, true, image),
                Arrays.copyOf(valid, valid.length - 1)
            }) {
                assertThrows(IOException.class, () -> store.install(new ByteArrayInputStream(bad), () -> false));
                assertEquals(old.revision(), store.status().revision());
                assertArrayEquals(image, store.read(old.revision(), 1, "image", 0).data());
                assertEquals(1, privateFiles.getRoot().list().length);
            }
            var broken = valid.clone();
            // STORED manifest immediately follows the first local file header and its ASCII filename.
            broken[30 + "manifest.json".length() + 10] ^= 1;
            assertThrows(IOException.class, () -> store.install(new ByteArrayInputStream(broken), () -> false));
            assertThrows(IOException.class, () -> store.install(new ByteArrayInputStream(valid), () -> true));
            assertEquals(old.revision(), store.status().revision());
        } finally { store.clear(); }
    }
}
