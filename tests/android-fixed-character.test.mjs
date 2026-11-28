import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyStudio2, makeCharacterVersion, planFixedEdit } from '../src/lib/androidFixedCharacter.ts'
import { defaultBodyProfile } from '../src/lib/bodyProfile.ts'

const ref = (id, bytes = 50) => ({ id, bytes })
const master = ref('master')
const version = makeCharacterVersion({ master, identity: master, body: { ...defaultBodyProfile(true), headRatio: 8.1 } }, undefined, 123)
const draft = overrides => ({ ...emptyStudio2('gpt-image-2').draft, ...overrides })

test('fixed edit puts the master first, combines identical refs and keeps all other attributes', () => {
  const { references, modules, prompt } = planFixedEdit(draft({ outfit: ref('outfit') }), version)
  assert.deepEqual(references, [{ image: master, roles: ['master', 'identity'] }, { image: ref('outfit'), roles: ['outfit'] }])
  assert.deepEqual(Object.keys(modules), ['REFERENCE_RULES', 'IDENTITY_PROMPT', 'BODY_PROMPT', 'CLOTHING_PROMPT', 'POSE_PROMPT', 'STYLE_PROMPT', 'OUTPUT_PROMPT'])
  assert.match(prompt, /只采用图2的服装与配饰/)
  assert.match(prompt, /保持图1的动作、镜头与构图/)
  assert.match(prompt, /8.1 头身/)
  assert.match(prompt, /若不一致，以图1为准/)
  assert.doesNotMatch(prompt, /图3/)
})

test('only checked roles are sent; pose preserves the target crop and an extra cannot define body/outfit', () => {
  const d = draft({ changes: ['pose', 'light'], outfit: ref('ignored'), pose: ref('pose'),
    extras: [{ kind: 'background', image: ref('ignored-bg') }, { kind: 'light', image: ref('lighting') }] })
  const { references, prompt } = planFixedEdit(d, { ...version, identity: ref('identity') })
  assert.deepEqual(references.map(({ image }) => image.id), ['master', 'identity', 'pose', 'lighting'])
  assert.match(prompt, /图3只决定动作/)
  assert.match(prompt, /半身不补全全身/)
  assert.match(prompt, /图4只提供光影/); assert.match(prompt, /保持图1的服饰与配饰/)
  assert.match(prompt, /附加图不提供身份或任何形体属性/)
})

test('confirmed version body and master references are detached snapshots', () => {
  const body = { ...defaultBodyProfile(true), headRatio: 7.5 }
  const newImage = ref('new')
  const next = makeCharacterVersion({ master: newImage, identity: master, body },
    { id: 'asset', name: 'local', description: '', versions: [version] })
  newImage.id = 'modified'
  body.headRatio = 8.5
  assert.equal(next.number, 2)
  assert.equal(next.body.headRatio, 7.5)
  assert.equal(next.master.id, 'new')
  assert.equal(version.body.headRatio, 8.1)
})

test('invalid model, unavailable inputs, and native size limits fail before calling the bridge', () => {
  assert.throws(() => planFixedEdit(draft({}), version), /填写目标或选择参考图/)
  assert.throws(() => planFixedEdit(draft({ model: 'external', outfit: master }), version), /模型/)
  assert.throws(() => planFixedEdit(draft({ outfit: ref('large', 6 * 1024 ** 2) }), version), /大小/)
  assert.throws(() => planFixedEdit(draft({ outfit: master })), /母版/)
})

test('unrelated description and local photo metadata do not enter the prompt', () => {
  const d = draft({ changes: ['outfit'], outfit: { ...ref('clothes'), fileName: 'local-file.png' },
    descriptions: { background: 'private inactive background', outfit: '帽子与外套' } })
  const { prompt } = planFixedEdit(d, { ...version, body: defaultBodyProfile(false) })
  assert.match(prompt, /帽子与外套/)
  assert.doesNotMatch(prompt, /local-file|private inactive|头身/)
})
