package com.dafanshu.rolestudio;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.LruCache;
import android.os.Bundle;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import org.json.*;
import okhttp3.Call;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public final class CaptionWorkbenchActivity extends AppCompatActivity {
    private record Launch(List<CaptionCore.Image> images,String selected) {}
    private static Launch pending;
    static void open(Activity activity,List<CaptionCore.Image> catalog,String selected) {
        pending=new Launch(new ArrayList<>(catalog),selected);
        activity.startActivity(new Intent(activity,CaptionWorkbenchActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }
    private final ExecutorService workers=Executors.newFixedThreadPool(2), media=Executors.newSingleThreadExecutor();
    private static final class Running {
        volatile boolean canceled;
        volatile Call call;
        void set(Call next) { call=next; if(canceled) next.cancel(); }
        void stop() { canceled=true; if(call!=null) call.cancel(); }
        void check() throws InterruptedException { if(canceled) throw new InterruptedException(); }
    }
    private final Map<CaptionCore.Unit,Running> running=new HashMap<>();
    private List<CaptionCore.Image> catalog=Collections.emptyList();
    private final List<CaptionCore.Image> selected=new ArrayList<>();
    private List<CaptionCore.Batch> batches;
    private CaptionCore.Batch batch;
    private CaptionCore.Config config;
    private CaptionStorage store;
    private CaptionModel model;
    private LinearLayout root, body;
    private ScrollView scroll;
    private String screen="setup";
    private TextView progress;
    private LinearLayout controls,results;
    private boolean foreground, dispatch, disposed, selecting, exporting;
    private int page, filter;
    private final LruCache<String,Bitmap> thumbnails=new LruCache<>(8*1024*1024) {
        @Override protected int sizeOf(String key,Bitmap value){return value.getByteCount();}
    };
    private String storageError;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        store=new CaptionStorage(this); model=new CaptionModel(getApplicationContext(),store);
        try {
            config=store.config(); batches=store.list();
            for(var b:batches) {
                boolean changed=false;
                for(var u:b.work()) changed|=u.recover();
                if(changed) store.save(b);
            }
        } catch(Exception e) { storageError="无法读取批次存储，请先保留应用数据。"; }
        consumeLaunch();
        if(state!=null && batches!=null) {
            var saved=state.getString("batch");
            batch=batches.stream().filter(b->b.id.equals(saved)).findFirst().orElse(null);
            if(batch!=null) screen="batch";
        }
        draw();
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); consumeLaunch(); draw(); }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if(batch!=null) state.putString("batch",batch.id);
    }
    private void consumeLaunch() {
        Launch launch=pending; pending=null;
        if(launch==null) return;
        catalog=launch.images;
        if(launch.selected!=null) catalog.stream().filter(i->i.id().equals(launch.selected)).findFirst().ifPresent(i->{
            selected.clear(); selected.add(i); if(running.isEmpty()){screen="setup"; dispatch=false;}
        });
    }
    @Override protected void onStart() { super.onStart(); foreground=true; }
    @Override protected void onStop() { foreground=false; dispatch=false; update(); super.onStop(); }
    @Override protected void onDestroy() {
        disposed=true;
        for(var entry:running.entrySet()) { entry.getValue().stop(); entry.getKey().recover(); }
        if(batch!=null&&!running.isEmpty()) persist(batch);
        workers.shutdownNow(); media.shutdownNow(); super.onDestroy();
    }

    private int dp(int n) { return Math.round(n*getResources().getDisplayMetrics().density); }
    private LinearLayout column() { var v=new LinearLayout(this); v.setOrientation(LinearLayout.VERTICAL); return v; }
    private LinearLayout row() { return new LinearLayout(this); }
    private TextView text(LinearLayout target,String value,int size) {
        var v=new TextView(this); v.setText(value); v.setTextSize(size); v.setPadding(0,dp(6),0,dp(6)); target.addView(v); return v;
    }
    private Button button(LinearLayout target,String value,Runnable action) {
        var b=new Button(this); b.setText(value); b.setAllCaps(false); b.setMinHeight(dp(48)); b.setOnClickListener(v->action.run());
        if(target.getOrientation()==LinearLayout.HORIZONTAL) target.addView(b,new LinearLayout.LayoutParams(0,-2,1)); else target.addView(b);
        return b;
    }
    private EditText edit(LinearLayout target,String label,String value,int maxLines) {
        text(target,label,14); var field=new EditText(this); field.setText(value); field.setContentDescription(label);
        field.setInputType(InputType.TYPE_CLASS_TEXT | (maxLines>1?InputType.TYPE_TEXT_FLAG_MULTI_LINE:0)); field.setMaxLines(maxLines); target.addView(field); return field;
    }
    private Spinner picker(LinearLayout target,String label,String[] values,int initial) {
        text(target,label,14); var v=new Spinner(this); v.setContentDescription(label);
        var adapter=new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); v.setAdapter(adapter);
        v.setSelection(initial); target.addView(v,new LinearLayout.LayoutParams(-1,dp(48))); return v;
    }
    private CheckBox check(LinearLayout target,String name,boolean checked) {
        var v=new CheckBox(this); v.setText(name); v.setChecked(checked); target.addView(v); return v;
    }
    private void toast(String s) { if(!disposed) Toast.makeText(this,s,Toast.LENGTH_LONG).show(); }
    private void draw() {
        root=column();
        var background=new android.util.TypedValue();
        if(getTheme().resolveAttribute(android.R.attr.colorBackground,background,true)) root.setBackgroundColor(background.data);
        root.setPadding(dp(14),dp(8),dp(14),dp(8));
        ViewCompat.setOnApplyWindowInsetsListener(root,(v,insets)->{
            var edges=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout()|WindowInsetsCompat.Type.ime());
            v.setPadding(dp(14)+edges.left,dp(8)+edges.top,dp(14)+edges.right,dp(8)+edges.bottom); return insets;
        });
        var top=row(); root.addView(top);
        button(top,"返回合成台",this::finish);
        button(top,"新建批次",()->{ if(switchable()) {screen="setup"; draw();} });
        button(top,"历史批次",()->{ if(switchable()) {screen="history"; draw();} });
        scroll=new ScrollView(this); scroll.setFillViewport(true); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        body=column(); scroll.addView(body); setContentView(root); ViewCompat.requestApplyInsets(root);
        text(body,"批量配文",24);
        progress=null;
        if(storageError!=null) { text(body,storageError,16); return; }
        switch(screen) { case "history" -> history(); case "batch" -> batchView(); default -> setup(); }
    }
    private boolean switchable() {
        if(!running.isEmpty() || exporting) { toast("请先暂停并等待在途请求结束"); return false; }
        dispatch=false; return true;
    }
    private void setup() {
        var summary=text(body,selectionLabel(),16);
        button(body,"从生成记录选择／排序",()->chooseImages(summary));
        if(!selected.isEmpty()) button(body,"预览已选图片",()->previewImage(selected.get(0)));
        var c=config;
        var mode=picker(body,"配文模式",CaptionCore.MODES,c.mode());
        var platform=picker(body,"发布平台",CaptionCore.PLATFORMS,c.platform());
        var source=picker(body,"生成依据",CaptionCore.SOURCES,c.source());
        text(body,"视觉模式发送压缩图与提示词到 OpenAI；Prompt 模式只发送文字，不代表看过图；模板不联网。",13);
        var styles=new LinkedHashSet<>(c.styles());
        var styleButton=button(body,"风格："+String.join("、",styles),()->{});
        styleButton.setOnClickListener(v->{
            boolean[] checked=new boolean[CaptionCore.STYLES.length];
            for(int i=0;i<checked.length;i++) checked[i]=styles.contains(CaptionCore.STYLES[i]);
            new AlertDialog.Builder(this).setTitle("选择文案风格")
                .setMultiChoiceItems(CaptionCore.STYLES,checked,(dialog,i,state)->checked[i]=state)
                .setNegativeButton("取消",null).setPositiveButton("确定",(dialog,n)->{
                    styles.clear(); for(int i=0;i<checked.length;i++) if(checked[i]) styles.add(CaptionCore.STYLES[i]);
                    if(styles.isEmpty()) styles.add("智能推荐");
                    styleButton.setText("风格："+String.join("、",styles));
                }).show();
        });
        var advanced=column(); advanced.setVisibility(View.GONE);
        var toggle=button(body,"展开高级设置",()->{});
        toggle.setOnClickListener(v->{boolean open=advanced.getVisibility()!=View.VISIBLE; advanced.setVisibility(open?View.VISIBLE:View.GONE);toggle.setText(open?"收起高级设置":"展开高级设置");});
        body.addView(advanced);
        var length=picker(advanced,"文案长度",CaptionCore.LENGTHS,c.length());
        var count=picker(advanced,"每图候选数／整组方案数",new String[]{"1","2","3","4","5"},c.count()-1);
        var concurrency=picker(advanced,"最大并发",new String[]{"1","2"},c.workers()-1);
        var textModel=edit(advanced,"OpenAI 文本模型 ID",c.textModel(),1);
        var visionModel=edit(advanced,"OpenAI 视觉模型 ID（独立于生图）",c.visionModel(),1);
        var goal=edit(advanced,"运营目标",c.goal(),2);
        var extra=edit(advanced,"自定义创作要求",c.extra(),3);
        var system=edit(advanced,"补充系统提示词",c.system(),4);
        var tags=check(advanced,"添加话题标签",c.tags());
        var disclosure=check(advanced,"添加 AI 生成声明",c.disclosure());
        var dedup=check(advanced,"启用历史文案去重",c.dedup());
        button(body,"预览任务并开始",()->{
            if(selected.isEmpty()) {toast("请先从生成记录选择图片");return;}
            try {
                var configured=new CaptionCore.Config(mode.getSelectedItemPosition(),source.getSelectedItemPosition(),platform.getSelectedItemPosition(),
                    length.getSelectedItemPosition(),count.getSelectedItemPosition()+1,concurrency.getSelectedItemPosition()+1,new ArrayList<>(styles),
                    value(textModel,128),value(visionModel,128),value(goal,400),tags.isChecked(),disclosure.isChecked(),dedup.isChecked(),value(extra,2000),value(system,2600));
                String basis= switch(configured.source()){
                    case 0 -> "首次分析的压缩图片及相关文字将提交到 OpenAI（api.openai.com），可能计费。已有分析优先复用。";
                    case 1 -> "仅将生图 Prompt 和元数据提交到 OpenAI（api.openai.com），不上传图片，可能计费。";
                    default -> "使用本地模板，不联网、不计 API 用量。";
                };
                String outputs=configured.mode()==0?(selected.size()*configured.count())+" 条独立文案":configured.count()+" 组方案";
                new AlertDialog.Builder(this).setTitle("确认处理 "+selected.size()+" 张图").setMessage("预计生成 "+outputs+"。\n"+basis)
                    .setNegativeButton("取消",null).setPositiveButton("开始",(d,w)->create(configured)).show();
            } catch(IllegalArgumentException e) {toast("请检查文案模型和参数");}
        });
    }
    private static String value(EditText v,int cap){return CaptionCore.limit(v.getText().toString().trim(),cap);}
    private String selectionLabel(){return "已选 "+selected.size()+" 张，顺序以选择列表为准";}
    private void chooseImages(TextView summary) {
        if(selecting) return;
        selecting=true;
        var layout=column(); var buttons=row(); layout.addView(buttons);
        var items=column(); var scroller=new ScrollView(this); scroller.addView(items);
        layout.addView(scroller,new LinearLayout.LayoutParams(-1,dp(400)));
        Runnable[] render=new Runnable[1];
        render[0]=()->{
            int position=scroller.getScrollY();
            items.removeAllViews();
            scroller.post(()->scroller.scrollTo(0,position));
            text(items,selectionLabel(),15);
            for(int i=0;i<selected.size();i++) {
                final int n=i; var img=selected.get(i);
                var row=row(); items.addView(row);
                text(items,(i+1)+". "+label(img),14);
                button(row,"预览",()->previewImage(img));
                button(row,"上移",()->{if(n>0){Collections.swap(selected,n,n-1);render[0].run();}}).setEnabled(n>0);
                button(row,"下移",()->{if(n+1<selected.size()){Collections.swap(selected,n,n+1);render[0].run();}}).setEnabled(n+1<selected.size());
                button(row,"移除",()->{selected.remove(n);render[0].run();});
            }
            text(items,catalog.isEmpty()?"没有可用的本地历史图片；请返回合成台生成后重开。":"生成记录（仅本机已有图）",14);
            for(var img:catalog) {
                var check=check(items,label(img),selected.contains(img));
                check.setOnCheckedChangeListener((b,value)->{ if(value) selected.add(img); else selected.remove(img); render[0].run(); });
            }
            summary.setText(selectionLabel());
        };
        button(buttons,"全选",()->{for(var i:catalog) if(!selected.contains(i)) selected.add(i);render[0].run();});
        button(buttons,"取消全选",()->{selected.clear();render[0].run();});
        render[0].run();
        var dialog=new AlertDialog.Builder(this).setTitle("选图和顺序").setView(layout).setPositiveButton("完成",null).create();
        dialog.setOnDismissListener(x->{selecting=false;summary.setText(selectionLabel());}); dialog.show();
    }
    private static String label(CaptionCore.Image i){return i.label().trim().isEmpty()?"历史图片":i.label();}
    private void previewImage(CaptionCore.Image image) {
        var v=new ImageView(this); v.setAdjustViewBounds(true); v.setMinimumHeight(dp(180));
        var dialog=new AlertDialog.Builder(this).setTitle(label(image)).setView(v).setPositiveButton("关闭",null).show();
        thumb(image,v,"analysis",()->dialog.isShowing());
    }
    private void thumb(CaptionCore.Image image,ImageView target,String purpose,java.util.function.BooleanSupplier valid) {
        String key=image.id()+"|"+image.version();
        Bitmap cached=purpose.equals("preview")?thumbnails.get(key):null;
        if(cached!=null){target.setImageBitmap(cached);return;}
        media.execute(()->{
            try {
                String data=CaptionImageSource.read(image.id(),image.version(),purpose);
                byte[] bytes=Base64.getDecoder().decode(data.substring(data.indexOf(',')+1));
                var bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length);
                runOnUiThread(()->{
                    if(disposed){if(bitmap!=null)bitmap.recycle();return;}
                    if(bitmap!=null&&purpose.equals("preview")) thumbnails.put(key,bitmap);
                    if(valid.getAsBoolean()) target.setImageBitmap(bitmap);
                    else if(bitmap!=null&&!purpose.equals("preview")) bitmap.recycle();
                });
            }catch(Exception e){runOnUiThread(()->{if(!disposed&&valid.getAsBoolean())target.setContentDescription("原图暂不可用");});}
        });
    }
    private void history() {
        if(batches.isEmpty()) text(body,"还没有历史批次",16);
        for(var b:batches) button(body,new java.text.SimpleDateFormat("MM-dd HH:mm",Locale.CHINA).format(new Date(b.created))+"  ·  "+
            CaptionCore.MODES[b.config.mode()]+"  ·  "+b.units.size()+" 张",()->{batch=b; page=0;filter=0;screen="batch";draw();});
    }
    private boolean persist(CaptionCore.Batch b) {
        try {store.save(b);return true;}
        catch(Exception e){dispatch=false;toast("批次未写入磁盘，已暂停派发。请检查可用空间。");return false;}
    }
    private void create(CaptionCore.Config c) {
        if(!foreground||!switchable()) return;
        if(c.source()==1&&selected.stream().anyMatch(i->CaptionCore.positive(i.prompt()).trim().isEmpty()&&i.costume().trim().isEmpty()&&i.pose().trim().isEmpty()&&i.style().trim().isEmpty())) {
            toast("部分图片没有可用 Prompt 或元数据，请选择视觉／模板模式");return;
        }
        var newBatch=new CaptionCore.Batch(UUID.randomUUID().toString(),System.currentTimeMillis(),c,new ArrayList<>(selected));
        try {store.save(c);store.save(newBatch);}
        catch(Exception e){toast("无法保存批次，未发起任何请求");return;}
        config=c; batch=newBatch;batches.add(0,batch); page=0;filter=0;screen="batch";dispatch=true;draw();pump();
    }
    private void pump() {
        if(batch==null||!foreground||!dispatch||disposed) return;
        var b=batch;
        while(running.size()<b.config.workers()) {
            var u=b.work().stream().filter(b::canStart).findFirst().orElse(null);
            if(u==null) break;
            u.state=b.config.source()==0&&u.image!=null?CaptionCore.State.ANALYZING:CaptionCore.State.WRITING;
            if(!persist(b)){u.reset();break;}
            var job=new Running(); running.put(u,job);
            var avoid=avoid(b,u);
            workers.execute(()->process(b,u,job,avoid));
        }
        if(running.isEmpty()&&b.work().stream().noneMatch(b::canStart)) dispatch=false;
        update();
    }
    private List<String> avoid(CaptionCore.Batch b,CaptionCore.Unit target) {
        if(!b.config.dedup()||b.config.source()==2) return Collections.emptyList();
        var out=new LinkedHashSet<String>();
        for(var prior:batches) {
            if(prior!=b && (prior.created < System.currentTimeMillis()-30L*86400000 || prior.config.mode()!=b.config.mode())) continue;
            for(var u:prior.work()) {
                if(u==target || (prior!=b&&!u.used)) continue;
                var values=u.latest().optJSONArray(u.image==null?"plans":"captions");
                if(!u.edited.trim().isEmpty())out.add(u.edited);
                if(!u.editedTitle.trim().isEmpty())out.add(u.editedTitle);
                if(values!=null)for(int i=0;i<values.length();i++){
                    var c=values.optJSONObject(i);
                    if(c!=null&&u.image!=null) {out.add(c.optString("content"));out.add(c.optString("title"));}
                    if(c!=null&&u.image==null) {var titles=c.optJSONArray("titleCandidates"); if(titles!=null)for(int j=0;j<titles.length();j++)out.add(titles.optString(j));}
                }
                if(out.size()>=120) return out.stream().filter(s->!s.trim().isEmpty()).limit(120).collect(java.util.stream.Collectors.toList());
            }
        }
        return out.stream().filter(s->!s.trim().isEmpty()).limit(120).collect(java.util.stream.Collectors.toList());
    }
    private enum AnalysisTransition { READY, PAUSED, STORAGE_ERROR }
    private void process(CaptionCore.Batch b,CaptionCore.Unit u,Running job,List<String> avoid) {
        try {
            final var c=u.requestedCount==1?b.config.withCount(1):b.config;
            job.check();
            JSONObject analysis=c.source()==0&&u.image!=null?model.analyze(u.image,c,u.forceAnalyze,job::set):null;
            job.check();
            if(c.mode()!=0&&u.image!=null) { finishWork(b,u,job,analysis,null,false);return; }
            if(analysis!=null) {
                var saved=new CompletableFuture<AnalysisTransition>();
                runOnUiThread(()->{
                    if(disposed||job.canceled){saved.complete(AnalysisTransition.PAUSED);return;}
                    if(!foreground||!dispatch){
                        running.remove(u);u.reset();u.forceAnalyze=false;persist(b);update(true);
                        saved.complete(AnalysisTransition.PAUSED);return;
                    }
                    u.state=CaptionCore.State.WRITING; u.forceAnalyze=false;
                    boolean ok=persist(b);update();
                    saved.complete(ok?AnalysisTransition.READY:AnalysisTransition.STORAGE_ERROR);
                });
                var transition=saved.get();
                job.check();
                if(transition==AnalysisTransition.PAUSED) return;
                if(transition==AnalysisTransition.STORAGE_ERROR)
                    throw new CaptionModel.Failure("图片已分析，但批次进度未能保存。未发起文案生成，请检查可用空间。",false);
            }
            JSONObject result=null;
            for(int attempt=0;attempt<2;attempt++){
                job.check();
                var raw=model.write(c,b.units,u.image==null?null:u,analysis,avoid,job::set);
                result=u.image==null?CaptionCore.group(raw,b.units,c):CaptionCore.captions(raw,u.image,c);
                if(!duplicate(result,avoid))break;
                if(attempt==1) throw new CaptionModel.Failure("仍与近期文案重复，请调整风格后重试。",false);
            }
            finishWork(b,u,job,result,null,false);
        } catch(CaptionModel.Failure e){finishWork(b,u,job,null,e.getMessage(),e.unknown);}
        catch(JSONException e){finishWork(b,u,job,null,"模型返回格式、图片编号、长度或数量不符合要求；可重试。",false);}
        catch(IOException e){finishWork(b,u,job,null,"无法读取文案工作台的本地资源，请尝试重开工作台。",false);}
        catch(Exception e){finishWork(b,u,job,null,"任务未能完成。请检查设置或重新打开工作台。",job.call!=null);}
    }
    private static boolean duplicate(JSONObject result,List<String> avoid) {
        var captions=result.optJSONArray("captions"); var plans=result.optJSONArray("plans");
        if(captions!=null) for(int i=0;i<captions.length();i++) {
            var row=captions.optJSONObject(i);
            if(avoid.stream().anyMatch(x->CaptionCore.similar(x,row.optString("content"))||CaptionCore.normal(x).equals(CaptionCore.normal(row.optString("title")))))return true;
        }
        if(plans!=null) for(int i=0;i<plans.length();i++){
            var titles=plans.optJSONObject(i).optJSONArray("titleCandidates");
            for(int j=0;j<titles.length();j++){String title=CaptionCore.normal(titles.optString(j));if(avoid.stream().anyMatch(x->title.equals(CaptionCore.normal(x))))return true;}
        }
        return false;
    }
    private void finishWork(CaptionCore.Batch b,CaptionCore.Unit u,Running job,JSONObject result,String error,boolean unknown) {
        runOnUiThread(()->{
            if(disposed||running.get(u)!=job)return;
            running.remove(u);
            if(b.canceled||job.canceled) {u.state=CaptionCore.State.CANCELED;u.error="已取消；已发送请求可能计费。";}
            else if(result!=null && !duplicate(result,avoid(b,u))) {u.append(result);u.forceAnalyze=false;u.requestedCount=0;}
            else { u.state=unknown?CaptionCore.State.UNKNOWN:CaptionCore.State.FAILED;u.error=error==null?"与同批另一项重复，请重试本项。":error; }
            persist(b); pump(); update(true);
        });
    }
    private void batchView() {
        text(body,CaptionCore.MODES[batch.config.mode()]+" · "+CaptionCore.PLATFORMS[batch.config.platform()]+" · "+CaptionCore.SOURCES[batch.config.source()],16);
        progress=text(body,"",14);
        controls=column();body.addView(controls);
        results=column();body.addView(results);
        update(true);
    }
    private static String state(CaptionCore.State s){return switch(s){
        case WAITING -> "等待中";case ANALYZING -> "分析图片中";case WRITING -> "生成文案中";case DONE -> "已完成";
        case FAILED -> "失败";case UNKNOWN -> "状态待确认";case CANCELED -> "已取消";
    };}
    private void update(){update(false);}
    private void update(boolean repaint) {
        if(disposed||batch==null||progress==null||!screen.equals("batch"))return;
        var b=batch;
        var counts=new EnumMap<CaptionCore.State,Integer>(CaptionCore.State.class);
        for(var u:b.work()) counts.merge(u.state,1,Integer::sum);
        int good=counts.getOrDefault(CaptionCore.State.DONE,0), bad=counts.getOrDefault(CaptionCore.State.FAILED,0)+counts.getOrDefault(CaptionCore.State.UNKNOWN,0);
        int wait=counts.getOrDefault(CaptionCore.State.WAITING,0);
        String overall=b.canceled?"已取消":!running.isEmpty()?"运行中":good==b.work().size()?"已完成":
            bad>0?(good>0?"部分失败":"失败"):!dispatch?"已暂停":"等待中";
        progress.setText(overall+"  ·  "+b.units.size()+" 张图\n已完成 "+good+" / "+b.work().size()+"  ·  等待 "+wait+"  ·  失败／待确认 "+bad+"  ·  进行中 "+running.size());
        controls.removeAllViews();
        var buttons=row();controls.addView(buttons);
        button(buttons,dispatch?"暂停":"继续",()->{ dispatch=!dispatch; if(dispatch)pump();else update(); }).setEnabled(!b.canceled&&wait>0);
        button(buttons,"取消",()->new AlertDialog.Builder(this).setMessage("不再派发，已完成文案保留。已发送请求可能计费。")
            .setNegativeButton("返回",null).setPositiveButton("取消任务",(d,w)->{
                dispatch=false;b.canceled=true;
                for(var u:b.work())if(u.state==CaptionCore.State.WAITING)u.state=CaptionCore.State.CANCELED;
                for(var j:running.values())j.stop(); persist(b);update(true);
            }).show()).setEnabled(!b.canceled&&(wait>0||!running.isEmpty()));
        button(buttons,"重试失败项",()->retry(b.work().stream().filter(u->u.state==CaptionCore.State.FAILED||u.state==CaptionCore.State.UNKNOWN).collect(java.util.stream.Collectors.toList()),false)).setEnabled(bad>0&&running.isEmpty());
        var more=row(); controls.addView(more);
        button(controls,"用此批图片新建",()->{
            if(!switchable())return;
            selected.clear();
            for(var u:b.units)catalog.stream().filter(i->i.id().equals(u.image.id())&&i.version().equals(u.image.version())).findFirst().ifPresent(selected::add);
            config=b.config;screen="setup";draw();
        });
        button(more,"全部重新生成",()->retry(b.work(),false)).setEnabled(running.isEmpty());
        button(more,"导出／分享",this::exportMenu).setEnabled(!exporting && (b.config.mode()==0?b.units.stream().anyMatch(u->!u.versions.isEmpty()):!b.group.versions.isEmpty()));
        button(controls,"筛选："+new String[]{"全部","失败／待确认","未使用","已收藏"}[filter],()->new AlertDialog.Builder(this)
            .setItems(new String[]{"全部","失败／待确认","未使用","已收藏"},(d,w)->{filter=w;page=0;update(true);}).show());
        if(repaint) drawResults();
    }
    private void retry(List<CaptionCore.Unit> units,boolean force) { retry(units,force,false); }
    private void retry(List<CaptionCore.Unit> units,boolean force,boolean singleCandidate) {
        if(units.isEmpty()||!running.isEmpty())return;
        var b=batch;
        String notice=b.config.source()==2?"保留已编辑和历史候选。":"可能再次计费；请先核对待确认项用量。已编辑及历史候选保留。";
        new AlertDialog.Builder(this).setTitle(force?"重新分析图片":"确认重新生成").setMessage(notice)
            .setNegativeButton("取消",null).setPositiveButton("继续",(d,w)->{
                if(!foreground||b!=batch||!running.isEmpty())return;
                b.canceled=false;
                for(var u:units) {u.reset();u.forceAnalyze=force;if(singleCandidate) u.requestedCount=1;else if(!force) u.requestedCount=0;}
                if(b.config.mode()!=0&&!units.contains(b.group))b.group.reset();
                if(persist(b)){dispatch=true;pump(); update(true);}
            }).show();
    }
    private boolean matches(CaptionCore.Unit u){return switch(filter){
        case 1 -> u.state==CaptionCore.State.FAILED||u.state==CaptionCore.State.UNKNOWN;case 2 -> !u.used;case 3 -> u.favorite;default -> true;
    };}
    private void drawResults() {
        int pos=scroll.getScrollY();
        results.removeAllViews();
        if(batch.config.mode()!=0 && matches(batch.group)) result(batch.group);
        var visible=batch.units.stream().filter(this::matches).collect(java.util.stream.Collectors.toList());
        int pages=Math.max(1,(visible.size()+3)/4);page=Math.min(page,pages-1);
        for(int i=page*4;i<Math.min((page+1)*4,visible.size());i++)result(visible.get(i));
        if(pages>1){
            var buttons=row(); results.addView(buttons);
            button(buttons,"上一页",()->{page--;drawResults();}).setEnabled(page>0);
            text(buttons,(page+1)+"/"+pages,14);
            button(buttons,"下一页",()->{page++;drawResults();}).setEnabled(page+1<pages);
        }
        scroll.post(()->scroll.scrollTo(0,pos));
    }
    private void result(CaptionCore.Unit u) {
        var b=batch;
        String heading=u.image==null?"整组方案":String.format(Locale.CHINA,"%02d · %s",b.units.indexOf(u)+1,label(u.image));
        text(results,heading+"  /  "+state(u.state),16);
        if(!u.error.trim().isEmpty()) text(results,u.error,13);
        if(u.image!=null) {
            var iv=new ImageView(this);iv.setAdjustViewBounds(true);iv.setScaleType(ImageView.ScaleType.FIT_CENTER);iv.setContentDescription("预览 "+heading);
            results.addView(iv,new LinearLayout.LayoutParams(-1,dp(100)));
            iv.setOnClickListener(x->previewImage(u.image));thumb(u.image,iv,"preview",iv::isAttachedToWindow);
        }
        if(u.image==null || b.config.mode()==0) {
            if(!u.versions.isEmpty()){
                var chosen=u.image==null?CaptionExport.selectedPlan(u):CaptionExport.selectedCaption(u);
                if(chosen!=null) text(results,u.edited.trim().isEmpty()?chosen.optString(u.image==null?"introduction":"content"):u.edited,15);
                var r=row();results.addView(r);
                button(r,"候选／编辑",()->candidateMenu(u));
                button(r,"复制",()->copy(u.image==null?CaptionExport.plain(CaptionExport.draft(b)):CaptionExport.join(
                    CaptionExport.draft(b).captions().get(b.units.indexOf(u)),b.config.disclosure()?CaptionCore.DISCLOSURE:"")));
                if(u.image!=null)button(r,"全部候选",()->copy(allCaptions(u)));
            }
            button(results,"重新生成本项",()->retry(Collections.singletonList(u),false)).setEnabled(running.isEmpty());
        } else if(b.config.mode()==2&&CaptionExport.selectedPlan(b.group)!=null){
            var display=CaptionExport.draft(b).captions().get(b.units.indexOf(u));text(results,display,15);
            button(results,"编辑图片配文",()->editArticleImage(u,display));
        }
        if(!u.versions.isEmpty()&&(u.image==null||b.config.mode()==0)) {
            button(results,u.image==null?"删除本组文案":"删除此图文案",()->new AlertDialog.Builder(this)
                .setMessage("只删除这项配文和编辑记录，不删除原图。")
                .setNegativeButton("取消",null).setPositiveButton("删除",(d,w)->{
                    u.versions.clear();u.selection="";u.edited="";u.editedTitle="";u.ending="";u.summary="";
                    u.favorite=false;u.used=false;u.state=CaptionCore.State.CANCELED;u.error="文案已删除";
                    persist(b);update(true);
                }).show()).setEnabled(running.isEmpty());
        }
        if(u.image!=null&&b.config.source()==0)button(results,"重新分析本图",()->retry(Collections.singletonList(u),true)).setEnabled(running.isEmpty());
        if(!u.versions.isEmpty()||(u.image!=null&&b.config.mode()==2&&CaptionExport.selectedPlan(b.group)!=null)){
            var flags=row();results.addView(flags);
            button(flags,u.favorite?"取消收藏":"收藏",()->{u.favorite=!u.favorite;persist(b);update(true);});
            button(flags,u.used?"改为未使用":"标记已使用",()->{u.used=!u.used;persist(b);update(true);});
        }
    }
    private String allCaptions(CaptionCore.Unit u) {
        var out=new StringJoiner("\n\n");
        for(var version:u.versions) {
            var arr=version.optJSONArray("captions");
            if(arr!=null)for(int i=0;i<arr.length();i++){
                var row=arr.optJSONObject(i);out.add(CaptionExport.join(row.optString("title"),row.optString("content"),CaptionExport.tagText(row)));
            }
        }
        if(batch.config.disclosure())out.add(CaptionCore.DISCLOSURE);return out.toString();
    }
    private void candidateMenu(CaptionCore.Unit u) {
        var labels=new ArrayList<String>();var selections=new ArrayList<String>();var choices=new ArrayList<JSONObject>();
        for(int k=u.versions.size()-1;k>=0;k--){
            var arr=u.versions.get(k).optJSONArray(u.image==null?"plans":"captions");if(arr==null)continue;
            for(int i=0;i<arr.length();i++){
                var item=arr.optJSONObject(i);String title=u.image==null?item.optJSONArray("titleCandidates").optString(0):item.optString("title");
                labels.add("第 "+(k+1)+" 版 · "+title);selections.add(k+":"+i);choices.add(item);
            }
        }
        new AlertDialog.Builder(this).setTitle("候选文案（选择后可编辑）").setItems(labels.toArray(new String[0]),(d,i)->editor(u,selections.get(i),choices.get(i))).show();
    }
    private void editor(CaptionCore.Unit u,String choice,JSONObject row) {
        var wrap=column();var scroller=new ScrollView(this);scroller.addView(wrap);
        boolean existing=u.selection.equals(choice);
        String initialTitle=u.image==null?row.optJSONArray("titleCandidates").optString(0):row.optString("title");
        var title=edit(wrap,"最终标题",existing&&!u.editedTitle.trim().isEmpty()?u.editedTitle:initialTitle,2);
        if(u.image==null&&row.optJSONArray("titleCandidates").length()>1)button(wrap,"选其他候选标题",()->{
            var titles=row.optJSONArray("titleCandidates");var names=new String[titles.length()];for(int i=0;i<names.length;i++)names[i]=titles.optString(i);
            new AlertDialog.Builder(this).setItems(names,(d,n)->title.setText(names[n])).show();
        });
        var main=edit(wrap,u.image==null?"正文／开场":"配文",existing&&!u.edited.trim().isEmpty()?u.edited:row.optString(u.image==null?"introduction":"content"),7);
        var summary=u.image==null&&batch.config.mode()==2?edit(wrap,"总结",existing&&!u.summary.trim().isEmpty()?u.summary:row.optString("summary"),4):null;
        var ending=u.image==null?edit(wrap,"互动结尾",existing&&!u.ending.trim().isEmpty()?u.ending:row.optString("ending"),4):null;
        var dialog=new AlertDialog.Builder(this).setTitle("编辑并选用").setView(scroller).setNegativeButton("取消",null)
            .setPositiveButton("保存",(d,w)->{
                u.selection=choice;u.editedTitle=value(title,160);u.edited=value(main,5000);
                if(summary!=null)u.summary=value(summary,3000);if(ending!=null)u.ending=value(ending,2000);
                // Appending results never modifies edits; explicitly changing candidate is an edit.
                persist(batch);update(true);
            }).create();
        if(u.image!=null&&running.isEmpty()) {
            dialog.setButton(AlertDialog.BUTTON_NEUTRAL,"另生成一条",(d,w)->retry(Collections.singletonList(u),false,true));
        }
        dialog.show();
    }
    private void editArticleImage(CaptionCore.Unit u,String current){
        var wrap=column();var field=edit(wrap,"图片配文",current,5);
        new AlertDialog.Builder(this).setView(wrap).setNegativeButton("取消",null).setPositiveButton("保存",(d,w)->{
            u.edited=value(field,4000);persist(batch);update(true);
        }).show();
    }
    private void copy(String value){
        var manager=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        manager.setPrimaryClip(ClipData.newPlainText("批量配文",value));toast("已复制");
    }
    private void exportMenu(){
        new AlertDialog.Builder(this).setTitle("导出与分享").setItems(new String[]{"复制选中文案","图文混排预览","分享文案","分享 TXT","分享 Markdown","分享图文 ZIP","分享首张原图"},
            (d,n)->{switch(n){case 0->copy(CaptionExport.plain(CaptionExport.draft(batch)));case 1->articlePreview();case 2->{
                var intent=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,CaptionExport.plain(CaptionExport.draft(batch)));
                startActivity(Intent.createChooser(intent,"分享文案"));
            }default->exportFile(n);}}).show();
    }
    private void articlePreview(){
        var draft=CaptionExport.draft(batch);var scroller=new ScrollView(this);var layout=column();scroller.addView(layout);
        text(layout,draft.title(),20);text(layout,draft.intro(),15);
        var images=new ArrayList<ImageView>();
        for(int i=0;i<batch.units.size();i++){
            var view=new ImageView(this);view.setScaleType(ImageView.ScaleType.FIT_CENTER);view.setContentDescription("图 "+(i+1));
            layout.addView(view,new LinearLayout.LayoutParams(-1,dp(145)));images.add(view);
            text(layout,i<draft.captions().size()?CaptionExport.join(draft.captions().get(i),draft.transitions().get(i)):"",15);
        }
        text(layout,CaptionExport.join(draft.summary(),draft.ending(),draft.tags(),draft.disclosure()),15);
        var dialog=new AlertDialog.Builder(this).setTitle("图文预览").setView(scroller).setPositiveButton("关闭",null).show();
        var loaded=new HashSet<Integer>();var snapshots=new ArrayList<>(batch.units);
        Runnable warm=()->{
            for(int i=0;i<images.size();i++){
                var iv=images.get(i);
                if(iv.getBottom()>=scroller.getScrollY()-dp(100)&&iv.getTop()<scroller.getScrollY()+scroller.getHeight()+dp(100)&&loaded.add(i))
                    thumb(snapshots.get(i).image,iv,"preview",()->dialog.isShowing());
            }
        };
        scroller.setOnScrollChangeListener((v,x,y,oldX,oldY)->warm.run());scroller.post(warm);
    }
    private void exportFile(int n){
        if(exporting)return;
        final CaptionCore.Batch snapshot;
        try {snapshot=CaptionCore.Batch.from(batch.json());}
        catch(Exception e){toast("不能读取待导出的记录");return;}
        exporting=true;update();toast("正在准备分享文件");
        workers.execute(()->{
            File out=null;
            try {
                var dir=new File(getCacheDir(),"caption-exports");
                if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException();
                var oldFiles=dir.listFiles();if(oldFiles!=null)for(var old:oldFiles)if(old.lastModified()<System.currentTimeMillis()-86400000)old.delete();
                String ext=n==3?".txt":n==4?".md":".zip";var draft=CaptionExport.draft(snapshot);
                String mime=n==5?"application/zip":"text/plain";
                if(n==6){
                    var image=CaptionExport.media(snapshot.units.get(0).image,0);
                    ext=image.path().endsWith(".png")?".png":".jpg";mime=ext.equals(".png")?"image/png":"image/jpeg";
                    out=File.createTempFile("publish-image-",ext,dir);
                    try(var stream=new FileOutputStream(out)){stream.write(image.bytes());}
                }else{
                    out=File.createTempFile("publish-package-",ext,dir);
                    if(n==5)CaptionExport.zip(out,snapshot);
                    else try(var stream=new FileOutputStream(out)){
                        stream.write((n==3?CaptionExport.plain(draft):CaptionExport.markdown(draft,Collections.emptyList())).getBytes(StandardCharsets.UTF_8));
                    }
                }
                var uri=FileProvider.getUriForFile(this,getPackageName()+".caption-share",out);
                var intent=new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri);
                intent.setClipData(ClipData.newRawUri("配文资源",uri));intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(()->{exporting=false;update();if(!disposed&&foreground)startActivity(Intent.createChooser(intent,"分享或保存配文文件"));});
            }catch(Exception e){if(out!=null)out.delete();runOnUiThread(()->{exporting=false;update();toast("导出失败。请确认本地原图仍在生成记录，且存储空间足够。");});}
        });
    }
}
