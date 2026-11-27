package com.dafanshu.rolestudio;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PersonalUpdateVault {
    private static final String ALIAS = "RoleStudio.PersonalUpdate.AesGcm.v1";
    private final SharedPreferences prefs;
    record Credentials(URI origin, String token) {}
    PersonalUpdateVault(Context context) { prefs = context.getSharedPreferences("private-update", Context.MODE_PRIVATE); }

    String endpoint() { return prefs.getString("origin", ""); }

    private static KeyStore store() throws Exception {
        var store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        return store;
    }

    void save(URI uri, String token) throws Exception {
        SecretKey key = (SecretKey) store().getKey(ALIAS, null);
        if (key == null) {
            var generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            key = generator.generateKey();
        }
        var origin = uri.toString();
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        byte[] data = cipher.doFinal(token.getBytes(StandardCharsets.US_ASCII));
        byte[] record = ByteBuffer.allocate(12 + data.length).put(cipher.getIV()).put(data).array();
        if (!prefs.edit().putString("origin", origin).putString("credential", Base64.encodeToString(record, Base64.NO_WRAP)).commit())
            throw new IllegalStateException();
    }

    Credentials load() throws Exception {
        String origin = endpoint();
        String stored = prefs.getString("credential", "");
        if (origin.isEmpty() || stored.isEmpty()) return null;
        SecretKey key = (SecretKey) store().getKey(ALIAS, null);
        if (key == null) throw new IllegalStateException();
        var cipher = Cipher.getInstance("AES/GCM/NoPadding");
        byte[] record = Base64.decode(stored, Base64.NO_WRAP);
        if (record.length != 92) throw new IllegalStateException();
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, record, 0, 12));
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        String token = new String(cipher.doFinal(record, 12, record.length - 12), StandardCharsets.US_ASCII);
        if (!PersonalUpdateClient.validToken(token)) throw new IllegalStateException();
        return new Credentials(PersonalUpdateClient.origin(origin), token);
    }

    void clear() throws Exception {
        store().deleteEntry(ALIAS);
        if (!prefs.edit().clear().commit()) throw new IllegalStateException();
    }
}
