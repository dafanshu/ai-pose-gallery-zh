package com.dafanshu.rolestudio;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.text.Normalizer;
import java.util.*;

final class CaptionCore {
    static final String[] MODES = {"单图独立配文", "多图统一配文", "完整图文文章"};
    static final String[] SOURCES = {"视觉理解", "Prompt 语义", "本地模板"};
    static final String[] PLATFORMS = {"微信公众号", "小红书", "抖音", "微博", "朋友圈", "通用"};
    static final String[] STYLES = {"智能推荐", "氛围感", "心动共鸣", "短句欣赏", "穿搭分享", "国风古韵", "情绪治愈", "互动选择", "系列连载"};
    static final String[] LENGTHS = {"极简", "标准", "丰富"};
    static final int[][] BOUNDS = {{5,25},{25,80},{80,150}};
    static final String DISCLOSURE = "配图由 AI 生成。";
    static final String DEFAULT_MODEL = "gpt-4.1-mini";
    enum State { WAITING, ANALYZING, WRITING, DONE, FAILED, UNKNOWN, CANCELED }

    record Image(String id, String version, String label, String prompt, String costume, String portrait, String pose, String style) {
        JSONObject evidence() throws JSONException {
            return new JSONObject().put("imageId",id).put("prompt",positive(prompt)).put("costume",costume)
                .put("portraitSetting",portrait).put("pose",pose).put("style",style);
        }
    }

    static String limit(String value, int cap) {
        if (value == null) return "";
        return value.length() > cap ? value.substring(0, cap) : value;
    }

    static List<Image> catalog(JSONArray input) throws JSONException {
        if (input.length() > 30) throw new JSONException("历史列表太长");
        var seen = new HashSet<String>();
        var result = new ArrayList<Image>();
        for (int i=0;i<input.length();i++) {
            JSONObject row=input.getJSONObject(i);
            String id=row.getString("id"), version=row.getString("version");
            if (id.trim().isEmpty() || id.length()>240 || version.trim().isEmpty() || version.length()>40 || !seen.add(id))
                throw new JSONException("历史图片编号无效");
            result.add(new Image(id, version, limit(row.optString("label"),160),limit(row.optString("prompt"),32000),
                limit(row.optString("costume"),160),limit(row.optString("portrait"),160),limit(row.optString("pose"),160),limit(row.optString("style"),160)));
        }
        return result;
    }

    static JSONObject imageJson(Image image) throws JSONException {
        return new JSONObject().put("id",image.id).put("version",image.version).put("label",image.label).put("prompt",image.prompt)
            .put("costume",image.costume).put("portrait",image.portrait).put("pose",image.pose).put("style",image.style);
    }

    static String positive(String prompt) {
        return limit(prompt.split("(?im)(?:negative\\s*prompt|负面提示词|反向提示词)\\s*[:：]",2)[0].trim(), 2500);
    }

    record Config(int mode, int source, int platform, int length, int count, int workers, List<String> styles,
                  String textModel, String visionModel, String goal, boolean tags, boolean disclosure, boolean dedup, String extra, String system) {
        Config {
            if (mode<0 || mode>=MODES.length || source<0 || source>=SOURCES.length || platform<0 || platform>=PLATFORMS.length
                || length<0 || length>=LENGTHS.length || count<1 || count>5 || workers<1 || workers>2 ||
                (source!=2 && (!modelId(textModel) || (source==0 && !modelId(visionModel)))) ||
                styles.isEmpty() || !Arrays.asList(STYLES).containsAll(styles)) throw new IllegalArgumentException("请检查模型和生成参数");
            styles=Collections.unmodifiableList(new ArrayList<>(styles));
        }
        static Config defaults() { return new Config(0,0,0,1,3,2,Collections.singletonList(STYLES[0]),DEFAULT_MODEL,DEFAULT_MODEL,"审美共鸣与自然互动",true,true,true,"",""); }
        static Config from(JSONObject o) throws JSONException {
            var styles=new ArrayList<String>();
            var values=o.getJSONArray("styles");
            for(int i=0;i<values.length();i++) styles.add(values.getString(i));
            return new Config(o.getInt("mode"),o.getInt("source"),o.getInt("platform"),o.getInt("length"),o.getInt("count"),o.getInt("workers"),
                styles,o.getString("textModel"),o.getString("visionModel"),o.getString("goal"),o.getBoolean("tags"),o.getBoolean("disclosure"),
                o.getBoolean("dedup"),o.getString("extra"),o.getString("system"));
        }
        Config withCount(int next) { return new Config(mode,source,platform,length,next,workers,styles,textModel,visionModel,goal,tags,disclosure,dedup,extra,system); }
        JSONObject json() throws JSONException {
            return new JSONObject().put("mode",mode).put("source",source).put("platform",platform).put("length",length).put("count",count)
                .put("workers",workers).put("styles",new JSONArray(styles)).put("textModel",textModel).put("visionModel",visionModel)
                .put("goal",goal).put("tags",tags).put("disclosure",disclosure).put("dedup",dedup).put("extra",extra).put("system",system);
        }
    }
    static boolean modelId(String model) { return model != null && model.matches("[A-Za-z0-9][-A-Za-z0-9._:]{0,127}"); }

