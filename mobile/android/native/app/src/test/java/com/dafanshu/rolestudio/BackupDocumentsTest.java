package com.dafanshu.rolestudio;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Base64;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BackupDocumentsTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    @Test public void readIsBoundedByTokenAndChunksAndCleansUp() throws Exception {
        var bridge = new BackupDocuments(temp.getRoot());
        byte[] payload = new byte[BackupDocuments.CHUNK_BYTES + 9];
        Arrays.fill(payload, (byte) 27);
        var read = bridge.stage(new ByteArrayInputStream(payload));
        assertEquals(payload.length, read.size());
        var decoder = Base64.getDecoder();
        assertEquals(BackupDocuments.CHUNK_BYTES, decoder.decode(bridge.read(read.token(), 0)).length);
        assertArrayEquals(Arrays.copyOfRange(payload, BackupDocuments.CHUNK_BYTES, payload.length),
            decoder.decode(bridge.read(read.token(), BackupDocuments.CHUNK_BYTES)));
        assertThrows(IOException.class, () -> bridge.read("wrong", 0));
        assertThrows(IOException.class, () -> bridge.read(read.token(), 1));
        bridge.closeRead("wrong");
        bridge.read(read.token(), 0);
        bridge.closeRead(read.token());
        assertThrows(IOException.class, () -> bridge.read(read.token(), 0));
        assertEquals(0, temp.getRoot().list().length);
        assertThrows(IOException.class, () -> bridge.stage(new ByteArrayInputStream(new byte[0])));
        assertEquals(0, temp.getRoot().list().length);
    }

    @Test public void stagesExactExportAndNeverOpensDestinationUntilFinish() throws Exception {
        var bridge = new BackupDocuments(temp.getRoot());
        var destination = new RecordingDestination();
        byte[] first = new byte[BackupDocuments.CHUNK_BYTES], last = {1, 2, 3, 4};
        String token = bridge.create(first.length + last.length, destination);
        assertThrows(IOException.class, () -> bridge.create(2, new RecordingDestination()));
        assertThrows(IOException.class, () -> bridge.write("wrong", 0, encode(first)));
        assertThrows(IOException.class, () -> bridge.write(token, 1, encode(first)));
        assertThrows(IOException.class, () -> bridge.write(token, 0, encode(last)));
        bridge.write(token, 0, encode(first));
        bridge.write(token, first.length, encode(last));
        assertEquals(0, destination.opened);
        assertThrows(IOException.class, () -> bridge.finish("wrong"));
        bridge.finish(token);
        assertEquals(1, destination.opened);
        assertEquals(0, destination.discarded);
        byte[] exported = destination.bytes.toByteArray();
        assertEquals(first.length + last.length, exported.length);
        assertArrayEquals(last, Arrays.copyOfRange(exported, first.length, exported.length));
        assertEquals(0, temp.getRoot().list().length);
        assertThrows(IOException.class, () -> bridge.finish(token));
    }

    @Test public void brokenExportAndCancelDiscardOnlyTheirDestination() throws Exception {
        var bridge = new BackupDocuments(temp.getRoot());
        var destination = new RecordingDestination();
        assertFalse(BackupDocuments.validSize(0));
        assertFalse(BackupDocuments.validSize(BackupDocuments.MAX_BYTES + 1));
        assertTrue(BackupDocuments.validSize(BackupDocuments.MAX_BYTES));
        String incomplete = bridge.create(4, destination);
        assertThrows(IllegalArgumentException.class, () -> bridge.write(incomplete, 0, "1234567?"));
        assertThrows(IOException.class, () -> bridge.finish(incomplete));
        assertEquals(0, destination.opened);
        assertEquals(1, destination.discarded);
        var canceled = new RecordingDestination();
        String token = bridge.create(4, canceled);
        bridge.cancel("wrong");
        assertEquals(0, canceled.discarded);
        bridge.cancel(token);
        bridge.cancel(token);
        assertEquals(1, canceled.discarded);
        assertEquals(0, temp.getRoot().list().length);
    }

    @Test public void destinationFailureCleansStagedBytesAndAllowsRetry() throws Exception {
        var bridge = new BackupDocuments(temp.getRoot());
        var broken = new RecordingDestination() {
            @Override public OutputStream open() throws IOException { throw new IOException("Destination unavailable"); }
        };
        String token = bridge.create(3, broken);
        bridge.write(token, 0, encode(new byte[]{1, 2, 3}));
        assertThrows(IOException.class, () -> bridge.finish(token));
        assertEquals(1, broken.discarded);
        assertEquals(0, temp.getRoot().list().length);
        bridge.create(3, new RecordingDestination());
        bridge.close();
        assertEquals(0, temp.getRoot().list().length);
    }

    private static String encode(byte[] bytes) { return Base64.getEncoder().encodeToString(bytes); }

    private static class RecordingDestination implements BackupDocuments.Destination {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int opened, discarded;
        @Override public OutputStream open() throws IOException { opened++; return bytes; }
        @Override public void discard() { discarded++; }
    }
}
