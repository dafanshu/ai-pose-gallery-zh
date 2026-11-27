package com.dafanshu.rolestudio;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;

public class CaptionCoreTest {
    private static CaptionCore.Image img(String id){return new CaptionCore.Image(id,"1","旗袍","国风\nNegative prompt: 黄色围巾","旗袍","","","");}
    private static CaptionCore.Config cfg(int mode,int source,int count){
        return new CaptionCore.Config(mode,source,0,1,count,2,List.of("智能推荐"),"gpt-4.1-mini","gpt-4.1-mini",
            "审美",true,true,true,"","");
    }
    private static CaptionCore.Batch batch(int mode,int source,int count,List<CaptionCore.Image> images){
        return new CaptionCore.Batch(UUID.randomUUID().toString(),42,cfg(mode,source,count),images);
    }
    private static JSONObject row(String id,String caption) throws Exception {
        return new JSONObject().put("imageId",id).put("caption",caption);
    }
    @Test public void generatesSixtyValidatedCaptionsForTwentySources() throws Exception {
        var imgs=new ArrayList<CaptionCore.Image>();for(int i=0;i<20;i++)imgs.add(img("image-"+i));
        var b=batch(0,1,3,imgs);
        String[] bodies={"并不是要刻意复刻旧时光，只是喜欢这份清简，让人忍不住想停下来看一会儿。","如果把注意力从热闹移开，会发现留白也可以是有分量、能撑得住画面的一笔。","光线往旁边挪了一点，原本平常的画面就有了不同的表情，像不经意翻到的一页。"};
        for(int i=0;i<20;i++){
            var arr=new JSONArray();
            for(int n=0;n<3;n++)arr.put(new JSONObject().put("type","氛围感").put("title","角度 "+i+"-"+n)
                .put("content",bodies[n]+i).put("tags",new JSONArray(List.of("人像"))));
            var u=b.units.get(i);
            u.append(CaptionCore.captions(new JSONObject().put("imageId",u.image.id()).put("captions",arr),u.image,b.config));
        }
        assertEquals(60,b.units.stream().mapToInt(u->u.latest().optJSONArray("captions").length()).sum());
    }
    @Test public void groupRejectsWrongIdsAndReordersByStableIdentity() throws Exception {
        var b=batch(2,1,1,List.of(img("a"),img("b")));
        var first=row("a","原本只是随手一看，后来才发现那一点留白，让整张图都有了余韵。");
        var second=row("b","喜欢这样不用把每一个细节都塞满的画面，静下来看，才看得出层次。");
        var plan=new JSONObject().put("titleCandidates",new JSONArray(List.of("甲","乙"))).put("introduction","开场")
          .put("summary","总结").put("ending","结尾").put("tags",new JSONArray()).put("items",new JSONArray().put(second).put(first));
        var raw=new JSONObject().put("plans",new JSONArray().put(plan));
        var result=CaptionCore.group(raw,b.units,b.config);
        assertEquals("a",result.getJSONArray("plans").getJSONObject(0).getJSONArray("items").getJSONObject(0).getString("imageId"));
        plan.put("items",new JSONArray().put(first).put(first));
        assertThrows(JSONException.class,()->CaptionCore.group(raw,b.units,b.config));
    }
    @Test public void onRecoveryUnknownDoesNotDispatchAndGroupWaitsForAnalysis() throws Exception {
        var b=batch(2,0,1,List.of(img("a"),img("b")));
        assertFalse(b.canStart(b.group)); assertTrue(b.canStart(b.units.get(0)));
        b.units.get(0).state=CaptionCore.State.ANALYZING;b.units.get(1).append(new JSONObject().put("description","已完成"));
        var recovered=CaptionCore.Batch.from(b.json());
        assertTrue(recovered.units.get(0).recover());
        assertFalse(recovered.canStart(recovered.units.get(0)));assertFalse(recovered.canStart(recovered.group));
        recovered.units.get(0).reset();assertTrue(recovered.canStart(recovered.units.get(0)));
        recovered.units.get(0).append(new JSONObject());assertTrue(recovered.canStart(recovered.group));
    }
    @Test public void preservingEditedTextAcrossRegenerationAndRestart() throws Exception {
        var a=batch(0,1,1,List.of(img("a")));var u=a.units.get(0);
        u.append(new JSONObject());u.edited="手工修改";u.editedTitle="选中";u.selection="0:0";u.favorite=true;u.used=true;
        u.reset();u.append(new JSONObject());
        var b=CaptionCore.Batch.from(a.json());
        assertEquals(2,b.units.get(0).versions.size());assertEquals("手工修改",b.units.get(0).edited);
        assertEquals("选中",b.units.get(0).editedTitle);assertTrue(b.units.get(0).used);assertTrue(b.units.get(0).favorite);
    }
    @Test public void excludesNegativePromptsAndNormalizesDuplicates(){
        assertEquals("国风",CaptionCore.positive(img("x").prompt()));
        assertTrue(CaptionCore.similar("Ｈello！ 旗袍。","hello旗袍"));
        assertFalse(CaptionCore.similar("红绸映着金色日光","肩头铺了一层薄雾"));
    }
    @Test public void exportedMarkupEscapesTextAndKeepsRelativeImages(){
        var draft=new CaptionExport.Draft("<script>alert(1)</script>","![bad](https://src)",List.of("图一","图二"),List.of("","过渡"),"","","","AI");
        var paths=List.of("images/001.jpg","images/002.png");
        String md=CaptionExport.markdown(draft,paths),html=CaptionExport.article(draft,paths);
        assertFalse(html.contains("<script>"));assertTrue(html.contains("&lt;script&gt;"));
        assertTrue(html.indexOf("images/001.jpg")<html.indexOf("images/002.png"));
        assertTrue(md.contains("![图 2](images/002.png)"));assertTrue(md.contains("\\!\\[bad"));
    }

