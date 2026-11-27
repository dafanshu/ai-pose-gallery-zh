package com.dafanshu.rolestudio;

import android.app.Activity;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
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
    private GalleryZipStore galleryZip;
    private BackupDocuments backupDocuments;
    private final CaptionImageSource.Request captionSource = (token, id, version, purpose) ->
        getActivity().runOnUiThread(() -> {
            if (destroyed.get()) CaptionImageSource.respond(token, null);
            else notifyListeners("captionImageRequested", new JSObject().put("token", token)
                .put("id", id).put("version", version).put("purpose", purpose));
        });

    @PluginMethod public void openCaptionWorkbench(PluginCall call) {
        var images = call.getArray("images");
        if (images == null || images.length() > 30) { call.reject("无法读取历史列表。", "CAPTION_HISTORY"); return; }
        try {
            var catalog = CaptionCore.catalog(images);
            String selected = call.getString("selectedId");
            var activity = getActivity();
            activity.runOnUiThread(() -> {
                if (destroyed.get() || activity.isFinishing()) { call.reject("合成台未就绪。", "CAPTION_HISTORY"); return; }
                CaptionImageSource.requester = captionSource;
                CaptionWorkbenchActivity.open(activity, catalog, selected);
                call.resolve();
            });
        } catch (Exception failure) { call.reject("无法读取历史列表。", "CAPTION_HISTORY"); }
    }

    @PluginMethod public void provideCaptionImage(PluginCall call) {
        String image = call.getString("dataUrl");
        if (image != null && (image.length() > 22_369_650 ||
            !(image.startsWith("data:image/png;base64,") || image.startsWith("data:image/jpeg;base64,")))) image = null;
        CaptionImageSource.respond(call.getString("token"), image);
        call.resolve();
    }

    @Override public void load() {
        galleryInput = new GalleryPackInput(getContext().getCacheDir());
        galleryZip = new GalleryZipStore(getContext().getFilesDir());
        backupDocuments = new BackupDocuments(getContext().getCacheDir());
    }

    @Override protected void handleOnDestroy() {
        destroyed.set(true);
        if (CaptionImageSource.requester == captionSource) CaptionImageSource.requester = null;
        IO.execute(() -> { galleryInput.close(); backupDocuments.close(); });
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

    /** Only invoked by the foreground settings paste button; never reads the vault. */
    @PluginMethod public void pasteKeyFromClipboard(PluginCall call) {
        var activity = getActivity();
        if (activity == null) { call.reject("当前无法读取剪贴板。", "CLIPBOARD_UNAVAILABLE"); return; }
        activity.runOnUiThread(() -> {
            if (destroyed.get() || !activity.hasWindowFocus()) {
                call.reject("当前无法读取剪贴板。", "CLIPBOARD_UNAVAILABLE");
                return;
            }
            try {
                var clipboard = activity.getSystemService(ClipboardManager.class);
                var clip = clipboard == null ? null : clipboard.getPrimaryClip();
                var item = clip != null && clip.getItemCount() == 1 && clip.getDescription().hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN)
                    ? clip.getItemAt(0) : null;
                CharSequence text = item != null && item.getUri() == null && item.getIntent() == null ? item.getText() : null;
                String key = text == null || text.length() > 4096 ? null : text.toString().trim();
                if (!StudioKeyVault.validKey(key)) {
                    call.reject("剪贴板中没有可粘贴的 API Key。", "INVALID_CLIPBOARD_KEY");
                    return;
                }
                call.resolve(new JSObject().put("key", key));
            } catch (RuntimeException failure) {
                call.reject("当前无法读取剪贴板。", "CLIPBOARD_UNAVAILABLE");
            }
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

    @PluginMethod public void pickGalleryZip(PluginCall call) {
        if (!picking.compareAndSet(false, true)) { call.reject("已打开系统选择器。", "PICKER_BUSY"); return; }
        var intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/zip", "application/x-zip-compressed", "application/octet-stream"})
            .putExtra(Intent.EXTRA_LOCAL_ONLY, true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { startActivityForResult(call, intent, "pickedGalleryZip"); }
        catch (RuntimeException failure) {
            picking.set(false);
            call.reject("无法打开系统文件选择器。", "PICKER_UNAVAILABLE");
        }
    }

    @ActivityCallback private void pickedGalleryZip(PluginCall call, ActivityResult result) {
        if (call == null) { picking.set(false); return; }
        var uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            picking.set(false);
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        if (!"content".equals(uri.getScheme())) {
            picking.set(false);
            call.reject("请选择设备中的本地 ZIP 素材包。", "GALLERY_ZIP_IMPORT");
            return;
        }
        IO.execute(() -> {
            try {
                if (destroyed.get()) return;
                var input = getContext().getContentResolver().openInputStream(uri);
                GalleryZipStore.Index installed;
                try { installed = galleryZip.install(input, destroyed::get); }
                finally { if (input != null) try { input.close(); } catch (java.io.IOException ignored) {} }
                if (!destroyed.get()) call.resolve(galleryStatus(installed));
            } catch (Exception failure) {
                if (!destroyed.get()) call.reject("无法导入 ZIP 素材包。请检查格式是否正确，并确认设备有足够空间。旧素材包未被替换。", "GALLERY_ZIP_IMPORT");
            } finally { picking.set(false); }
        });
    }

    private static JSObject galleryStatus(GalleryZipStore.Index index) {
        if (index == null) return new JSObject().put("installed", false);
        return new JSObject().put("installed", true).put("revision", index.revision()).put("count", index.items().size());
    }

    @PluginMethod public void galleryZipStatus(PluginCall call) {
        IO.execute(() -> {
            try { call.resolve(galleryStatus(galleryZip.status())); }
            catch (Exception failure) { call.reject("无法打开 ZIP 素材库，请重新导入。", "GALLERY_ZIP_READ"); }
        });
    }

    @PluginMethod public void listGalleryZip(PluginCall call) {
        String revision = call.getString("revision");
        Integer offset = call.getInt("offset");
        IO.execute(() -> {
            try {
                var index = galleryZip.status();
                var page = galleryZip.page(revision, offset);
                var entries = new JSArray();
                for (var entry : page) {
                    var tags = new JSArray();
                    for (var tag : entry.tags()) tags.put(tag);
                    entries.put(new JSObject().put("id", entry.id()).put("slot", entry.slot()).put("name", entry.name()).put("tags", tags));
                }
                int end = offset + page.size();
                call.resolve(new JSObject().put("items", entries).put("nextOffset",
                    end < index.items().size() ? end : org.json.JSONObject.NULL));
            } catch (Exception failure) { call.reject("ZIP 素材索引已变更或不可读，请刷新。", "GALLERY_ZIP_READ"); }
        });
    }

    @PluginMethod public void readGalleryZipImage(PluginCall call) {
        String revision = call.getString("revision"), kind = call.getString("kind");
        Integer id = call.getInt("id"), offset = call.getInt("offset");
        IO.execute(() -> {
            try {
                var part = galleryZip.read(revision, id, kind, offset);
                String data = android.util.Base64.encodeToString(part.data(), android.util.Base64.NO_WRAP);
                call.resolve(new JSObject().put("data", data).put("mime", "image/jpeg").put("nextOffset",
                    part.nextOffset() == null ? org.json.JSONObject.NULL : part.nextOffset()));
            } catch (Exception failure) { call.reject("ZIP 素材图片不可读，请刷新素材库。", "GALLERY_ZIP_READ"); }
        });
    }

    @PluginMethod public void clearGalleryZip(PluginCall call) {
        if (!picking.compareAndSet(false, true)) { call.reject("请先结束正在进行的文件导入。", "PICKER_BUSY"); return; }
        IO.execute(() -> {
            try { galleryZip.clear(); call.resolve(); }
            catch (Exception failure) { call.reject("无法移除 ZIP 素材包。", "GALLERY_ZIP_REMOVE"); }
            finally { picking.set(false); }
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

    @PluginMethod public void pickBackup(PluginCall call) {
        var intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/json", "application/octet-stream", "text/plain"})
            .putExtra(Intent.EXTRA_LOCAL_ONLY, true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        openBackupPicker(call, intent, "pickedBackup");
    }

    @ActivityCallback private void pickedBackup(PluginCall call, ActivityResult result) {
        if (call == null) { picking.set(false); return; }
        var uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            picking.set(false);
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        if (!"content".equals(uri.getScheme())) {
            picking.set(false);
            call.reject("请选择系统文件中的备份。", "BACKUP_READ");
            return;
        }
        IO.execute(() -> {
            BackupDocuments.Read staged = null;
            try {
                if (destroyed.get()) return;
                try (var input = getContext().getContentResolver().openInputStream(uri)) {
                    staged = backupDocuments.stage(input);
                }
                if (destroyed.get()) { backupDocuments.closeRead(staged.token()); return; }
                call.resolve(new JSObject().put("token", staged.token()).put("size", staged.size()));
            } catch (Exception failure) {
                if (staged != null) backupDocuments.closeRead(staged.token());
                call.reject("无法读取备份。请选择可读取且不超过 50 MiB 的文件。", "BACKUP_READ");
            } finally { picking.set(false); }
        });
    }

    @PluginMethod public void readBackupChunk(PluginCall call) {
        String token = call.getString("token");
        Integer offset = call.getInt("offset");
        IO.execute(() -> {
            try { call.resolve(new JSObject().put("data", backupDocuments.read(token, offset))); }
            catch (Exception failure) { call.reject("备份读取中断，请重新选择文件。", "BACKUP_READ"); }
        });
    }

    @PluginMethod public void closeBackupRead(PluginCall call) {
        String token = call.getString("token");
        IO.execute(() -> { if (token != null) backupDocuments.closeRead(token); call.resolve(); });
    }

    @PluginMethod public void createBackup(PluginCall call) {
        Integer size = call.getInt("size");
        if (!BackupDocuments.validSize(size)) { call.reject("备份不能为空或超过 50 MiB。", "BACKUP_SIZE"); return; }
        var intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json").putExtra(Intent.EXTRA_TITLE, "role-studio-android-backup.json")
            .putExtra(Intent.EXTRA_LOCAL_ONLY, true).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        openBackupPicker(call, intent, "pickedBackupDestination");
    }

    private void openBackupPicker(PluginCall call, Intent intent, String callback) {
        if (!picking.compareAndSet(false, true)) { call.reject("已打开系统选择器。", "PICKER_BUSY"); return; }
        try { startActivityForResult(call, intent, callback); }
        catch (RuntimeException failure) {
            picking.set(false);
            call.reject("无法打开系统文件选择器。", "PICKER_UNAVAILABLE");
        }
    }

    @ActivityCallback private void pickedBackupDestination(PluginCall call, ActivityResult result) {
        if (call == null) { picking.set(false); return; }
        var uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            picking.set(false);
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        if (!"content".equals(uri.getScheme())) {
            picking.set(false);
            call.reject("请选择系统文件中的备份位置。", "BACKUP_WRITE");
            return;
        }
        var context = getContext().getApplicationContext();
        var resolver = context.getContentResolver();
        // ACTION_CREATE_DOCUMENT cannot overwrite an existing file. Only its newly issued
        // document URI is considered for best-effort removal on cancellation or failure.
        BackupDocuments.Destination destination = new BackupDocuments.Destination() {
            @Override public java.io.OutputStream open() throws java.io.IOException {
                return resolver.openOutputStream(uri, "wt");
            }
            @Override public void discard() {
                try { if (DocumentsContract.isDocumentUri(context, uri)) DocumentsContract.deleteDocument(resolver, uri); }
                catch (Exception ignored) { /* Document provider may not support removal. */ }
            }
        };
        IO.execute(() -> {
            try {
                if (destroyed.get()) { destination.discard(); return; }
                Integer size = call.getInt("size");
                if (!BackupDocuments.validSize(size)) throw new IllegalArgumentException("Invalid backup size");
                String token = backupDocuments.create(size, destination);
                if (destroyed.get()) { backupDocuments.cancel(token); return; }
                call.resolve(new JSObject().put("token", token));
            } catch (Exception failure) {
                destination.discard();
                call.reject("无法创建备份文件，请选择其他位置后重试。", "BACKUP_WRITE");
            } finally { picking.set(false); }
        });
    }

    @PluginMethod public void writeBackupChunk(PluginCall call) {
        String token = call.getString("token"), data = call.getString("data");
        Integer offset = call.getInt("offset");
        call.getData().remove("data");
        IO.execute(() -> {
            try { backupDocuments.write(token, offset, data); call.resolve(); }
            catch (Exception failure) { call.reject("备份写入中断，请重新导出。", "BACKUP_WRITE"); }
        });
    }

    @PluginMethod public void finishBackup(PluginCall call) {
        String token = call.getString("token");
        IO.execute(() -> {
            try { backupDocuments.finish(token); call.resolve(); }
            catch (Exception failure) { call.reject("备份未完整保存，请重新导出。", "BACKUP_WRITE"); }
        });
    }

    @PluginMethod public void cancelBackup(PluginCall call) {
        String token = call.getString("token");
        IO.execute(() -> { if (token != null) backupDocuments.cancel(token); call.resolve(); });
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
