import test from 'node:test'
import assert from 'node:assert/strict'
import { BODY_FIELDS, BODY_OPTIONS, BODY_VOLUME_LEVELS, BUILTIN_BODY_PRESETS, buildBodyPrompt, bodyDescriptionConflicts, bodyVolumeLevel, defaultBodyProfile, normalizeBodyProfile, normalizeBodyPresets, selectLocalBodySource } from '../src/lib/bodyProfile.ts'
import { buildAndroidStudioPrompt, buildRecipePrompt } from '../src/services/aiGenerator.ts'
import { androidBackupPreferences, parseAndroidBackup, serializeAndroidBackup, validateAndroidDraftSettings } from '../src/lib/androidBackup.ts'
import { androidFormConfig, androidGenerationRequest } from '../src/lib/androidStudio.ts'
import { prepareHistoryRestore, snapshotGeneration } from '../src/lib/generationSnapshot.ts'
import { comparisonReferences } from '../src/lib/comparisonReferences.ts'
import { uploadedReferences, recipeBackup } from '../src/lib/recipeImages.ts'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJm0AAAAASUVORK5CYII='
const draft = '冷色窗光，不添加首饰。'
const sample = () => {
  const refs = uploadedReferences('已知参考', png, 1, 1, 68)
  return { ...refs, costume: { ...refs.costume, source: undefined, 服装名称: '青色旗袍' },
    pose: { ...refs.pose, source: undefined, 姿势名称: '扶栏坐姿', 角度: '侧面' } }
}
const labels = ['参考图属性隔离', '人物身份', '独立人物形体设定', '服饰提取与适配', '姿势迁移与镜头构图', '画风及摄影效果', '最终输出约束']
const section = (prompt, label) => prompt.split('\n\n').find(p => p.startsWith(`【${label}】`))

test('the enabled prompt uses precisely the seven ordered modules; only the body module defines anatomy', () => {
  const recipe = {...sample(), bodyProfile: defaultBodyProfile(true)}
  const prompt = buildAndroidStudioPrompt(recipe, 'realistic', draft)
  assert.deepEqual([...prompt.matchAll(/^【(.+)】$/gm)].map(m => m[1]), labels)
  assert.match(section(prompt, labels[1]), /图1仅提供脸型/)
  assert.match(section(prompt, labels[2]), /7\.5 头身比例.*自然直立/)
  assert.match(section(prompt, labels[2]), /唯一基准/)
  assert.match(section(prompt, labels[3]), /只提取图2.*青色旗袍.*自然适配/)
  assert.match(section(prompt, labels[4]), /只迁移图3.*扶栏坐姿.*侧面/)
  assert.match(section(prompt, labels[5]), /写实商业摄影级质感.*不修改姿势图的视角.*人体比例/)
  assert.doesNotMatch(section(prompt, labels[5]), /85mm/)
  assert.match(section(prompt, labels[6]), new RegExp(draft))
  assert.ok(!prompt.includes('人物比例协调'))
})

test('slot edits update only their own references, gaps renumber, and the request contains no body API parameters', () => {
  const previous = {...sample(), bodyProfile: {...defaultBodyProfile(true), headRatio: 8.2, shoulderWidth: '偏宽'}}
  const current = {...previous, portrait: null, costume: {...previous.costume, 服装名称: '白色外套'},
    pose: {...previous.pose, 姿势名称: '走路', 角度: '正面'}}
  const prompt = buildAndroidStudioPrompt(current, 'film', draft)
  assert.match(section(prompt, labels[3]), /只提取图1.*白色外套/)
  assert.match(section(prompt, labels[4]), /只迁移图2.*走路.*正面/)
  assert.match(section(prompt, labels[1]), /未提供人物身份图/)
  assert.doesNotMatch(prompt, /青色旗袍|扶栏坐姿|图3/)
  assert.equal(section(prompt, labels[2]), section(buildAndroidStudioPrompt(previous, 'realistic', draft), labels[2]))
  const config = androidFormConfig({...DEFAULT_API_CONFIG, activeProvider: 'gpt', stylePreset: 'film'})
  const request = androidGenerationRequest(current, config, prompt)
  assert.equal(request.prompt, prompt)
  assert.deepEqual(request.images, [png,png])
  assert.deepEqual(Object.keys(request).sort(), ['images','model','prompt','provider','quality','size'])
})

