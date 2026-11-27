package com.dafanshu.rolestudio;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class PersonalUpdateClientTest {
    private static JSONObject manifest() throws Exception {
        return new JSONObject().put("schema", 1).put("applicationId", PersonalUpdateClient.PACKAGE_NAME)
            .put("versionCode", 1022).put("size", 3999999).put("sha256", "a".repeat(64));
    }

    @Test public void sourceMustBeHttpsOriginAndTokenIsScopedFormat() {
        assertEquals("https://updates.example.com", PersonalUpdateClient.origin("https://updates.example.com:443/").toString());
        for (String url : new String[]{"http://example.com", "https://x@example.com", "https://example.com?q=1",
            "https://example.com/v1", "https://example.com:444", "https://example.com/#x"}) {
            assertThrows(IllegalArgumentException.class, () -> PersonalUpdateClient.origin(url));
        }
        assertTrue(PersonalUpdateClient.validToken("a".repeat(64)));
        assertFalse(PersonalUpdateClient.validToken("a".repeat(64) + "\n"));
    }

    @Test public void manifestRejectsWrongPackageVersionSizeAndDigest() throws Exception {
        var release = PersonalUpdateClient.parse(manifest().toString());
        assertEquals(1022, release.version());
        assertEquals(3999999, release.size());
        for (Object[] pair : new Object[][] {
            {"schema", 2}, {"versionCode", "1022"}, {"versionCode", 0}, {"versionCode", 1022.5},
            {"versionCode", 2100000001}, {"applicationId", "com.example.other"}, {"sha256", "../../other"},
            {"size", 67108865}, {"size", 0}, {"size", 4.5},
        }) assertThrows(Exception.class, () -> PersonalUpdateClient.parse(manifest().put((String) pair[0], pair[1]).toString()));
    }

    @Test public void digestUsesPaddedLowercaseHex() {
        assertEquals("000f80ff", PersonalUpdateClient.hex(new byte[]{0,15,(byte)128,(byte)255}));
    }
}
