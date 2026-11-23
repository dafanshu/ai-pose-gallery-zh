package com.dafanshu.rolestudio;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-only ciphertext; no export, preferences, recovery copy or plaintext fallback. */
final class StudioKeyVault {
    private static final Object LOCK = new Object();
    private static final String ALIAS = "RoleStudio.OpenAI.AesGcm.v1";
    private static final int IV_LEN = 12;
    private static final int MAX_KEY_LEN = 1024;
    private final AtomicFile file;

    StudioKeyVault(Context context) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "openai-key.v1"));
    }

    static boolean validKey(String key) {
        return key != null && key.length() >= 8 && key.length() <= MAX_KEY_LEN && key.matches("[!-~]+");
    }

    private static KeyStore store() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    boolean configured() throws Exception {
        synchronized (LOCK) {
            if (!store().containsAlias(ALIAS)) return false;
            try (var input = file.openRead()) { return input.read() == 1; }
            catch (FileNotFoundException absent) { return false; }
        }
    }

    void save(String value) throws Exception {
        synchronized (LOCK) {
            var store = store();
            SecretKey key = (SecretKey) store.getKey(ALIAS, null);
            if (key == null) {
                var generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
                key = generator.generateKey();
            }
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            var iv = cipher.getIV();
            if (iv.length != IV_LEN) throw new IllegalStateException("Unexpected IV length");
            byte[] plain = value.getBytes(StandardCharsets.US_ASCII);
            byte[] encrypted;
            try { encrypted = cipher.doFinal(plain); }
            finally { Arrays.fill(plain, (byte) 0); }
            FileOutputStream output = file.startWrite();
            try {
                output.write(1);
                output.write(iv);
                output.write(encrypted);
                file.finishWrite(output);
            } catch (Exception failure) {
                file.failWrite(output);
                throw failure;
            }
        }
    }

    String resolve() throws Exception {
        synchronized (LOCK) {
            SecretKey key = (SecretKey) store().getKey(ALIAS, null);
            if (key == null) return null;
            byte[] record;
            try (var input = file.openRead()) {
                byte[] buffer = new byte[1 + IV_LEN + MAX_KEY_LEN + 16 + 1];
                int length = 0, read;
                while (length < buffer.length && (read = input.read(buffer, length, buffer.length - length)) > 0) length += read;
                record = Arrays.copyOf(buffer, length);
            } catch (FileNotFoundException absent) { return null; }
            if (record.length < 1 + IV_LEN + 16 || record.length > 1 + IV_LEN + MAX_KEY_LEN + 16 || record[0] != 1) {
                throw new IllegalStateException("Invalid credential record");
            }
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, record, 1, IV_LEN));
            byte[] plain = cipher.doFinal(record, 1 + IV_LEN, record.length - 1 - IV_LEN);
            try {
                var value = new String(plain, StandardCharsets.US_ASCII);
                if (!validKey(value)) throw new IllegalStateException("Invalid credential");
                return value;
            } finally { Arrays.fill(plain, (byte) 0); }
        }
    }

    void clear() throws Exception {
        synchronized (LOCK) {
            // Erase the decryption key even if a local ciphertext copy survived.
            store().deleteEntry(ALIAS);
            file.delete();
        }
    }
}