test('legacy and disabled paths without a pose preserve original prompts including custom overrides', () => {
  const recipe = {...sample(),pose:null}
  for (const r of [recipe, {...recipe, bodyProfile: defaultBodyProfile(false)}]) {
    assert.equal(buildAndroidStudioPrompt(r, 'film', null), buildRecipePrompt(recipe, 'film'))
    assert.equal(buildAndroidStudioPrompt(r, 'film', draft), draft)
  }
  assert.equal(normalizeBodyProfile(undefined), undefined)
})

test('current settings, selected preset and per-history snapshot round trip independently and never duplicate body prompt', async () => {
  const profile = {...defaultBodyProfile(true), presetId:'custom-test', headRatio:8.1, customDescription:'肩线稍平'}
  const recipe = {...sample(), portrait:null, bodyProfile:profile}
  const config = androidFormConfig({...DEFAULT_API_CONFIG, activeProvider:'gpt'})
  const prompt = buildAndroidStudioPrompt(recipe, config.stylePreset, draft)
  const snapshot = await snapshotGeneration(recipe, config, prompt, draft)
  const preset = {id:'custom-test', name:'工作室比例',parameters:{...BUILTIN_BODY_PRESETS[0].parameters,headRatio:8.3}}
  let backup={recipe:{...recipe,bodyProfile:{...profile,headRatio:8.7}},bodyPresets:[preset],customPrompt:draft,poseDepthMode:false,
    preferences:androidBackupPreferences(config),history:[{id:'a',createdAt:1,provider:'gpt',model:'gpt-image',prompt,imageUrl:png,recipeSummary:'测试',snapshot}]}
  for(let i=0;i<2;i++) {
    backup = parseAndroidBackup(new TextDecoder().decode(serializeAndroidBackup(backup)))
    const restored = prepareHistoryRestore(backup.history[0])
    assert.equal(restored.kind,'full')
    assert.deepEqual(restored.snapshot.recipe.bodyProfile, profile)
    assert.equal(restored.customPrompt,draft)
    assert.equal(backup.recipe.bodyProfile.headRatio,8.7)
    assert.equal(validateAndroidDraftSettings(backup).bodyPresets[0].parameters.headRatio,8.3)
    const output = buildAndroidStudioPrompt(restored.snapshot.recipe, config.stylePreset, restored.customPrompt)
    assert.equal(output,prompt)
    assert.equal(output.match(/【独立人物形体设定】/g).length,1)
  }
  assert.deepEqual(recipeBackup(recipe).bodyProfile, profile)
})

test('enumerated options and 0.1 steps normalize at boundaries; custom preset list protects built-ins', () => {
  const editable = Object.fromEntries(BODY_FIELDS.map(k => [k, BODY_OPTIONS[k].options.at(-1)]))
  const profile = normalizeBodyProfile({...editable, headRatio:8.24, enabled:true, customDescription:'要求 9.0 头身'})
  assert.equal(profile.headRatio,8.2)
  for(const field of BODY_FIELDS) assert.equal(profile[field],editable[field])
  assert.ok(buildBodyPrompt(profile).includes('要求 9.0 头身'))
  assert.ok(bodyDescriptionConflicts(profile))
  assert.equal(normalizeBodyProfile({...profile,headRatio:100}).headRatio,9)
  const custom = {id:'custom-test',name:'  我的   预设  ',parameters:profile}
  assert.deepEqual(normalizeBodyPresets([{...custom,id:'natural'},custom,custom]).map(p=>p.name),['我的 预设'])
})

test('supplemental images have independent use/exclude rules which follow their own files and dynamic numbering', async () => {
  const recipe = {...sample(), portrait:null, bodyProfile: defaultBodyProfile(true), extraImages:[
    { id:'light',url:png,name:'灯光',useFeatures:'窗边侧光',excludeFeatures:'沙发' },
    { id:'accessory',url:png,name:'配饰',useFeatures:'耳饰',excludeFeatures:'服装与体型' },
  ]}
  const prompt = buildAndroidStudioPrompt(recipe,'realistic',null)
  assert.match(section(prompt, labels[0]), /图3（附加参考）：仅采用以下非形体细节：「窗边侧光」，不补全未列出的细节.*排除：「沙发」/)
  assert.match(section(prompt, labels[0]), /图4（附加参考）：仅采用以下非形体细节：「耳饰」，不补全未列出的细节.*排除：「服装与体型」/)
  assert.match(section(prompt, labels[0]), /不覆盖已指定的服饰、动作、镜头或构图/)
  const changed = {...recipe, extraImages: recipe.extraImages.slice(1)}
  assert.match(buildAndroidStudioPrompt(changed,'realistic',null), /图3（附加参考）/)
  assert.doesNotMatch(buildAndroidStudioPrompt(changed,'realistic',null), /窗边侧光|图4/)
  assert.match(buildAndroidStudioPrompt({...recipe,bodyProfile:defaultBodyProfile(false)},'realistic',null), /图2（姿势槽）是动作、镜头与构图的唯一来源[\s\S]*窗边侧光[\s\S]*沙发/)
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  const backup = { recipe, history:[], customPrompt:null, poseDepthMode:false, preferences:androidBackupPreferences(config) }
  const restored = parseAndroidBackup(new TextDecoder().decode(serializeAndroidBackup(backup)))
  assert.deepEqual(restored.recipe.extraImages, recipe.extraImages)
})

