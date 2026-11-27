package com.dafanshu.rolestudio;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class CaptionImageSource {
    interface Request { void send(String token, String id, String version, String purpose); }
    static volatile Request requester;
    private static final ConcurrentHashMap<String, CompletableFuture<String>> pending = new ConcurrentHashMap<>();
    static String read(String id, String version, String purpose) throws IOException {
        var request = requester;
        if (request == null) throw new IOException("请从合成台重新打开工作台以读取原图");
        String token = UUID.randomUUID().toString();
        var reply = new CompletableFuture<String>();
        pending.put(token, reply);
        try {
            request.send(token, id, version, purpose);
            String data = reply.get(18, TimeUnit.SECONDS);
            if (data == null) throw new IOException("未能读取这张历史图。请返回合成台确认图片还在，再重开文案工作台。");
            return data;
        } catch (IOException e) { throw e; }
        catch (TimeoutException e) { throw new IOException("合成台读取原图超时，请重开文案工作台后重试。", e); }
        catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new IOException("读取历史图片失败，可返回合成台确认原图", e);
        } finally { pending.remove(token); }
    }
    static void respond(String token, String data) {
        if (token == null) return;
        var reply = pending.remove(token);
        if (reply != null) reply.complete(data);
    }
}
