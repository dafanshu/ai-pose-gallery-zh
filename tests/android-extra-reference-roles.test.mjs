import assert from 'node:assert/strict'
import test from 'node:test'
import { androidReferencePlan, extraRuleHasReservedLabels, selectExtraPose } from '../src/lib/androidReferencePlan.ts'
import { androidFormConfig, androidGenerationRequest } from '../src/lib/androidStudio.ts'
import { addReferenceFavorite, restoreExtraFavorite } from '../src/lib/androidReferenceFavorites.ts'
import { androidBackupPreferences, parseAndroidBackup, serializeAndroidBackup } from '../src/lib/androidBackup.ts'
import { defaultBodyProfile, selectLocalBodySource } from '../src/lib/bodyProfile.ts'
import { prepareHistoryRestore, snapshotGeneration } from '../src/lib/generationSnapshot.ts'
import { uploadedReferences } from '../src/lib/recipeImages.ts'
import { buildAndroidStudioPrompt } from '../src/services/aiGenerator.ts'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJm0AAAAASUVORK5CYII=','base64')
const photo = (tag) => 'data:image/png;base64,' + Buffer.concat([png,Buffer.from(tag)]).toString('base64')
const crop = photo('half-body crop'), original = photo('original')
const config = androidFormConfig({...DEFAULT_API_CONFIG, activeProvider:'gpt'})
const sample = (extra = {}, enabled = true) => {
  const {portrait, costume} = uploadedReferences('图1与图2', photo('primary'), 1, 1, 1)
  return { portrait, costume, pose:null, bodyProfile:{...defaultBodyProfile(enabled),chestShape:'偏丰满'},
    extraImages: [
      {id:'omitted',name:'排除的一张.jpg',url:photo('omitted'),useFeatures:'服饰'},
      {id:'card',name:'local-name.jpg',url:original,cropUrl:crop,excludeFeatures:'服饰',...extra},
    ] }
}
const promptFor = (recipe) => buildAndroidStudioPrompt(recipe, 'realistic', null)
const body = (prompt) => prompt.split('\n\n').find(block => block.startsWith('【独立人物形体设定】'))

test('exact pasted rules and punctuated variants retain ordinary features and never grant pose or chest', () => {
  for (const useFeatures of ['胸部形状 场景 背景 表情 姿势','胸部形状、场景、背景、表情、姿势','胸部形态：偏丰满、场景、背景、表情、姿势']) {
    const recipe = sample({useFeatures})
    const plan = androidReferencePlan(recipe)
    assert.equal(extraRuleHasReservedLabels(useFeatures),true)
    assert.deepEqual(plan.sources,{})
    assert.equal(plan.pose,null)
    assert.deepEqual(plan.sent.map(entry => entry.use),[['场景','背景','表情']])
    const prompt = promptFor(recipe)
    assert.match(prompt,/仅采用以下非形体细节：「场景、背景、表情」/)
    assert.doesNotMatch(prompt,/胸部形状|表情、姿势|local-name/)
    assert.match(prompt,/未提供姿势图/)
  }
  assert.deepEqual(androidReferencePlan(sample({useFeatures:'窗边侧光 从左往右'})).sent[0].use,['窗边侧光 从左往右'])
})

test('authorized pose uses compact index and transmitted crop once, even with blank ordinary details and shape off', () => {
  const recipe = sample({useAsPose:true},false)
  const plan = androidReferencePlan(recipe)
  assert.deepEqual(plan.pose,{kind:'extra',index:3})
  assert.deepEqual(plan.sent.map(x=>[x.offset,x.index,x.poseAuthorized]),[[1,3,true]])
  const prompt = promptFor(recipe)
  assert.match(prompt,/提供的 3 张参考图/)
  assert.match(prompt,/图3（附加图：姿势与取景）是动作、镜头与构图的唯一来源/)
  assert.match(prompt,/半身和局部取景不拉远、不补出框外的人体/)
  assert.match(prompt,/只迁移图3.*在可见范围内/)
  assert.match(prompt,/只提取图2.*只呈现取景范围内的部分/)
  assert.doesNotMatch(prompt,/未提供姿势图|85mm|独立人物形体设定】|只补充局部纹样/)
  const request = androidGenerationRequest(recipe,config,prompt)
  assert.deepEqual(request.images,[photo('primary'),photo('primary'),crop])
  assert.equal(request.prompt,prompt)
  assert.deepEqual(androidGenerationRequest(sample({useAsPose:true,cropUrl:undefined},false),config,prompt).images,[photo('primary'),photo('primary'),original])
})