test('supplemental allowlists work without an exclusion list, exclusions win, and blank allowlists keep the default scope', () => {
  const recipe = {...sample(), costume:null, pose:null, bodyProfile: defaultBodyProfile(true), extraImages: [
    { id:'ambient',url:png,name:'夜景',useFeatures:' 暖黄逆光 ' },
    { id:'fallback',url:png,name:'庭院',useFeatures:'   ',excludeFeatures:'伞' },
    { id:'overlap',url:png,name:'配饰',useFeatures:'耳饰',excludeFeatures:'耳饰' },
    { id:'legacy',url:png,name:'无规则' },
  ]}
  const prompt = buildAndroidStudioPrompt(recipe,'realistic',null)
  const rules = section(prompt, labels[0])
  assert.match(rules, /图2（附加参考）：仅采用以下非形体细节：「暖黄逆光」，不补全未列出的细节。\n/)
  assert.match(rules, /图3（附加参考）：只补充局部纹样、材质、配饰细节、背景或光线，不复刻整张图；排除：「伞」/)
  assert.match(rules, /采用与排除冲突时，以排除为准/)
  assert.doesNotMatch(rules, /「耳饰」|图5/)
  assert.match(rules, /图4（附加参考）：只补充局部纹样、材质、配饰细节、背景或光线，不复刻整张图。$/)
  const request = androidGenerationRequest(recipe, androidFormConfig({...DEFAULT_API_CONFIG, activeProvider:'gpt'}), prompt)
  assert.equal(request.prompt, prompt)
  assert.deepEqual(request.images, Array(4).fill(png))
})


test('pose remains authoritative, cropped visual bytes replace only the selected extra, and undo restores the original', async () => {
  const crop = png.replace('AAAAEAAAAB', 'AAAAEAAAAC')
  const extraImages = [
    { id:'cropped',name:'银饰样本',url:png,cropUrl:crop,useFeatures:'银质叶片耳饰',excludeFeatures:'人物和坐姿' },
    { id:'whole',name:'背景灯',url:png,useFeatures:'暖黄色逆光' },
  ]
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  for(const enabled of [false,true]) {
    const recipe = {...sample(), extraImages, bodyProfile:defaultBodyProfile(enabled)}
    const prompt = buildAndroidStudioPrompt(recipe, 'realistic', '尝试不同构图。')
    assert.match(prompt, /图3（姿势槽）是动作、镜头与构图的唯一来源/)
    assert.match(prompt, /图4（附加局部）：仅采用以下非形体细节：「银质叶片耳饰」/)
    assert.match(prompt, /图5（附加参考）：仅采用以下非形体细节：「暖黄色逆光」/)
    const request = androidGenerationRequest(recipe, config, prompt)
    assert.deepEqual(request.images, [png,png,png,crop,png])
    const snapshot = await snapshotGeneration(recipe, config, prompt, '尝试不同构图。')
    assert.equal(snapshot.recipe.extraImages[0].cropUrl, crop)
    const restored = prepareHistoryRestore({provider:'gpt',prompt,snapshot})
    assert.equal(restored.snapshot.recipe.extraImages[0].cropUrl, crop)
    const undone = {...recipe,extraImages:[{...extraImages[0],cropUrl:undefined},extraImages[1]]}
    assert.deepEqual(androidGenerationRequest(undone, config, prompt).images, Array(5).fill(png))
  }
})


