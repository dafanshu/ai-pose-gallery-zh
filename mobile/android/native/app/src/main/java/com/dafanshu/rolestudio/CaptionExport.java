package com.dafanshu.rolestudio;

import org.json.*;
import java.util.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;

final class CaptionExport {
    record Draft(String title,String intro,List<String> captions,List<String> transitions,String summary,String ending,String tags,String disclosure) {}
    record Media(String path,byte[] bytes) {}
    static Draft draft(CaptionCore.Batch b) {
        var captions=new ArrayList<String>(); var transitions=new ArrayList<String>();
        String title="", intro="", summary="", ending="", tags="";
        if(b.config.mode()!=0) {
            var plan=selectedPlan(b.group);
            if(plan!=null) {
                title=b.group.editedTitle.trim().isEmpty()?plan.optJSONArray("titleCandidates").optString(0):b.group.editedTitle;
                intro=b.group.edited.trim().isEmpty()?plan.optString("introduction"):b.group.edited;
                summary=b.group.summary.trim().isEmpty()?plan.optString("summary"):b.group.summary; ending=b.group.ending.trim().isEmpty()?plan.optString("ending"):b.group.ending; tags=tagText(plan);
                var items=plan.optJSONArray("items");
                for(int i=0;i<b.units.size();i++) {
                    var item=items==null?null:items.optJSONObject(i); var u=b.units.get(i);
                    captions.add(!u.edited.trim().isEmpty()?u.edited:item==null?"":item.optString("caption"));
                    transitions.add(item==null?"":item.optString("transition"));
                }
            }
        } else for(var u:b.units) {
            var row=selectedCaption(u);
            String caption=u.edited.trim().isEmpty()?(row==null?"":row.optString("content")):u.edited;
            String heading=u.editedTitle.trim().isEmpty()?(row==null?"":row.optString("title")):u.editedTitle;
            captions.add(caption.trim().isEmpty()?"":join(heading,caption,row==null?"":tagText(row)));
            transitions.add("");
        }
        if(title.trim().isEmpty()) title="图片配文";
        return new Draft(title,intro,captions,transitions,summary,ending,tags,b.config.disclosure()?CaptionCore.DISCLOSURE:"");
    }
    static JSONObject selectedPlan(CaptionCore.Unit u) { return selected(u,"plans"); }
    static JSONObject selectedCaption(CaptionCore.Unit u) { return selected(u,"captions"); }
    private static JSONObject selected(CaptionCore.Unit u,String field) {
        if(!u.selection.isEmpty()) {
            String[] v=u.selection.split(":");
            try {
                var arr=u.versions.get(Integer.parseInt(v[0])).optJSONArray(field);
                if(arr!=null && arr.optJSONObject(Integer.parseInt(v[1]))!=null) return arr.optJSONObject(Integer.parseInt(v[1]));
            } catch(RuntimeException ignored) { /* use latest unchanged candidate */ }
        }
        var rows=u.latest().optJSONArray(field);
        return rows==null?null:rows.optJSONObject(0);
    }
    static String tagText(JSONObject row) {
        var tags=row.optJSONArray("tags"); var out=new StringJoiner(" ");
        if(tags!=null) for(int i=0;i<tags.length();i++) out.add("#"+tags.optString(i));
        return out.toString();
    }
    static String join(String... parts) {
        var out=new StringJoiner("\n\n");
        for(var part:parts) if(!part.trim().isEmpty()) out.add(part);
        return out.toString();
    }
    static String plain(Draft d) { return join(d.title,d.intro,String.join("\n\n",d.captions),d.summary,d.ending,d.tags,d.disclosure); }
    static String html(String x) {
        return x.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");
    }
    static String markdownEscape(String x) {
        var out=new StringBuilder();
        for(char c:html(x).toCharArray()) {
            if("\\`*_{}[]()#+!|~-".indexOf(c)>=0) out.append('\\');
            out.append(c);
        }
        return out.toString();
    }
    static String markdown(Draft d,List<String> paths) {
        var out=new StringBuilder("# "+markdownEscape(d.title)+"\n\n"+markdownEscape(d.intro)+"\n\n");
        for(int i=0;i<Math.max(paths.size(),d.captions.size());i++) {
            if(i<paths.size()) out.append("![图 ").append(i+1).append("](").append(paths.get(i)).append(")\n\n");
            if(i<d.captions.size()) out.append(markdownEscape(join(d.captions.get(i),d.transitions.get(i)))).append("\n\n");
        }
        return out.append(markdownEscape(join(d.summary,d.ending,d.tags,d.disclosure))).toString();
    }
    static String article(Draft d,List<String> paths) {
        var out=new StringBuilder("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+html(d.title)
            +"</title><style>body{margin:auto;padding:20px;max-width:680px;font:17px/1.65 system-ui}img{display:block;max-width:100%;height:auto}p{white-space:pre-wrap}</style><main><h1>"
            +html(d.title)+"</h1><p>"+html(d.intro)+"</p>");
        for(int i=0;i<Math.max(paths.size(),d.captions.size());i++) {
            if(i<paths.size()) out.append("<figure><img src=\"").append(html(paths.get(i))).append("\" alt=\"图 ").append(i+1).append("\"></figure>");
            if(i<d.captions.size()) out.append("<p>").append(html(join(d.captions.get(i),d.transitions.get(i)))).append("</p>");
        }
        return out.append("<p>").append(html(join(d.summary,d.ending,d.tags,d.disclosure))).append("</p></main>").toString();
    }
    static Media media(CaptionCore.Image i,int index) throws IOException {
        String data=CaptionImageSource.read(i.id(),i.version(),"export");
        boolean png=data.startsWith("data:image/png;base64,");
        if(!png&&!data.startsWith("data:image/jpeg;base64,")) throw new IOException("原图格式无效");
        byte[] bytes=Base64.getDecoder().decode(data.substring(data.indexOf(',')+1));
        if(bytes.length<8 || (png ? bytes[0]!=(byte)137||bytes[1]!=80||bytes[2]!=78||bytes[3]!=71 : bytes[0]!=(byte)255||bytes[1]!=(byte)216))
            throw new IOException("原图格式与文件内容不一致");
        return new Media(String.format(Locale.ROOT,"images/%03d.%s",index+1,png?"png":"jpg"),bytes);
    }
    static void zip(File output,CaptionCore.Batch b) throws Exception {
        Draft d=draft(b);
        var paths=new ArrayList<String>(); var mapping=new JSONArray();
        try(var stream=new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(output)))) {
            for(int i=0;i<b.units.size();i++) {
                var image=b.units.get(i).image; var item=media(image,i); paths.add(item.path);
                entry(stream,item.path,item.bytes);
                mapping.put(new JSONObject().put("imageId",image.id()).put("image",item.path)
                    .put("caption",i<d.captions.size()?d.captions.get(i):"")
                    .put("transition",i<d.transitions.size()?d.transitions.get(i):""));
            }
            entry(stream,"captions.json",new JSONObject().put("title",d.title).put("introduction",d.intro).put("items",mapping)
                .put("summary",d.summary).put("ending",d.ending).put("tags",d.tags).put("aiDisclosure",d.disclosure).toString(2));
            entry(stream,"captions.txt",plain(d)); entry(stream,"article.md",markdown(d,paths)); entry(stream,"article.html",article(d,paths));
        }
    }
    private static void entry(ZipOutputStream out,String name,String value) throws IOException { entry(out,name,value.getBytes(StandardCharsets.UTF_8)); }
    private static void entry(ZipOutputStream out,String name,byte[] value) throws IOException {
        out.putNextEntry(new ZipEntry(name)); out.write(value); out.closeEntry();
    }
}
