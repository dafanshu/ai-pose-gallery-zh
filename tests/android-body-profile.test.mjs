import test from 'node:test'
import assert from 'node:assert/strict'
import { BODY_FIELDS, BODY_OPTIONS, BODY_VOLUME_LEVELS, BUILTIN_BODY_PRESETS, buildBodyPrompt, bodyDescriptionConflicts, bodyVolumeLevel, defaultBodyProfile, normalizeBodyProfile, normalizeBodyPresets } from '../src/lib/bodyProfile.ts'
import { buildAndroidStudioPrompt, buildRecipePrompt } from '../src/services/aiGenerator.ts'
import { androidBackupPreferences, parseAndroidBackup, serializeAndroidBackup, validateAndroidDraftSettings } from '../src/lib/androidBackup.ts'
import { androidFormConfig, androidGenerationRequest } from '../src/lib/androidStudio.ts'
import { prepareHistoryRestore, snapshotGeneration } from '../src/lib/generationSnapshot.ts'
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
  assert.match(section(prompt, labels[5]), /85mm.*不另设人体比例/)
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

test('legacy and disabled paths preserve original prompts including custom overrides', () => {
  const recipe = sample()
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
  assert.match(section(prompt, labels[0]), /图3（附加参考：灯光）：仅采用以下明确列出的特征：「窗边侧光」。未列出的所有特征都不得从本图提取或补全.*排除：「沙发」/)
  assert.match(section(prompt, labels[0]), /图4（附加参考：配饰）：仅采用以下明确列出的特征：「耳饰」。未列出的所有特征都不得从本图提取或补全.*排除：「服装与体型」/)
  assert.match(section(prompt, labels[0]), /不覆盖已指定的服饰、动作、镜头或构图/)
  const changed = {...recipe, extraImages: recipe.extraImages.slice(1)}
  assert.match(buildAndroidStudioPrompt(changed,'realistic',null), /图3（附加参考：配饰）/)
  assert.doesNotMatch(buildAndroidStudioPrompt(changed,'realistic',null), /窗边侧光|图4/)
  assert.match(buildAndroidStudioPrompt({...recipe,bodyProfile:defaultBodyProfile(false)},'realistic',null), /图2（姿势槽）是动作与构图的唯一来源[\s\S]*窗边侧光[\s\S]*沙发/)
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  const backup = { recipe, history:[], customPrompt:null, poseDepthMode:false, preferences:androidBackupPreferences(config) }
  const restored = parseAndroidBackup(new TextDecoder().decode(serializeAndroidBackup(backup)))
  assert.deepEqual(restored.recipe.extraImages, recipe.extraImages)
})

test('supplemental allowlists work without an exclusion list, exclusions win, and blank allowlists keep the default scope', () => {
  const recipe = {...sample(), pose:null, bodyProfile: defaultBodyProfile(true), extraImages: [
    { id:'ambient',url:png,name:'夜景',useFeatures:' 暖黄逆光 ' },
    { id:'fallback',url:png,name:'庭院',useFeatures:'   ',excludeFeatures:'伞' },
    { id:'overlap',url:png,name:'配饰',useFeatures:'耳饰',excludeFeatures:'耳饰' },
    { id:'legacy',url:png,name:'无规则' },
  ]}
  const prompt = buildAndroidStudioPrompt(recipe,'realistic',null)
  const rules = section(prompt, labels[0])
  assert.match(rules, /图3（附加参考：夜景）：仅采用以下明确列出的特征：「暖黄逆光」。未列出的所有特征都不得从本图提取或补全，即使没有写进排除项。\n/)
  assert.match(rules, /图4（附加参考：庭院）：仅参考可用的元素、配饰、背景或光影；排除：「伞」/)
  assert.match(rules, /采用与排除冲突时，以排除为准/)
  assert.match(rules, /图5（附加参考：配饰）：仅采用以下明确列出的特征：「耳饰」。.*排除：「耳饰」/)
  assert.match(rules, /图6（附加参考：无规则）：仅参考可用的元素、配饰、背景或光影。$/)
  const request = androidGenerationRequest(recipe, androidFormConfig({...DEFAULT_API_CONFIG, activeProvider:'gpt'}), prompt)
  assert.equal(request.prompt, prompt)
  assert.deepEqual(request.images, Array(6).fill(png))
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
    assert.match(prompt, /图3（姿势槽）是动作与构图的唯一来源/)
    assert.match(prompt, /图4（附加局部：银饰样本）：仅采用以下明确列出的特征：「银质叶片耳饰」/)
    assert.match(prompt, /图5（附加参考：背景灯）：仅采用以下明确列出的特征：「暖黄色逆光」/)
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
    assert.match(prompt,/8\.1 头身比例.*胸部形态偏丰满.*腰部曲线明显.*腰线位置偏高.*腿部偏长.*四肢自然健美/)
    assert.match(prompt,/胸部、腰部及四肢的局部形态仍由各自参数决定/)
    assert.doesNotMatch(prompt,/整体体型纤细|第 [1-9] 级/)
  }
})
