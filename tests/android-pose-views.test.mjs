import assert from 'node:assert/strict'
import test from 'node:test'
import { ANDROID_POSE_ANGLES, androidPoseCards, androidPoseReference, androidPoseView, androidSelectedPoseGroup } from '../src/lib/androidPoseViews.ts'
import { poseImagePath } from '../src/lib/recipeImages.ts'

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