test('body volume has nine semantic steps with distinct Chinese and English descriptions and one natural default', () => {
  assert.deepEqual(BODY_VOLUME_LEVELS.map(level => [level.id,level.label]), [
    ['very_slim','非常纤细'], ['slim','偏纤细'], ['lean','轻盈紧实'], ['slightly_slim','略偏纤细'],
    ['moderate','自然适中'], ['slightly_full','微丰盈'], ['full','丰盈'], ['plump','丰满'], ['plus_size','大体量'],
  ])
  for(const field of ['promptZh','promptEn']) assert.equal(new Set(BODY_VOLUME_LEVELS.map(level => level[field])).size,9)
  assert.equal(defaultBodyProfile(true).bodyVolume,'moderate')
  assert.equal(bodyVolumeLevel('__proto__').id,'moderate')
  assert.equal(BUILTIN_BODY_PRESETS.find(p=>p.id==='slender').parameters.bodyVolume,'slim')
  assert.equal(BUILTIN_BODY_PRESETS.find(p=>p.id==='full').parameters.bodyVolume,'full')
})

test('legacy body volume values migrate in current profile, custom presets, and a restored historical form', async () => {
  const cases = [['偏纤细','slim'],['自然适中','moderate'],['偏丰盈','full']]
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  for(const [old, next] of cases) {
    const profile = {...defaultBodyProfile(true),bodyVolume:old,headRatio:8.2,waistlinePosition:'偏高'}
    assert.equal(normalizeBodyProfile(profile).bodyVolume,next)
    const presets=normalizeBodyPresets([{id:'custom-legacy',name:'旧版',parameters:profile}])
    assert.equal(presets[0].parameters.bodyVolume,next)
    const snapshot = await snapshotGeneration({...sample(),bodyProfile:profile},config,'存量提示词',null)
    const restored = prepareHistoryRestore({provider:'gpt',prompt:snapshot.prompt,snapshot})
    assert.equal(restored.kind,'full')
    assert.equal(restored.snapshot.recipe.bodyProfile.bodyVolume,next)
    assert.equal(restored.snapshot.recipe.bodyProfile.headRatio,8.2)
    assert.equal(restored.snapshot.recipe.bodyProfile.waistlinePosition,'偏高')
    assert.equal(restored.snapshot.prompt,'存量提示词')
  }
})

test('changing body volume changes only its natural-language line, not local body shape or anatomy', () => {
  const p = {...defaultBodyProfile(true),bodyType:'纤细',headRatio:8.1, chestShape:'偏丰满',waistShape:'曲线明显',
    waistlinePosition:'偏高',limbShape:'自然健美',legRatio:'偏长'}
  const generated = BODY_VOLUME_LEVELS.map(level => buildBodyPrompt({...p,bodyVolume:level.id}))
  assert.equal(new Set(generated.map(prompt=>prompt.split('\n')[2])).size,9)
  assert.equal(new Set(generated.map(prompt=>prompt.split('\n')[1])).size,1)
  for(let i=0;i<generated.length;i++) {
    const prompt=generated[i],level=BODY_VOLUME_LEVELS[i]
    assert.ok(prompt.includes(level.promptZh))
    assert.ok(!prompt.includes(level.id))
    assert.ok(!prompt.includes(level.promptEn))
    assert.match(prompt,/8\.1 头身比例.*胸部形态偏丰满.*腰侧轮廓转折清楚.*腰线位置偏高.*腿部长度相对身高偏长.*手臂自然健美/)
    assert.match(prompt,/仅定义全身软组织总体量，不统一放大或缩小任何局部/)
    assert.doesNotMatch(prompt,/整体体型纤细|第 [1-9] 级/)
  }
})


