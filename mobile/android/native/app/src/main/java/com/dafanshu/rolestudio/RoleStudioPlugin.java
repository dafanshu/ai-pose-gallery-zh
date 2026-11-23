package com.dafanshu.rolestudio;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native bridge: management results are status-only; page code never reads a stored key. */
@CapacitorPlugin(name = "RoleStudio")
public final class RoleStudioPlugin extends Plugin {
    private static final ExecutorService IO = Executors.newFixedThreadPool(2);
    private static final AtomicBoolean GENERATING = new AtomicBoolean();
    private final AtomicBoolean picking = new AtomicBoolean();

    private StudioKeyVault vault() { return new StudioKeyVault(getContext().getApplicationContext()); }

    @PluginMethod public void keyStatus(PluginCall call) {
        IO.execute(() -> {
            try { call.resolve(new JSObject().put("configured", vault().configured())); }
            catch (Exception failure) { call.reject("无法读取本机密钥状态。", "KEY_STORAGE"); }
        });
    }

    @PluginMethod public void saveKey(PluginCall call) {
        String input = call.getString("key");
        call.getData().remove("key");
        String key = input == null ? null : input.trim();
        if (!StudioKeyVault.validKey(key)) {
            call.reject("请输入有效的 API Key（不含空白字符）。", "INVALID_KEY");
            return;
        }
        if (GENERATING.get()) { rejectBusy(call); return; }
        IO.execute(() -> {
            try { vault().save(key); call.resolve(); }
            catch (Exception failure) { call.reject("本机加密保存失败；没有使用明文存储。", "KEY_STORAGE"); }
        });
    }

    @PluginMethod public void clearKey(PluginCall call) {
        if (GENERATING.get()) { rejectBusy(call); return; }
        IO.execute(() -> {
            try { vault().clear(); call.resolve(); }
            catch (Exception failure) { call.reject("未能删除本机保存的密钥。", "KEY_STORAGE"); }
        });
    }

    @PluginMethod public void pickImage(PluginCall call) {
        if (!picking.compareAndSet(false, true)) { call.reject("已打开图片选择器。", "PICKER_BUSY"); return; }
        var intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(call, intent, "pickedImage"); }
        catch (RuntimeException failure) {
            picking.set(false);
            call.reject("无法打开系统图片选择器。", "PICKER_UNAVAILABLE");
        }
    }

    @ActivityCallback private void pickedImage(PluginCall call, ActivityResult result) {
        if (call == null) { picking.set(false); return; }
        var uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            picking.set(false);
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        IO.execute(() -> {
            try {
                var image = StudioImages.fromPicker(getContext().getContentResolver(), uri);
                picking.set(false);
                call.resolve(new JSObject().put("dataUrl", image.dataUrl).put("name", image.name));
            } catch (Exception failure) {
                picking.set(false);
                call.reject("无法读取该图片。请选择可在本机打开的普通图片文件。", "IMAGE_READ");
            }
        });
    }

    @PluginMethod public void generate(PluginCall call) {
        final String model = call.getString("model"), prompt = call.getString("prompt");
        final String size = call.getString("size"), quality = call.getString("quality");
        final var inputs = call.getArray("images");
        if (!OpenAiImageEdits.validForm(model, prompt, size, quality) || inputs == null || inputs.length() < 1 || inputs.length() > OpenAiImageEdits.MAX_REFERENCES) {
            call.reject("请检查模型、提示词、尺寸、质量，并选 1 至 6 张本地参考图。", "INVALID_FORM");
            return;
        }
        if (!GENERATING.compareAndSet(false, true)) { rejectBusy(call); return; }
        IO.execute(() -> {
            try {
                var images = new ArrayList<StudioImages.Encoded>();
                int total = 0;
                for (int index = 0; index < inputs.length(); index++) {
                    Object value = inputs.opt(index);
                    if (!(value instanceof String)) throw new IllegalArgumentException("Unsupported reference");
                    var image = StudioImages.reference((String) value);
                    total += image.bytes.length;
                    if (total > OpenAiImageEdits.MAX_TOTAL_REFERENCE_BYTES) throw new IllegalArgumentException("References too large");
                    images.add(image);
                }
                final String key;
                try { key = vault().resolve(); }
                catch (Exception failure) { call.reject("本机密钥不能解密，请清除后重新输入。", "KEY_STORAGE"); return; }
                if (key == null) { call.reject("请先保存自己的 OpenAI API Key。", "KEY_REQUIRED"); return; }
                var png = OpenAiImageEdits.generate(key, model, prompt, size, quality, images);
                call.resolve(new JSObject().put("dataUrl", StudioImages.pngDataUrl(png)));
            } catch (IllegalArgumentException failure) {
                call.reject("参考图须是有效的本地 PNG/JPEG，单张最多 5 MiB、合计最多 24 MiB。", "INVALID_REFERENCES");
            } catch (OpenAiImageEdits.Failure failure) {
                call.reject(failure.getMessage(), failure.code);
            } catch (Exception failure) {
                call.reject("未收到可保存的生成结果。不会自动重试，请先核对用量。", "GENERATION_FAILURE");
            } finally { GENERATING.set(false); }
        });
    }

    @PluginMethod public void saveImage(PluginCall call) {
        String image = call.getString("dataUrl"), name = call.getString("name");
        IO.execute(() -> {
            try { StudioImages.save(getContext().getContentResolver(), image, name); call.resolve(); }
            catch (Exception failure) { call.reject("未能把 PNG 保存到相册。请检查图片或本机存储空间。", "IMAGE_SAVE"); }
        });
    }

    private static void rejectBusy(PluginCall call) {
        call.reject("已有生成请求在处理，请等待；不会重复提交。", "GENERATION_BUSY");
    }
}
