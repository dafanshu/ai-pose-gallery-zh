package com.dafanshu.rolestudio;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.Authenticator;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okio.BufferedSink;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

enum CloudImageProviders {
    GPT("gpt", "OpenAI", "OpenAI", 6, Arrays.asList("gpt-image-2.6-flare", "gpt-image-2.6-sunburst", "gpt-image-2")),
    GEMINI("gemini", "Google Gemini", "Gemini", 3, Arrays.asList("gemini-3.1-flash-image")),
    QWEN("qwen", "阿里云百炼", "Qwen", 3, Arrays.asList("qwen-image-3.0-pro", "qwen-image-3.0")),
    DOUBAO("doubao", "火山方舟", "Doubao", 6, Arrays.asList("doubao-seedream-5-5-261028", "doubao-seedream-4-5-251128"));

    private static final MediaType JSON = MediaType.get("application/json");
    private static final int MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .connectTimeout(15, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS).callTimeout(210, TimeUnit.SECONDS).build();

    final String id, display, vaultName;
    final int limit;
    final List<String> models;

    CloudImageProviders(String id, String display, String vaultName, int limit, List<String> models) {
        this.id = id; this.display = display; this.vaultName = vaultName; this.limit = limit; this.models = models;
    }

    static CloudImageProviders parse(String id) {
        for (var provider : values()) if (provider.id.equals(id)) return provider;
        throw new IllegalArgumentException("Unsupported provider");
    }

    static boolean validWorkspace(String value) {
        return value != null && value.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");
    }

    int maxTotalReferenceBytes() {
        // Google inline request size cap includes the expanded Base64 and the JSON.
        return this == GEMINI ? 14 * 1024 * 1024 : OpenAiImageEdits.MAX_TOTAL_REFERENCE_BYTES;
    }

    boolean validForm(String model, String prompt, String size, String quality, int count) {
        if (count < 1 || count > limit || model == null || !models.contains(model)) return false;
        if (this == GPT) return OpenAiImageEdits.validForm(model, prompt, size, quality);
        return prompt != null && !prompt.trim().isEmpty() && prompt.length() <= 4000;
    }

    /** Each hostname is native-owned. Workspace IDs are one DNS label, never a URL or path. */
    Request buildRequest(String key, String workspace, String model, String prompt, List<StudioImages.Encoded> images) throws JSONException {
        if (this == GPT || !validForm(model, prompt, "", "", images.size())) throw new IllegalArgumentException("Invalid form");
        var request = new Request.Builder().header("Accept", "application/json");
        var json = new JSONObject();
        var parts = new JSONArray();
        switch (this) {
            case GEMINI:
                for (var image : images) parts.put(new JSONObject().put("type", "image")
                    .put("mime_type", image.mime).put("data", image.base64()));
                parts.put(new JSONObject().put("type", "text").put("text", prompt));
                json.put("model", model).put("input", parts).put("store", false)
                    .put("response_format", new JSONObject().put("type", "image"));
                request.url("https://generativelanguage.googleapis.com/v1beta/interactions")
                    .header("Api-Revision", "2026-05-20").header("x-goog-api-key", key);
                break;
            case QWEN:
                if (!validWorkspace(workspace)) throw new IllegalArgumentException("Invalid workspace");
                for (var image : images) parts.put(new JSONObject().put("image", image.dataUrl()));
                parts.put(new JSONObject().put("text", prompt));
                json.put("model", model).put("input", new JSONObject().put("messages",
                    new JSONArray().put(new JSONObject().put("role", "user").put("content", parts))))
                    .put("parameters", new JSONObject().put("n", 1).put("response_format", "b64_json").put("watermark", true));
                request.url("https://" + workspace + ".cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation")
                    .header("Authorization", "Bearer " + key);
                break;
            case DOUBAO:
                for (var image : images) parts.put(image.dataUrl());
                json.put("model", model).put("prompt", prompt).put("image", images.size() == 1 ? parts.get(0) : parts)
                    .put("size", "2K").put("response_format", "b64_json").put("stream", false).put("watermark", true);
                if (model.equals("doubao-seedream-5-5-261028")) json.put("output_format", "png");
                else json.put("sequential_image_generation", "disabled");
                request.url("https://ark.cn-beijing.volces.com/api/v3/images/generations")
                    .header("Authorization", "Bearer " + key);
                break;
            default: throw new IllegalArgumentException("Unsupported provider");
        }
        byte[] body = json.toString().getBytes(StandardCharsets.UTF_8);
        return request.post(new RequestBody() {
            @Override public MediaType contentType() { return JSON; }
            @Override public long contentLength() { return body.length; }
            @Override public boolean isOneShot() { return true; }
            @Override public void writeTo(BufferedSink sink) throws IOException { sink.write(body); }
        }).build();
    }

