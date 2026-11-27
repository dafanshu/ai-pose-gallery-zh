package com.dafanshu.rolestudio;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

final class CaptionStorage {
    private final File root;
    CaptionStorage(Context context) {
        root=new File(context.getNoBackupFilesDir(),"caption-studio-v1");
    }
    private File path(String name) { return new File(root,name); }
    private JSONObject read(String name) throws Exception {
        try { return new JSONObject(new String(new AtomicFile(path(name)).readFully(),StandardCharsets.UTF_8)); }
        catch(FileNotFoundException absent) { return null; }
    }
    private synchronized void save(String name, JSONObject value) throws Exception {
        if(!root.isDirectory()&&!root.mkdirs()) throw new IOException("无法建立配文目录");
        var file=new AtomicFile(path(name));
        var out=file.startWrite();
        try { out.write(value.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(out); }
        catch(Exception e) { file.failWrite(out); throw e; }
    }
    CaptionCore.Config config() throws Exception {
        var saved=read("settings.json"); return saved==null?CaptionCore.Config.defaults():CaptionCore.Config.from(saved);
    }
    void save(CaptionCore.Config config) throws Exception { save("settings.json",config.json()); }
    void save(CaptionCore.Batch batch) throws Exception {
        batch.updated=System.currentTimeMillis(); save("batch-"+UUID.fromString(batch.id)+".json",batch.json());
    }
    List<CaptionCore.Batch> list() throws Exception {
        var result=new ArrayList<CaptionCore.Batch>();
        var files=root.list((dir,n)->n.matches("batch-[0-9a-f-]{36}\\.json"));
        if(files!=null) for(String name:files) {
            var value=read(name); if(value!=null) result.add(CaptionCore.Batch.from(value));
        }
        result.sort(Comparator.comparingLong((CaptionCore.Batch b)->b.created).reversed());
        return result;
    }
    static String key(CaptionCore.Image image,String model,String data) throws Exception {
        byte[] bytes=MessageDigest.getInstance("SHA-256").digest(("analysis-v1\0OpenAI\0"+model+"\0"+image.id()+"\0"+image.version()+"\0"+data).getBytes(StandardCharsets.UTF_8));
        return android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP|android.util.Base64.URL_SAFE|android.util.Base64.NO_PADDING);
    }
    JSONObject analysis(String key) throws Exception { return read("vision-"+key+".json"); }
    void saveAnalysis(String key,JSONObject value) throws Exception { save("vision-"+key+".json",value); }
}
