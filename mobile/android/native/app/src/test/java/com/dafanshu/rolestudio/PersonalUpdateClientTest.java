package com.dafanshu.rolestudio;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URI;
import org.junit.Test;

public class PersonalUpdateClientTest {
    private static JSONObject manifest() throws Exception {
        return new JSONObject().put("schema", 1).put("applicationId", PersonalUpdateClient.PACKAGE_NAME)
            .put("versionCode", 1022).put("size", 3999999).put("sha256", "a".repeat(64));
    }

    @Test public void githubRedirectsAreHttpsAndConstrainedToReleaseHosts() {
        assertTrue(PersonalUpdateClient.trusted(URI.create("https://github.com/dafanshu/ai-pose-gallery-zh/releases/download/tag/update.json"), true));
        assertTrue(PersonalUpdateClient.trusted(URI.create("https://release-assets.githubusercontent.com/a?sig=test"), true));
        assertTrue(PersonalUpdateClient.trusted(URI.create("https://api.github.com/repos/a/b/releases"), false));
        for (String url : new String[]{"http://github.com", "https://github.com.example.com", "https://u@github.com",
            "https://github.com:444", "https://github.com/#x", "https://api.github.com"}) {
            assertFalse(PersonalUpdateClient.trusted(URI.create(url), true));
        }
    }

    private static JSONObject release(String tag, boolean draft, boolean preview, String... fileNames) throws Exception {
        JSONArray assets = new JSONArray();
        for (String name : fileNames) assets.put(new JSONObject().put("name",name).put("state","uploaded"));
        return new JSONObject().put("tag_name", tag).put("draft", draft).put("prerelease", preview).put("assets", assets);
    }

    @Test public void selectsHighestCompleteAndroidVersionAndIgnoresHarnessDraftAndMissingAssets() throws Exception {
        JSONArray entries = new JSONArray()
            .put(release("harness-v0.1.1", false, true, "update.json"))
            .put(release("role-studio-android-v1027", true, true, "update.json", "role-studio-personal-1027.apk"))
            .put(release("role-studio-android-v1026", false, false, "update.json", "role-studio-personal-1026.apk"))
            .put(release("role-studio-android-v1025", false, true, "update.json", "role-studio-personal-1024.apk"))
            .put(release("role-studio-android-v1022", false, true, "update.json", "role-studio-personal-1022.apk"))
            .put(release("role-studio-android-v1020", false, true, "update.json", "role-studio-personal-1020.apk"));
        assertEquals(1022, PersonalUpdateClient.selectVersion(entries, 0));
        assertEquals(1050, PersonalUpdateClient.selectVersion(entries, 1050));
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