    @Test public void nativeImageBridgeMatchesEachRequestByToken() throws Exception {
        CaptionImageSource.Request previous=CaptionImageSource.requester;
        try {
            CaptionImageSource.requester=(token,id,version,purpose)->{
                CaptionImageSource.respond("wrong-token","wrong");
                CaptionImageSource.respond(token,id+"|"+version+"|"+purpose);
            };
            assertEquals("a|1|export",CaptionImageSource.read("a","1","export"));
            assertEquals("b|2|preview",CaptionImageSource.read("b","2","preview"));
        }finally{CaptionImageSource.requester=previous;}
    }

    @Test public void analysisCacheWriteFailureDoesNotDiscardSuccessfulResponse() throws Exception {
        var analysis=new JSONObject().put("description","原图分析");
        assertSame(analysis,CaptionModel.keepAnalysisResult(analysis,()->{ throw new java.io.IOException("disk"); }));
        var writes=new java.util.concurrent.atomic.AtomicInteger();
        assertSame(analysis,CaptionModel.keepAnalysisResult(analysis,writes::incrementAndGet));
        assertEquals(1,writes.get());
    }

    @Test public void missingImageGivesImageSpecificFailure() {
        var previous=CaptionImageSource.requester;
        try {
            CaptionImageSource.requester=(token,id,version,purpose)->CaptionImageSource.respond(token,null);
            var failure=assertThrows(java.io.IOException.class,()->CaptionImageSource.read("a","1","analysis"));
            assertTrue(failure.getMessage().contains("历史图"));
        } finally { CaptionImageSource.requester=previous; }
    }

    @Test public void zipUsesOriginalFormatsAndSelectedOrder() throws Exception {
        var previous=CaptionImageSource.requester;
        var output=java.io.File.createTempFile("caption-export-test",".zip");
        try {
            CaptionImageSource.requester=(token,id,version,purpose)->CaptionImageSource.respond(token,id.equals("b")
                ? "data:image/jpeg;base64,/9j/4AAQSkY="
                : "data:image/png;base64,iVBORw0KGgo=");
            var b=batch(0,1,1,List.of(img("b"),img("a")));
            b.units.get(0).edited="<script>不可执行</script>";
            b.units.get(1).edited="第二幅";
            CaptionExport.zip(output,b);
            try(var zip=new java.util.zip.ZipFile(output)) {
                assertNotNull(zip.getEntry("images/001.jpg"));assertNotNull(zip.getEntry("images/002.png"));
                var meta=new JSONObject(new String(zip.getInputStream(zip.getEntry("captions.json")).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
                assertEquals("b",meta.getJSONArray("items").getJSONObject(0).getString("imageId"));
                assertEquals("images/002.png",meta.getJSONArray("items").getJSONObject(1).getString("image"));
                assertFalse(meta.toString().contains("Prompt"));assertTrue(meta.has("aiDisclosure"));
            }
        } finally {CaptionImageSource.requester=previous;output.delete();}
    }
    @Test public void shortLocalTemplatesCanBeExtendedToRequestedLength() {
        for(int i=0;i<CaptionCore.BOUNDS.length;i++){
            String value=CaptionTemplates.fit("留住这一帧。","不必匆忙。",i);
            assertTrue(value.length()>=CaptionCore.BOUNDS[i][0]);assertTrue(value.length()<=CaptionCore.BOUNDS[i][1]);
        }
    }
}
