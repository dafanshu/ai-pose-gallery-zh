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
    private final String alias;
    private final CloudImageProviders provider;
    private static final int IV_LEN = 12;
    private static final int MAX_KEY_LEN = 1024;
    private static final int MAX_RECORD_LEN = MAX_KEY_LEN + 64;
    private final AtomicFile file;

    static final class Credential {
        final String key, workspaceId;
        Credential(String key, String workspaceId) { this.key = key; this.workspaceId = workspaceId; }
    }

    StudioKeyVault(Context context, CloudImageProviders provider) {
        this.provider = provider;
        // Preserve the original OpenAI alias and record name for in-place upgrades.
        alias = "RoleStudio." + provider.vaultName + ".AesGcm.v1";
        String name = provider == CloudImageProviders.GPT ? "openai" : provider.id;
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), name + "-key.v1"));
    }

    static boolean validKey(String key) {
        return key != null && key.length() >= 8 && key.length() <= MAX_KEY_LEN && key.matches("[!-~]+");
    }

    private static KeyStore store() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    void save(String value, String workspaceId) throws Exception {
        if (!validKey(value) || (provider == CloudImageProviders.QWEN && !CloudImageProviders.validWorkspace(workspaceId)))
            throw new IllegalArgumentException("Invalid local credential");
        String payload = provider == CloudImageProviders.QWEN ? workspaceId + "|" + value : value;
        synchronized (LOCK) {
            var store = store();
            SecretKey key = (SecretKey) store.getKey(alias, null);
            if (key == null) {
                var generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
                key = generator.generateKey();
            }
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            var iv = cipher.getIV();
            if (iv.length != IV_LEN) throw new IllegalStateException("Unexpected IV length");
            byte[] plain = payload.getBytes(StandardCharsets.US_ASCII);
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

    Credential resolve() throws Exception {
        synchronized (LOCK) {
            SecretKey key = (SecretKey) store().getKey(alias, null);
            if (key == null) return null;
            byte[] record;
            try (var input = file.openRead()) {
                byte[] buffer = new byte[1 + IV_LEN + MAX_RECORD_LEN + 16 + 1];
                int length = 0, read;
                while (length < buffer.length && (read = input.read(buffer, length, buffer.length - length)) > 0) length += read;
                record = Arrays.copyOf(buffer, length);
            } catch (FileNotFoundException absent) { return null; }
            if (record.length < 1 + IV_LEN + 16 || record.length > 1 + IV_LEN + MAX_RECORD_LEN + 16 || record[0] != 1) {
                throw new IllegalStateException("Invalid credential record");
            }
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, record, 1, IV_LEN));
            byte[] plain = cipher.doFinal(record, 1 + IV_LEN, record.length - 1 - IV_LEN);
            try {
                var value = new String(plain, StandardCharsets.US_ASCII);
                String workspaceId = null;
                if (provider == CloudImageProviders.QWEN) {
                    int separator = value.indexOf('|');
                    if (separator < 1) throw new IllegalStateException("Invalid workspace metadata");
                    workspaceId = value.substring(0, separator);
                    if (!CloudImageProviders.validWorkspace(workspaceId)) throw new IllegalStateException("Invalid workspace metadata");
                    value = value.substring(separator + 1);
                }
                if (!validKey(value)) throw new IllegalStateException("Invalid credential");
                return new Credential(value, workspaceId);
            } finally { Arrays.fill(plain, (byte) 0); }
        }
    }

    void clear() throws Exception {
        synchronized (LOCK) {
            // Erase the decryption key even if a local ciphertext copy survived.
            store().deleteEntry(alias);
            file.delete();
        }
    }
}
