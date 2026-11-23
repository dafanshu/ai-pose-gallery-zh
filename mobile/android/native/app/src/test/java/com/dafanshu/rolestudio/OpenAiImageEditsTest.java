package com.dafanshu.rolestudio;

import java.util.Collections;
import okhttp3.Request;
import okio.Buffer;
import org.junit.Test;
import static org.junit.Assert.*;

public class OpenAiImageEditsTest {
    @Test public void preparesOneShotOfficialMultipartWithoutCompatibilityParameters() throws Exception {
        Request request = OpenAiImageEdits.buildRequest("synthetic-test-key", "gpt-image-2.6-flare",
            "测试提示词", "1024x1536", "auto", Collections.singletonList(new StudioImages.Encoded(new byte[]{42}, "image/png")));
        assertEquals("https://api.openai.com/v1/images/edits", request.url().toString());
        assertEquals("POST", request.method());
        assertEquals("Bearer synthetic-test-key", request.header("Authorization"));
        assertNotNull(request.body());
        assertTrue(request.body().isOneShot());
        Buffer stream = new Buffer();
        request.body().writeTo(stream);
        String payload = stream.readUtf8();
        assertTrue(payload.contains("name=\"image[]\"; filename=\"reference-1.png\""));
        assertTrue(payload.matches("(?s).*name=\"n\"\r\n(?:Content-Length: [0-9]+\r\n)?\r\n1\r\n.*"));
        assertTrue(payload.matches("(?s).*name=\"output_format\"\r\n(?:Content-Length: [0-9]+\r\n)?\r\npng\r\n.*"));
        assertTrue(payload.contains("测试提示词"));
        assertFalse(payload.contains("input_fidelity"));
        assertFalse(payload.contains("response_format"));
        assertFalse(payload.contains("synthetic-test-key"));
    }

    @Test public void onlySupportedOptionsAndNonemptyPromptPass() {
        for (String model : new String[]{"gpt-image-2.6-flare", "gpt-image-2.6-sunburst", "gpt-image-2"}) {
            assertTrue(OpenAiImageEdits.validForm(model, "reference prompt", "auto", "high"));
        }
        assertFalse(OpenAiImageEdits.validForm("https://example.com", "prompt", "auto", "high"));
        assertFalse(OpenAiImageEdits.validForm("gpt-image-2", " ", "auto", "high"));
        assertFalse(OpenAiImageEdits.validForm("gpt-image-2", "prompt", "4096x4096", "high"));
        assertFalse(OpenAiImageEdits.validForm("gpt-image-2", "prompt", "auto", "max"));
    }
}