test('main pose and explicit exclusions win without removing other allowed details', () => {
  const recipe = sample({useAsPose:true,useFeatures:'背景、姿势'})
  const primary = uploadedReferences('主姿势',photo('main pose'),1,1,1).pose
  const both = {...recipe,pose:primary}
  const plan = androidReferencePlan(both)
  assert.deepEqual(plan.pose,{kind:'main',index:3})
  assert.equal(plan.sent[0].index,4)
  assert.deepEqual(plan.sent[0].use,['背景'])
  assert.match(promptFor(both),/图3（姿势槽）是动作、镜头与构图的唯一来源/)
  assert.doesNotMatch(promptFor(both),/图4（附加图：姿势与取景）/)
  const excluded = sample({useAsPose:true,useFeatures:'背景、姿势',excludeFeatures:'服饰、姿势'})
  assert.equal(androidReferencePlan(excluded).pose,null)
  assert.deepEqual(androidReferencePlan(excluded).sent[0].use,['背景'])
  assert.equal(androidReferencePlan(sample({useAsPose:true,excludeFeatures:'姿势'})).sent.length,0)
  const switched = selectExtraPose(recipe.extraImages,'omitted',true)
  assert.deepEqual(switched.filter(item => item.useAsPose).map(item=>item.id),['omitted'])
  assert.equal(selectExtraPose(switched,'omitted',false).some(item=>item.useAsPose),false)
})

test('chest authorization only replaces chest, without mutating the saved baseline or authorizing pose', () => {
  const recipe = sample({bodyOverrides:['chestShape']})
  const plan = androidReferencePlan(recipe)
  assert.equal(plan.pose,null)
  assert.deepEqual(plan.sources,{chestShape:3})
  const generated = body(promptFor(recipe))
  assert.match(generated,/胸部形态只参考图3清楚可见的局部轮廓/)
  assert.doesNotMatch(generated,/偏丰满/)
  assert.match(generated,/腿部粗细适中。臀胯宽度适中。腰臀比例/)
  assert.equal(recipe.bodyProfile.chestShape,'偏丰满')
  const extraImages = selectLocalBodySource(recipe.extraImages,'card','chestShape',false)
  assert.match(body(promptFor({...recipe,extraImages})),/胸部形态偏丰满/)
})

test('pose + scoped chest + ordinary details survive history and Android backup, including favorites', async () => {
  const recipe = sample({useAsPose:true,bodyOverrides:['chestShape'],useFeatures:'胸部形状 场景 背景 表情 姿势'})
  const prompt = promptFor(recipe)
  const item = recipe.extraImages[1]
  const favorite = {slot:'extra',item}
  assert.equal(addReferenceFavorite([favorite],{slot:'extra',item:{...item,useAsPose:undefined}}).length,2)
  assert.equal(restoreExtraFavorite(item,[]).image.useAsPose,true)
  assert.equal(restoreExtraFavorite(item,[{...item,id:'existing'}]).image.useAsPose,undefined)
  assert.equal(restoreExtraFavorite(item,[{...item,id:'existing'}]).keptExistingPoseSource,true)
  const snapshot = await snapshotGeneration(recipe,config,prompt,null)
  const input = {recipe, customPrompt:null, poseDepthMode:false, bodyPresets:[], preferences:androidBackupPreferences(config),
    favorites:[favorite],
    history:[{id:'1',createdAt:1,provider:'gpt',model:'gpt-image',prompt,imageUrl:original,recipeSummary:'测试',snapshot}]}
  const backup = parseAndroidBackup(new TextDecoder().decode(serializeAndroidBackup(input)))
  assert.deepEqual(backup.recipe.extraImages,recipe.extraImages)
  assert.deepEqual(backup.favorites,[favorite])
  const restored = prepareHistoryRestore(backup.history[0])
  assert.equal(restored.kind,'full')
  assert.equal(promptFor(restored.snapshot.recipe),prompt)
  assert.match(prompt,/仅采用以下非形体细节：「场景、背景、表情」/)
  assert.match(prompt,/胸部形态只参考图3/)
  assert.equal(androidGenerationRequest(restored.snapshot.recipe,config,prompt).images.length,3)
})