test('plus-size body uses a cropped thigh/calf and hip width reference without competing sources in the final request', async () => {
  const crop = png.replace('AAAAEAAAAB', 'AAAAEAAAAC')
  const recipe = {...sample(), bodyProfile: {...defaultBodyProfile(true), bodyVolume:'plus_size',
    legRatio:'偏长', legThickness:'偏细', hipWidth:'偏窄', waistHipRatio:'曲线明显'},
    extraImages:[
      {id:'local', name:'DO-NOT-SEND.jpg', url:png, cropUrl:crop, bodyOverrides:['legThickness','hipWidth'],useFeatures:'粗腿、宽胯、银丝纹样'},
      {id:'light',name:'lighting-secret.png',url:png,useFeatures:'窗边侧光',excludeFeatures:'沙发'},
    ]}
  const prompt = buildAndroidStudioPrompt(recipe, 'realistic', null)
  const rules = section(prompt, labels[0]), body = section(prompt, labels[2])
  assert.match(rules, /局部来源是附加图唯一的形体授权/)
  assert.match(rules, /图4（附加局部）：仅采用以下非形体细节：「银丝纹样」/)
  assert.match(rules, /图5（附加参考）：仅采用以下非形体细节：「窗边侧光」/)
  assert.doesNotMatch(prompt, /不提供任何形体属性|DO-NOT-SEND|lighting-secret|85mm|plus_size/)
  assert.match(body, /全身软组织总体呈大体量/)
  assert.match(body, /腿部长度相对身高偏长/)
  assert.match(body, /腿部粗细只参考图4可见的大腿和小腿横向厚度，不取腿长/)
  assert.match(body, /臀胯宽度只参考图4可见的臀胯横向宽度，不取腰宽或腰臀比例/)
  assert.match(body, /腰部相对臀胯明显收束，按已确定的臀胯宽度调整腰部相对宽度/)
  assert.doesNotMatch(body, /腿部粗细偏细|臀胯宽度偏窄/)
  assert.match(section(prompt, labels[4]), /只迁移图3.*侧面.*承重侧.*相机透视.*不镜像.*适配目标身形/)
  assert.match(section(buildAndroidStudioPrompt(recipe,'concept_sheet',null),labels[5]), /画面可见/)
  assert.doesNotMatch(section(buildAndroidStudioPrompt(recipe,'concept_sheet',null),labels[5]), /全身|纯白/)
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  const request = androidGenerationRequest(recipe, config, prompt)
  assert.deepEqual(request.images,[png,png,png,crop,png])
  const snapshot = await snapshotGeneration(recipe,config,prompt,null)
  const restored = prepareHistoryRestore({provider:'gpt',prompt,snapshot})
  assert.deepEqual(restored.snapshot.recipe.extraImages[0].bodyOverrides,['legThickness','hipWidth'])
  const backup = {recipe,history:[],customPrompt:null,poseDepthMode:false,preferences:androidBackupPreferences(config)}
  assert.deepEqual(parseAndroidBackup(new TextDecoder().decode(serializeAndroidBackup(backup))).recipe.extraImages, recipe.extraImages)
})

test('authorization is explicit, moves one attribute at a time, renumbers, and is suspended when shape is off', () => {
  const extraImages = [
    {id:'a',url:png,name:'a.png',bodyOverrides:['legThickness','hipWidth']},
    {id:'b',url:png,name:'b.png',useFeatures:'粗腿、宽胯'},
    {id:'c',url:png,name:'c.png'},
  ]
  const bodyProfile = {...defaultBodyProfile(true),legThickness:'偏粗',hipWidth:'偏宽'}
  const recipe = {...sample(),bodyProfile,extraImages}
  const moved = selectLocalBodySource(extraImages,'b','hipWidth',true)
  let output = buildAndroidStudioPrompt({...recipe,portrait:null,extraImages:moved},'film',null)
  assert.match(output,/腿部粗细只参考图3.*臀胯宽度只参考图4/)
  assert.match(output,/35mm 富士胶片/)
  const unchecked = selectLocalBodySource(moved,'b','hipWidth',false)
  output = buildAndroidStudioPrompt({...recipe,extraImages:unchecked},'none',null)
  assert.match(output,/腿部粗细只参考图4.*臀胯宽度偏宽/)
  assert.doesNotMatch(output,/图5（附加参考）/)
  assert.doesNotMatch(output,/粗腿、宽胯/)
  const noLocal = buildAndroidStudioPrompt({...recipe,extraImages:unchecked.slice(1)},'none',null)
  assert.doesNotMatch(noLocal,/图4（附加参考）|图5（附加参考）/)
  assert.match(noLocal,/腿部粗细偏粗.*臀胯宽度偏宽/)
  assert.doesNotMatch(noLocal,/粗细只参考图|宽度只参考图|粗腿、宽胯/)
  const disabled = buildAndroidStudioPrompt({...recipe,bodyProfile:{...bodyProfile,enabled:false}},'realistic',null)
  assert.match(disabled,/服饰槽）是穿搭的唯一来源/)
  assert.doesNotMatch(disabled,/图4（附加参考）/)
  assert.doesNotMatch(disabled,/独立人物形体设定|DO-NOT-SEND|[abc]\.png/)
  const duplicate = [{...extraImages[0]}, {...extraImages[1],bodyOverrides:['hipWidth'] }]
  assert.match(buildAndroidStudioPrompt({...recipe,extraImages:duplicate},'film',null),/臀胯宽度只参考图4/)
  assert.equal(normalizeBodyProfile({enabled:true,limbShape:'纤细修长'}).legThickness,'偏细')
})

