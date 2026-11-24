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
    private final AtomicBoolean destroyed = new AtomicBoolean();
    private GalleryPackInput galleryInput;

    @Override public void load() {
        galleryInput = new GalleryPackInput(getContext().getCacheDir());
    }

    @Override protected void handleOnDestroy() {
        destroyed.set(true);
        IO.execute(() -> galleryInput.close());
    }

    private StudioKeyVault vault(CloudImageProviders provider) { return new StudioKeyVault(getContext().getApplicationContext(), provider); }

    private static CloudImageProviders requestProvider(PluginCall call) {
        try { return CloudImageProviders.parse(call.getString("provider")); }
        catch (IllegalArgumentException failure) { call.reject("请选择安卓版支持的厂商。", "INVALID_PROVIDER"); return null; }
    }

    @PluginMethod public void keyStatus(PluginCall call) {
        final var provider = requestProvider(call);
        if (provider == null) return;
        IO.execute(() -> {
            try {
                var credential = vault(provider).resolve();
                var result = new JSObject().put("configured", credential != null);
                if (credential != null && credential.workspaceId != null) result.put("workspaceId", credential.workspaceId);
                call.resolve(result);
            } catch (Exception failure) { call.reject("无法读取本机密钥状态。", "KEY_STORAGE"); }
        });
    }

    @PluginMethod public void saveKey(PluginCall call) {
        String input = call.getString("key");
        call.getData().remove("key");
        final var provider = requestProvider(call);
        if (provider == null) return;
        String key = input == null ? null : input.trim();
        String workspaceId = call.getString("workspaceId");
        if (provider == CloudImageProviders.QWEN && !CloudImageProviders.validWorkspace(workspaceId)) {
            call.reject("请输入百炼 Workspace ID，不能填写网址。", "INVALID_WORKSPACE");
            return;
        }
        if (!StudioKeyVault.validKey(key)) {
            call.reject("请输入有效的 API Key（不含空白字符）。", "INVALID_KEY");
            return;
        }
        if (GENERATING.get()) { rejectBusy(call); return; }
        IO.execute(() -> {
            try { vault(provider).save(key, workspaceId); call.resolve(); }
            catch (Exception failure) { call.reject("本机加密保存失败；没有使用明文存储。", "KEY_STORAGE"); }
        });
    }

    @PluginMethod public void clearKey(PluginCall call) {
        final var provider = requestProvider(call);
        if (provider == null) return;
        if (GENERATING.get()) { rejectBusy(call); return; }
        IO.execute(() -> {
            try { vault(provider).clear(); call.resolve(); }
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

    @PluginMethod public void pickGalleryPack(PluginCall call) {
        if (!picking.compareAndSet(false, true)) { call.reject("已打开系统选择器。", "PICKER_BUSY"); return; }
        var intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/json", "application/octet-stream", "text/plain"})
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(call, intent, "pickedGalleryPack"); }
        catch (RuntimeException failure) {
            picking.set(false);
            call.reject("无法打开系统文件选择器。", "PICKER_UNAVAILABLE");
        }
    }

    @ActivityCallback private void pickedGalleryPack(PluginCall call, ActivityResult result) {
        if (call == null) { picking.set(false); return; }
        var uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            picking.set(false);
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        if (!"content".equals(uri.getScheme())) {
            picking.set(false);
            call.reject("请选择系统文件中的本地 JSON 素材包。", "GALLERY_READ");
            return;
        }
        IO.execute(() -> {
            try {
                String token;
                try (var input = getContext().getContentResolver().openInputStream(uri)) {
                    if (destroyed.get()) return;
                    token = galleryInput.stage(input);
                }
                if (destroyed.get()) { galleryInput.close(token); return; }
                call.resolve(new JSObject().put("token", token).put("size", galleryInput.size(token)));
            } catch (Exception failure) {
                galleryInput.close();
                call.reject("无法读取素材包。请选择可用的 JSON 文件，大小不超过 40 MiB。", "GALLERY_READ");
            } finally { picking.set(false); }
        });
    }

    @PluginMethod public void readGalleryPackChunk(PluginCall call) {
        String token = call.getString("token");
        Integer offset = call.getInt("offset");
        IO.execute(() -> {
            try {
                if (offset == null) throw new IllegalArgumentException("Missing offset");
                byte[] bytes = galleryInput.chunk(token, offset);
                String data = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
                call.resolve(new JSObject().put("data", data));
            } catch (Exception failure) {
                call.reject("素材包读取中断，请重新选择文件。", "GALLERY_READ");
            }
        });
    }

    @PluginMethod public void closeGalleryPack(PluginCall call) {
        String token = call.getString("token");
        IO.execute(() -> { galleryInput.close(token); call.resolve(); });
    }

    @PluginMethod public void generate(PluginCall call) {
        final var provider = requestProvider(call);
        if (provider == null) return;
        final String model = call.getString("model"), prompt = call.getString("prompt");
        final String size = call.getString("size"), quality = call.getString("quality");
        final var inputs = call.getArray("images");
        if (inputs == null || !provider.validForm(model, prompt, size, quality, inputs.length())) {
            call.reject("请检查模型、提示词及选项，并选 1 至 " + provider.limit + " 张本地参考图。", "INVALID_FORM");
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
                    if (total > provider.maxTotalReferenceBytes()) throw new IllegalArgumentException("References too large");
                    images.add(image);
                }
                final StudioKeyVault.Credential credential;
                try { credential = vault(provider).resolve(); }
                catch (Exception failure) { call.reject("本机密钥不能解密，请清除后重新输入。", "KEY_STORAGE"); return; }
                if (credential == null) { call.reject("请先配置 " + provider.display + " 的 API Key。", "KEY_REQUIRED"); return; }
                var png = provider.generate(credential.key, credential.workspaceId, model, prompt, size, quality, images);
                call.resolve(new JSObject().put("dataUrl", StudioImages.pngDataUrl(png)));
            } catch (IllegalArgumentException failure) {
                call.reject("参考图须是有效的本地 PNG/JPEG，单张最多 5 MiB、合计最多 " + (provider.maxTotalReferenceBytes() / (1024 * 1024)) + " MiB。", "INVALID_REFERENCES");
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
