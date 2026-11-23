package com.dafanshu.rolestudio;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.Authenticator;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okio.BufferedSink;
import org.json.JSONObject;

final class OpenAiImageEdits {
    private static final String ENDPOINT = "https://api.openai.com/v1/images/edits";
    static final int MAX_REFERENCES = 6;
    static final int MAX_TOTAL_REFERENCE_BYTES = 24 * 1024 * 1024;
    private static final int MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
    private static final List<String> MODELS = Arrays.asList("gpt-image-2.6-flare", "gpt-image-2.6-sunburst", "gpt-image-2");
    private static final List<String> SIZES = Arrays.asList("auto", "1024x1024", "1024x1536", "1536x1024");
    private static final List<String> QUALITIES = Arrays.asList("auto", "low", "medium", "high");
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .connectTimeout(15, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS).callTimeout(210, TimeUnit.SECONDS).build();

    private OpenAiImageEdits() {}

    static boolean validForm(String model, String prompt, String size, String quality) {
        return MODELS.contains(model) && SIZES.contains(size) && QUALITIES.contains(quality)
            && prompt != null && !prompt.trim().isEmpty() && prompt.length() <= 32000;
    }

    static Request buildRequest(String apiKey, String model, String prompt, String size, String quality, List<StudioImages.Encoded> images) {
        var fields = new MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("model", model).addFormDataPart("prompt", prompt)
            .addFormDataPart("size", size).addFormDataPart("quality", quality)
            .addFormDataPart("n", "1").addFormDataPart("output_format", "png");
        for (int index = 0; index < images.size(); index++) {
            var image = images.get(index);
            String extension = "image/png".equals(image.mime) ? "png" : "jpg";
            fields.addFormDataPart("image[]", "reference-" + (index + 1) + "." + extension,
                RequestBody.create(image.bytes, MediaType.get(image.mime)));
        }
        var multipart = fields.build();
        // A paid POST may already be accepted even if its response was lost. Prevent
        // the library from replaying it on retryable statuses in addition to disabling networking retries.
        var singleUse = new RequestBody() {
            @Override public MediaType contentType() { return multipart.contentType(); }
            @Override public long contentLength() throws IOException { return multipart.contentLength(); }
            @Override public boolean isOneShot() { return true; }
            @Override public void writeTo(BufferedSink sink) throws IOException { multipart.writeTo(sink); }
        };
        return new Request.Builder().url(ENDPOINT).header("Authorization", "Bearer " + apiKey)
            .header("Accept", "application/json").post(singleUse).build();
    }

    static byte[] generate(String apiKey, String model, String prompt, String size, String quality, List<StudioImages.Encoded> images) throws Failure {
        var request = buildRequest(apiKey, model, prompt, size, quality, images);
        try (var response = CLIENT.newCall(request).execute()) {
            int status = response.code();
            if (status < 200 || status >= 300) throw httpFailure(status);
            var body = response.body();
            if (body == null || body.contentLength() > MAX_RESPONSE_BYTES) throw badResponse();
            try {
                var result = new JSONObject(readBounded(body.byteStream()));
                var data = result.optJSONArray("data");
                if (data == null || data.length() != 1) throw badResponse();
                var image = data.optJSONObject(0);
                if (image == null) throw badResponse();
                return StudioImages.outputPng(image.optString("b64_json", null));
            } catch (IllegalArgumentException | org.json.JSONException invalid) { throw badResponse(); }
        } catch (IOException failure) {
            throw new Failure("OPENAI_NETWORK", "OpenAI 连接中断或超时，提交结果可能未知。未自动重试，请先核对用量。");
        }
    }

    private static String readBounded(InputStream stream) throws IOException, Failure {
        try (var buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int read;
            while ((read = stream.read(chunk)) != -1) {
                if (buffer.size() + read > MAX_RESPONSE_BYTES) throw badResponse();
                buffer.write(chunk, 0, read);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static Failure httpFailure(int status) {
        String message;
        if (status >= 300 && status < 400) message = "OpenAI 返回重定向，已拒绝跳转。";
        else if (status == 401 || status == 403) message = "请检查本机保存的 API Key、模型访问权限和地区支持。";
        else if (status == 429) message = "请检查 API 额度或限流。";
        else if (status >= 500) message = "服务端异常，提交结果可能未知；重试前请核对用量。";
        else message = "请核对所选模型、尺寸、质量、参考图和内容要求。";
        return new Failure("OPENAI_HTTP_" + status, "OpenAI 返回 HTTP " + status + "。" + message + " 未自动重试。");
    }

    private static Failure badResponse() {
        return new Failure("OPENAI_RESPONSE", "OpenAI 未返回可保存的单张 PNG。请求可能已计费，未自动重试。");
    }

    static final class Failure extends Exception {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }
}