test('costume always owns all outfit attributes; unsupported and excluded extras never enter the provider payload', async () => {
  const [costume, pose, blocked, shape, crop, light] = ['aA==','aQ==','ag==','aw==','bA==','bQ=='].map(bytes => `data:image/png;base64,${bytes}`)
  const recipe = {portrait:null,costume:uploadedReferences('青色旗袍',costume,1,1,1).costume,
    pose:uploadedReferences('动作',pose,1,1,1).pose,bodyProfile:defaultBodyProfile(true),extraImages:[
      {id:'blocked',name:'red-coat.png',url:blocked,excludeFeatures:'服饰'},
      {id:'shape',name:'shapes.png',url:shape,cropUrl:crop,bodyOverrides:['legThickness'],useFeatures:'大腿小腿粗细和长度比例、服装',excludeFeatures:'服装'},
      {id:'light',name:'light.png',url:light,useFeatures:'窗边侧光、外套、帽子',excludeFeatures:'帽子、服饰'},
    ]}
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  const prompt = buildAndroidStudioPrompt(recipe, 'realistic', '把旗袍换成大衣。')
  assert.match(prompt,/图1（服饰槽）是穿搭的唯一来源.*鞋袜与配饰.*不能替换、删减、叠穿或改色/)
  assert.match(prompt,/图3（附加局部）：仅提供形体模块明确授权的局部属性，不取衣物/)
  assert.match(prompt,/图4（附加参考）：仅采用以下非形体细节：「窗边侧光」/)
  assert.match(prompt,/腿部粗细只参考图3/)
  assert.match(prompt,/出图前核对穿搭与图1一致/)
  assert.doesNotMatch(prompt,/red-coat|大腿小腿粗细和长度比例|图5|「窗边侧光、外套/)
  assert.deepEqual(androidGenerationRequest(recipe,config,prompt).images,[costume,pose,crop,light])
  const disabled = {...recipe,bodyProfile:defaultBodyProfile(false)}
  assert.deepEqual(androidGenerationRequest(disabled,config,buildAndroidStudioPrompt(disabled,'realistic',null)).images,[costume,pose,light])
  const snapshot = await snapshotGeneration(recipe,config,prompt,null)
  snapshot.submittedExtraOffsets = [1,2]
  const restored = prepareHistoryRestore({provider:'gpt',prompt,snapshot})
  assert.deepEqual(restored.snapshot.recipe.extraImages,recipe.extraImages)
  assert.deepEqual(restored.snapshot.submittedExtraOffsets,[1,2])
  const compared = comparisonReferences({provider:'gpt',prompt,snapshot:restored.snapshot})
  assert.deepEqual(compared.filter(item=>item.id.startsWith('extra:')).map(item=>item.url),[crop,light])
})

test('Android restores explicit companion rules and reassembles the exact generation prompt without treating notes as authorization', async () => {
  const [pose, allowed, omitted] = ['aA==','aQ==','ag=='].map(bytes => `data:image/png;base64,${bytes}`)
  const recipe = {portrait:null,costume:null,pose:uploadedReferences('动作',pose,1,1,1).pose,extraImages:[
    {id:'allow',name:'本地备注',url:allowed,useFeatures:'窗边侧光',excludeFeatures:'沙发'},
    {id:'omit',name:'文件名.png',url:omitted,excludeFeatures:'服饰'},
  ]}
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  const custom = '日落色调。'
  const output = buildAndroidStudioPrompt(recipe,config.stylePreset,custom)
  const snapshot = await snapshotGeneration(recipe,config,'旧记录发出的提示词，不应作为完整预览',custom)
  const restore = prepareHistoryRestore({provider:'gpt',prompt:snapshot.prompt,snapshot})
  assert.equal(restore.kind,'full')
  assert.deepEqual(restore.snapshot.recipe.extraImages,recipe.extraImages)
  assert.equal(buildAndroidStudioPrompt(restore.snapshot.recipe,config.stylePreset,restore.customPrompt),output)
  assert.match(output,/图2（附加参考）.*窗边侧光.*沙发/)
  assert.doesNotMatch(output,/本地备注|文件名|旧记录|图3/)
  assert.deepEqual(androidGenerationRequest(restore.snapshot.recipe,config,output).images,[pose,allowed])
})
