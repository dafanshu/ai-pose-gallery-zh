import assert from 'node:assert/strict'
import test from 'node:test'
import { ANDROID_POSE_ANGLES, androidPoseCards, androidPoseReference, androidPoseView, androidSelectedPoseGroup } from '../src/lib/androidPoseViews.ts'
import { androidFormConfig, androidGenerationRequest } from '../src/lib/androidStudio.ts'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'
import { buildAndroidStudioPrompt } from '../src/services/aiGenerator.ts'
import { defaultBodyProfile } from '../src/lib/bodyProfile.ts'
import { poseImagePath, uploadedReferences } from '../src/lib/recipeImages.ts'

const make = (series, angle, dataUrl = 'data:image/jpeg;base64,cG9zZQ==') => ({
  slot: 'pose', name: '坐姿参考 · ' + ANDROID_POSE_ANGLES[angle],
  tags: ['坐姿', series, ANDROID_POSE_ANGLES[angle], 'P001', series + '_P001_' + angle], dataUrl,
})
const front = make('full_normal', 'front')
const side = make('full_normal', 'side', 'data:image/jpeg;base64,c2lkZQ==')
const high = make('full_normal', 'high')
const other = make('full_sexy', 'front')
const legacy = { slot: 'pose', name: '旧版参考图', tags: [], dataUrl: front.dataUrl }

test('pose library groups by complete series and pose number, while keeping view order', () => {
  const pack = [other, side, front, high, legacy]
  assert.deepEqual(androidPoseCards(pack, pack), [[other], [front, high, side], [legacy]])
  assert.deepEqual(androidPoseCards(pack, [side]), [[front, high, side]], 'searching a single angle retains the other views')
  assert.deepEqual(androidPoseCards(pack, [], 'full_normal_P001'), [[front, high, side]])
  assert.deepEqual(androidPoseCards(pack, [], 'missing'), [])
  assert.equal(androidPoseView({ ...front, name: '不匹配 · 侧面' }), null)
})

test('switching the view keeps the pose group and puts the chosen local image into the recipe', () => {
  const from = androidPoseReference(front)
  const to = androidPoseReference(side)
  assert.deepEqual(androidSelectedPoseGroup(from.id), { group: 'full_normal_P001', id: 'full_normal_P001_front' })
  assert.deepEqual(androidSelectedPoseGroup(to.id), { group: 'full_normal_P001', id: 'full_normal_P001_side' })
  assert.equal(to.姿势名称, from.姿势名称)
  assert.equal(to.角度, '侧面')
  assert.equal(poseImagePath(to), side.dataUrl)
  assert.equal(androidSelectedPoseGroup(androidPoseReference(legacy).id), null)
})


test('the actual Android request aligns a selected gallery angle, strict pose semantics and filtered extras', () => {
  const config = androidFormConfig({...DEFAULT_API_CONFIG,activeProvider:'gpt'})
  const blocked = { id:'alt', name:'其他镜头.png', url:front.dataUrl, useFeatures:'站姿、正面、构图' }
  const light = { id:'light', name:'灯光.png', url:high.dataUrl, useFeatures:'侧面、窗边侧光' }
  const costume = uploadedReferences('旗袍',front.dataUrl,1,1,1).costume
  for (const enabled of [true,false]) {
    for (const row of [front,side]) {
      const recipe = { portrait:null,costume,pose:androidPoseReference(row),bodyProfile:defaultBodyProfile(enabled),extraImages:[blocked,light] }
      const prompt = buildAndroidStudioPrompt(recipe,'concept_sheet','请改成站着并镜像。')
      assert.match(prompt,/图2（姿势槽）是动作、镜头与构图的唯一来源/)
      assert.match(prompt,new RegExp(`图2的动作与选定视角（坐姿参考，${row.name.split(' · ')[1]}）`))
      assert.match(prompt,/画面左右侧手脚.*承重侧.*接触关系.*不镜像、不换动作/)
      assert.match(prompt,/补充创作要求（与参考图分工/)
      assert.match(prompt,/出图前对照图2检查左右方向、承重与接触点/)
      assert.match(prompt,/图3（附加参考）：仅采用以下非形体细节：「窗边侧光」/)
      assert.doesNotMatch(prompt,/图4|站姿、正面、构图|「侧面、窗边侧光」|全身立绘|纯白干净/)
      assert.equal(prompt.includes('【独立人物形体设定】'),enabled)
      assert.deepEqual(androidGenerationRequest(recipe,config,prompt).images,[front.dataUrl,row.dataUrl,high.dataUrl])
    }
  }
  const pose = uploadedReferences('不要写入文件名.png',side.dataUrl,1,1,1).pose
  const fromAlbum = buildAndroidStudioPrompt({portrait:null,costume:null,pose},'realistic','冷调。')
  assert.match(fromAlbum,/图1（姿势槽）是动作、镜头与构图的唯一来源/)
  assert.doesNotMatch(fromAlbum,/不要写入文件名|85mm/)
})