    byte[] generate(String key, String workspace, String model, String prompt, String size, String quality,
                    List<StudioImages.Encoded> images) throws Exception {
        if (this == GPT) return OpenAiImageEdits.generate(key, model, prompt, size, quality, images);
        try (var response = CLIENT.newCall(buildRequest(key, workspace, model, prompt, images)).execute()) {
            int status = response.code();
            if (!response.isSuccessful()) {
                String hint = status == 401 || status == 403 ? "请核对本机密钥、地区和模型权限。"
                    : status == 429 ? "请检查账户额度和限流。" : "请检查所选模型和参考图。";
                throw failure("_HTTP_" + status, "返回 HTTP " + status + "。" + hint);
            }
            var body = response.body();
            if (body == null || body.contentLength() > MAX_RESPONSE_BYTES) throw badResponse();
            var data = new ByteArrayOutputStream();
            var stream = body.byteStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) != -1) {
                if (data.size() + read > MAX_RESPONSE_BYTES) throw badResponse();
                data.write(chunk, 0, read);
            }
            String base64 = extractImage(new JSONObject(new String(data.toByteArray(), StandardCharsets.UTF_8)));
            return StudioImages.normalizeOutput(base64);
        } catch (IOException failure) {
            throw failure("_NETWORK", "连接中断或超时，提交结果可能未知。请先核对用量。");
        } catch (IllegalArgumentException | JSONException invalid) { throw badResponse(); }
    }

    String extractImage(JSONObject json) throws JSONException, OpenAiImageEdits.Failure {
        if (this == DOUBAO) {
            var generated = json.getJSONArray("data");
            if (generated.length() != 1) throw badResponse();
            return generated.getJSONObject(0).getString("b64_json");
        }
        String base64 = null;
        if (this == GEMINI) {
            var steps = json.getJSONArray("steps");
            for (int i = 0; i < steps.length(); i++) {
                var step = steps.getJSONObject(i);
                if (!"model_output".equals(step.optString("type"))) continue;
                var parts = step.getJSONArray("content");
                for (int j = 0; j < parts.length(); j++) {
                    var part = parts.getJSONObject(j);
                    if (!"image".equals(part.optString("type"))) continue;
                    if (base64 != null) throw badResponse();
                    base64 = part.getString("data");
                }
            }
        } else {
            var choices = json.getJSONObject("output").getJSONArray("choices");
            if (choices.length() != 1) throw badResponse();
            var parts = choices.getJSONObject(0).getJSONObject("message").getJSONArray("content");
            for (int i = 0; i < parts.length(); i++) {
                var part = parts.getJSONObject(i);
                if (!part.has("image")) continue;
                String dataUrl = part.getString("image");
                int comma = dataUrl.indexOf(',');
                if (base64 != null || comma < 0 || !dataUrl.substring(0, comma).matches("data:image/(?:png|jpeg|webp);base64")) throw badResponse();
                base64 = dataUrl.substring(comma + 1);
            }
        }
        if (base64 == null) throw badResponse();
        return base64;
    }

    private OpenAiImageEdits.Failure badResponse() {
        return failure("_RESPONSE", "没有返回可保存的单张图片。请求可能已计费。");
    }

    private OpenAiImageEdits.Failure failure(String suffix, String detail) {
        return new OpenAiImageEdits.Failure(name() + suffix, display + detail + "未自动重试。");
    }
}
