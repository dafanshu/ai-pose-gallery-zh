import test from 'node:test'
import assert from 'node:assert/strict'
import { BODY_FIELDS, BODY_OPTIONS, BUILTIN_BODY_PRESETS, buildBodyPrompt, bodyDescriptionConflicts, defaultBodyProfile, normalizeBodyProfile, normalizeBodyPresets } from '../src/lib/bodyProfile.ts'
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
  assert.match(section(prompt, labels[0]), /图3（灯光）：仅采用 窗边侧光；排除 沙发/)
  assert.match(section(prompt, labels[0]), /图4（配饰）：仅采用 耳饰；排除 服装与体型/)
  assert.match(section(prompt, labels[0]), /不覆盖已指定的服饰或动作/)
  const changed = {...recipe, extraImages: recipe.extraImages.slice(1)}
  assert.match(buildAndroidStudioPrompt(changed,'realistic',null), /图3（配饰）/)
  assert.doesNotMatch(buildAndroidStudioPrompt(changed,'realistic',null), /窗边侧光|图4/)
  assert.doesNotMatch(buildAndroidStudioPrompt({...recipe,bodyProfile:defaultBodyProfile(false)},'realistic',null), /窗边侧光|沙发/)
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  const backup = { recipe, history:[], customPrompt:null, poseDepthMode:false, preferences:androidBackupPreferences(config) }
  const restored = parseAndroidBackup(new TextDecoder().decode(serializeAndroidBackup(backup)))
  assert.deepEqual(restored.recipe.extraImages, recipe.extraImages)
})
