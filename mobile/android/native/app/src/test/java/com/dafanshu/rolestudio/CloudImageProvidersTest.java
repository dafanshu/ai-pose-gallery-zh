package com.dafanshu.rolestudio;

import java.util.Collections;
import okhttp3.Request;
import okio.Buffer;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class CloudImageProvidersTest {
    private static final String KEY = "synthetic-test-key";
    private static final StudioImages.Encoded IMAGE = new StudioImages.Encoded(new byte[]{42}, "image/jpeg");

    private static JSONObject payload(Request request) throws Exception {
        assertEquals("POST", request.method());
        assertTrue(request.body().isOneShot());
        Buffer stream = new Buffer();
        request.body().writeTo(stream);
        String json = stream.readUtf8();
        assertFalse(json.contains(KEY));
        return new JSONObject(json);
    }

    @Test public void geminiUsesHeaderNotQueryAndPreservesReferenceMime() throws Exception {
        var provider = CloudImageProviders.GEMINI;
        Request request = provider.buildRequest(KEY, null, provider.models.get(0), "prompt", Collections.singletonList(IMAGE));
        assertEquals("generativelanguage.googleapis.com", request.url().host());
        assertEquals("/v1beta/interactions", request.url().encodedPath());
        assertNull(request.url().query());
        assertEquals(KEY, request.header("x-goog-api-key"));
        assertNull(request.header("Authorization"));
        assertEquals("2026-05-20", request.header("Api-Revision"));
        var body = payload(request);
        assertEquals("gemini-3.1-flash-image", body.getString("model"));
        assertFalse(body.getBoolean("store"));
        var parts = body.getJSONArray("input");
        assertEquals("image/jpeg", parts.getJSONObject(0).getString("mime_type"));
        assertEquals("prompt", parts.getJSONObject(1).getString("text"));
        assertEquals("Kg==", provider.extractImage(new JSONObject("{\"steps\":[{\"type\":\"thought\",\"content\":[{\"type\":\"image\",\"data\":\"AA==\"}]},{\"type\":\"model_output\",\"content\":[{\"type\":\"text\",\"text\":\"done\"},{\"type\":\"image\",\"data\":\"Kg==\"}]}]}")));
        assertFalse(provider.validForm(provider.models.get(0), "prompt", "", "", 4));
    }

    @Test public void qwenUsesOnlyTheConfiguredChinaWorkspaceAndInlineResponses() throws Exception {
        var provider = CloudImageProviders.QWEN;
        var images = Collections.singletonList(IMAGE);
        var model = provider.models.get(0);
        Request request = provider.buildRequest(KEY, "ws-workspace", model, "prompt", images);
        assertEquals("ws-workspace.cn-beijing.maas.aliyuncs.com", request.url().host());
        assertEquals("/api/v1/services/aigc/multimodal-generation/generation", request.url().encodedPath());
        assertEquals("Bearer " + KEY, request.header("Authorization"));
        var body = payload(request);
        var params = body.getJSONObject("parameters");
        assertEquals(1, params.getInt("n"));
        assertEquals("b64_json", params.getString("response_format"));
        assertEquals("data:image/jpeg;base64,Kg==", body.getJSONObject("input").getJSONArray("messages")
            .getJSONObject(0).getJSONArray("content").getJSONObject(0).getString("image"));
        for (String workspace : new String[]{"https://untrusted.invalid", "example.com", "x@y", "a/b", "a:123", "a%2e", "a\nB"}) {
            assertThrows(IllegalArgumentException.class, () -> provider.buildRequest(KEY, workspace, model, "prompt", images));
        }
        assertEquals("Kg==", provider.extractImage(new JSONObject("{\"output\":{\"choices\":[{\"message\":{\"content\":[{\"image\":\"data:image/png;base64,Kg==\"}]}}]}}")));
        assertThrows(OpenAiImageEdits.Failure.class, () -> provider.extractImage(new JSONObject("{\"output\":{\"choices\":[{\"message\":{\"content\":[{\"image\":\"https://untrusted.invalid/output.png\"}]}}]}}")));
    }

    @Test public void seedream55OmitsUnsupportedGroupOptionAndNeverFollowsUrlResults() throws Exception {
        var provider = CloudImageProviders.DOUBAO;
        var images = Collections.singletonList(IMAGE);
        Request request = provider.buildRequest(KEY, null, provider.models.get(0), "prompt", images);
        assertEquals("https://ark.cn-beijing.volces.com/api/v3/images/generations", request.url().toString());
        var body = payload(request);
        assertEquals("b64_json", body.getString("response_format"));
        assertEquals("png", body.getString("output_format"));
        assertEquals("2K", body.getString("size"));
        assertFalse(body.getBoolean("stream"));
        assertTrue(body.getBoolean("watermark"));
        assertFalse(body.has("sequential_image_generation"));
        assertEquals("data:image/jpeg;base64,Kg==", body.getString("image"));
        body = payload(provider.buildRequest(KEY, null, provider.models.get(1), "prompt", Collections.nCopies(2, IMAGE)));
        assertFalse(body.has("output_format"));
        assertEquals("disabled", body.getString("sequential_image_generation"));
        assertEquals(2, body.getJSONArray("image").length());
        assertEquals("Kg==", provider.extractImage(new JSONObject("{\"data\":[{\"b64_json\":\"Kg==\"}]}")));
        assertThrows(OpenAiImageEdits.Failure.class, () -> provider.extractImage(new JSONObject("{\"data\":[{},{}]}")));
        assertThrows(IllegalArgumentException.class, () -> CloudImageProviders.parse("comfyui"));
    }
}
