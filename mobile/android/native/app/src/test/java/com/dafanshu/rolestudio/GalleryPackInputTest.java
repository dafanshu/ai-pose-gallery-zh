package com.dafanshu.rolestudio;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import static org.junit.Assert.*;

public class GalleryPackInputTest {
    @Rule public TemporaryFolder cache = new TemporaryFolder();

    @Test public void transfersExactChunksAndCleansAfterClose() throws Exception {
        byte[] input = new byte[GalleryPackInput.CHUNK_BYTES + 16];
        for (int i = 0; i < input.length; i++) input[i] = (byte) i;
        var session = new GalleryPackInput(cache.getRoot());
        String token = session.stage(new ByteArrayInputStream(input));
        assertEquals(input.length, session.size(token));
        assertArrayEquals(Arrays.copyOf(input, GalleryPackInput.CHUNK_BYTES), session.chunk(token, 0));
        assertArrayEquals(Arrays.copyOfRange(input, GalleryPackInput.CHUNK_BYTES, input.length),
            session.chunk(token, GalleryPackInput.CHUNK_BYTES));
        assertThrows(IOException.class, () -> session.chunk(token, input.length));
        session.close("unrelated-token");
        assertEquals(input.length, session.size(token));
        session.close(token);
        assertThrows(IOException.class, () -> session.chunk(token, 0));
        assertEquals(0, cache.getRoot().list().length);
    }

    @Test public void emptyAndOversizedStreamsLeaveNoCacheFile() throws Exception {
        var session = new GalleryPackInput(cache.getRoot());
        assertThrows(IOException.class, () -> session.stage(new ByteArrayInputStream(new byte[0])));
        try (var input = new InputStream() {
            private int remaining = GalleryPackInput.MAX_BYTES + 1;
            @Override public int read(byte[] bytes, int offset, int count) {
                if (remaining == 0) return -1;
                int used = Math.min(count, remaining);
                remaining -= used;
                return used;
            }
            @Override public int read() {
                if (remaining == 0) return -1;
                remaining--;
                return 0;
            }
        }) {
            assertThrows(IOException.class, () -> session.stage(input));
        }
        assertEquals(0, cache.getRoot().list().length);
    }
}