    static final class Unit {
        final Image image;
        State state=State.WAITING;
        String error="", edited="", selection="", editedTitle="", ending="", summary="";
        boolean favorite, used, forceAnalyze;
        int requestedCount;
        final List<JSONObject> versions=new ArrayList<>();
        Unit(Image image) { this.image=image; }
        boolean recover() {
            if (state!=State.ANALYZING && state!=State.WRITING) return false;
            state=State.UNKNOWN; error="上次请求结果不明。核对用量后手动重试。"; return true;
        }
        void reset() { state=State.WAITING; error=""; }
        void append(JSONObject result) { versions.add(result); state=State.DONE; error=""; }
        JSONObject latest() { return versions.isEmpty()? new JSONObject() : versions.get(versions.size()-1); }
        JSONObject json() throws JSONException {
            return new JSONObject().put("state",state.name()).put("error",error).put("edited",edited)
                .put("editedTitle",editedTitle).put("selection",selection).put("ending",ending).put("summary",summary).put("favorite",favorite).put("used",used)
                .put("forceAnalyze",forceAnalyze).put("requestedCount",requestedCount).put("versions",new JSONArray(versions));
        }
        void load(JSONObject o) throws JSONException {
            state=State.valueOf(o.getString("state")); error=o.optString("error"); edited=o.optString("edited"); selection=o.optString("selection");
            editedTitle=o.optString("editedTitle"); ending=o.optString("ending"); summary=o.optString("summary"); favorite=o.optBoolean("favorite"); used=o.optBoolean("used"); forceAnalyze=o.optBoolean("forceAnalyze"); requestedCount=o.optInt("requestedCount");
            JSONArray v=o.getJSONArray("versions"); for(int i=0;i<v.length();i++) versions.add(v.getJSONObject(i));
        }
    }
    static final class Batch {
        final String id;
        final long created;
        long updated;
        final Config config;
        final List<Unit> units;
        final Unit group=new Unit(null);
        boolean canceled;
        Batch(String id, long created, Config config, List<Image> images) {
            this.id=id; this.created=created; updated=created; this.config=config;
            this.units=images.stream().map(Unit::new).collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        }
        List<Unit> work() {
            if (config.mode==0) return units;
            if (config.source!=0) return Collections.singletonList(group);
            var work=new ArrayList<>(units); work.add(group); return work;
        }
        boolean canStart(Unit u) {
            return !canceled && u.state==State.WAITING && (u!=group || config.source!=0 || units.stream().allMatch(row->row.state==State.DONE));
        }
        JSONObject json() throws JSONException {
            var rows=new JSONArray();
            for (var u:units) rows.put(imageJson(u.image).put("work",u.json()));
            return new JSONObject().put("schema",1).put("id",id).put("created",created).put("updated",updated)
                .put("config",config.json()).put("images",rows).put("group",group.json()).put("canceled",canceled);
        }
        static Batch from(JSONObject o) throws JSONException {
            if (o.getInt("schema")!=1) throw new JSONException("不支持的批次版本");
            var rows=o.getJSONArray("images");
            var b=new Batch(o.getString("id"),o.getLong("created"),Config.from(o.getJSONObject("config")),catalog(rows));
            b.updated=o.optLong("updated",b.created);
            b.canceled=o.optBoolean("canceled");
            for(int i=0;i<rows.length();i++) b.units.get(i).load(rows.getJSONObject(i).getJSONObject("work"));
            b.group.load(o.getJSONObject("group")); return b;
        }
    }
    static final String[] ANALYSIS_FIELDS={"theme","mood","clothes","colors","scene","action","light","style","keywords","description"};
    static JSONObject analysis(JSONObject raw, Image image) throws JSONException {
        imageId(raw,image.id);
        var output=new JSONObject().put("imageId",image.id);
        for(String k:ANALYSIS_FIELDS) output.put(k, str(raw,k,k.equals("description")?500:180,false));
        if (output.getString("description").trim().isEmpty()) throw invalid();
        return output;
    }
    static JSONObject captions(JSONObject raw, Image image, Config c) throws JSONException {
        imageId(raw,image.id);
        JSONArray rows=raw.getJSONArray("captions");
        if(rows.length()!=c.count) throw invalid();
        var output=new JSONArray(); var bodies=new ArrayList<String>(); var titles=new HashSet<String>();
        for(int i=0;i<rows.length();i++) {
            var row=rows.getJSONObject(i);
            String body=caption(row,"content",c.length), title=str(row,"title",160,true), style=str(row,"type",30,true);
            if(!Arrays.asList(STYLES).contains(style) || (c.dedup && (bodies.stream().anyMatch(x->similar(x,body)) || !titles.add(normal(title))))) throw invalid();
            bodies.add(body);
            output.put(new JSONObject().put("type",style).put("title",title).put("content",body).put("tags",tags(row,c.tags)));
        }
        return new JSONObject().put("imageId",image.id).put("captions",output);
    }
    static JSONObject group(JSONObject raw, List<Unit> ordered, Config c) throws JSONException {
        var plans=raw.getJSONArray("plans");
        if(plans.length()!=c.count) throw invalid();
        var output=new JSONArray(); var titles=new HashSet<String>();
        for(int i=0;i<plans.length();i++) {
            var plan=plans.getJSONObject(i);
            var names=plan.getJSONArray("titleCandidates");
            if(names.length()<(c.mode==2?2:1) || names.length()>5) throw invalid();
            var sanitizedNames=new JSONArray();
            for(int j=0;j<names.length();j++) {
                String title=names.getString(j).trim();
                if(title.trim().isEmpty() || title.length()>160 || (c.dedup && !titles.add(normal(title)))) throw invalid();
                sanitizedNames.put(title);
            }
            var p=new JSONObject().put("titleCandidates",sanitizedNames).put("introduction",str(plan,"introduction",5000,true))
                .put("summary",c.mode==2?str(plan,"summary",3000,true):"")
                .put("ending",str(plan,"ending",2000,true)).put("tags",tags(plan,c.tags));
            if(c.mode==2) {
                var items=plan.getJSONArray("items"); if(items.length()!=ordered.size()) throw invalid();
                var byId=new HashMap<String,JSONObject>();
                for(int j=0;j<items.length();j++) {
                    JSONObject row=items.getJSONObject(j);
                    String id=str(row,"imageId",240,true);
                    if(byId.put(id,row)!=null) throw invalid();
                }
                var arranged=new JSONArray();
                for(var u:ordered) {
                    var row=byId.get(u.image.id); if(row==null) throw invalid();
                    arranged.put(new JSONObject().put("imageId",u.image.id)
                        .put("caption",caption(row,"caption",c.length)).put("transition",str(row,"transition",1000,false)));
                }
                p.put("items",arranged);
            }
            output.put(p);
        }
        return new JSONObject().put("plans",output);
    }
    static JSONArray tags(JSONObject row, boolean enabled) throws JSONException {
        var tags=new JSONArray(); if(!enabled) return tags;
        var values=row.getJSONArray("tags"); if(values.length()>12) throw invalid();
        var seen=new HashSet<String>();
        for(int i=0;i<values.length();i++) {
            String value=values.getString(i).trim().replaceFirst("^[#＃]+","");
            if(value.trim().isEmpty()||value.length()>30) throw invalid();
            if(seen.add(value)) tags.put(value);
        }
        return tags;
    }
    static String str(JSONObject o,String key,int cap,boolean required) throws JSONException {
        var value=o.opt(key);
        if((value==null||value==JSONObject.NULL)&&!required) return "";
        if(!(value instanceof String s)||s.length()>cap||(required&&s.trim().isEmpty())) throw invalid();
        return s.trim();
    }
    static String caption(JSONObject o,String key,int length) throws JSONException {
        String s=str(o,key,600,true);
        int n=s.codePointCount(0,s.length());
        if(n<BOUNDS[length][0]||n>BOUNDS[length][1]) throw invalid();
        return s;
    }
    static void imageId(JSONObject o,String id) throws JSONException { if(!id.equals(o.opt("imageId"))) throw invalid(); }
    static JSONException invalid() { return new JSONException("模型结果不符合图片编号、数量、长度或字段约定"); }

    static String normal(String value) {
        return Normalizer.normalize(value,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]","");
    }
    static boolean similar(String a,String b) {
        a=normal(a); b=normal(b);
        if(a.isEmpty()||b.isEmpty()) return false;
        if(a.equals(b)) return true;
        if(Math.min(a.length(),b.length())<12) return false;
        var aa=bigrams(a); var bb=bigrams(b); int total=aa.size()+bb.size(); aa.retainAll(bb);
        return total>0 && 2.0*aa.size()/total>=0.84;
    }
    private static Set<String> bigrams(String s) {
        var grams=new HashSet<String>(); for(int i=1;i<s.length();i++) grams.add(s.substring(i-1,i+1)); return grams;
    }
}
