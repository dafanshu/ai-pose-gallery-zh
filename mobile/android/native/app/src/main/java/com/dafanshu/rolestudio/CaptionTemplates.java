package com.dafanshu.rolestudio;

import org.json.*;
import java.util.*;

final class CaptionTemplates {
    static String style(CaptionCore.Image i,CaptionCore.Config c) {
        if(!c.styles().contains("智能推荐")) return c.styles().get(Math.floorMod(i.id().hashCode(),c.styles().size()));
        String key=i.costume()+i.style()+CaptionCore.positive(i.prompt());
        if(key.matches("(?s).*(旗袍|国风|汉服|古风).*")) return "国风古韵";
        return i.costume().trim().isEmpty()?"氛围感":"穿搭分享";
    }
    static String fit(String s,String second,int length) {
        if(length==0) return s.length()>24?s.substring(0,24)+"。":s;
        if(length==2) {
            String value=s+" "+second+" 画面里的细节不必一一解释，目光停在哪里，哪里便有了自己的分量。不急着替这一张找一个标准答案，慢慢看，也是看图的乐趣。";
            if(value.length()<80)value+=" 看完再回到第一眼，也许会有些不一样。";
            return value;
        }
        String value=s.length()<25?s+second:s;
        return value.length()<25?value+" 听一听画面里的安静，再把余下的一点时间留给自己。":value;
    }
    static JSONObject generate(String text,CaptionCore.Config c,List<CaptionCore.Unit> units,CaptionCore.Unit unit) throws JSONException {
        var templates=new JSONObject(text);
        if(unit!=null) {
            var result=new JSONArray(); var image=unit.image;
            String primary=style(image,c);
            for(int n=0;n<c.count();n++) {
                String style=n<3?primary:CaptionCore.STYLES[(Arrays.asList(CaptionCore.STYLES).indexOf(primary)%8)+1];
                var lines=templates.getJSONArray(style);
                int offset=Math.floorMod(image.id().hashCode()+n,lines.length());
                var body=fit(lines.getString(offset),lines.getString((offset+1)%lines.length()),c.length());
                result.put(new JSONObject().put("type",style).put("title","图 "+(units.indexOf(unit)+1)+" · "+style+" "+(n+1)).put("content",body)
                    .put("tags",new JSONArray(Collections.singletonList(style))));
            }
            return new JSONObject().put("imageId",image.id()).put("captions",result);
        }
        var plans=new JSONArray();
        var titles=Arrays.asList("把目光放慢一点","今天留住的几帧","画面有自己的节奏","在这些画面里停一会儿","从一个细节开始看");
        for(int n=0;n<c.count();n++) {
            var items=new JSONArray();
            for(int i=0;i<units.size();i++) {
                var image=units.get(i).image;
                var lines=templates.getJSONArray(style(image,c));
                int offset=(i+n)%lines.length();
                items.put(new JSONObject().put("imageId",image.id()).put("caption",fit(lines.getString(offset),lines.getString((offset+1)%lines.length()),c.length()))
                    .put("transition",""));
            }
            plans.put(new JSONObject().put("titleCandidates",new JSONArray(Arrays.asList(titles.get(n),"这一组的第 "+(n+1)+" 种读法")))
                .put("introduction","这一组图，不妨顺着画面的次序慢慢看。每一帧都可以从不同的地方开始。")
                .put("summary","把目光停留得久一点，也许会发现第一次没留意的地方。")
                .put("ending","哪一帧让你停留得最久？").put("tags",new JSONArray()).put("items",items));
        }
        return new JSONObject().put("plans",plans);
    }
}
