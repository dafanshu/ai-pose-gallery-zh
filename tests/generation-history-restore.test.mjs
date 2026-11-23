import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareHistoryRestore, restoreGenerationConfig, snapshotGeneration } from '../src/lib/generationSnapshot.ts'
import { uploadedReferences } from '../src/lib/recipeImages.ts'
import { parseStudioBackup, serializeStudioBackup } from '../src/lib/studioBackup.ts'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'
import { workflowIdentity } from '../src/lib/comfyWorkflowParameters.ts'

const png = 'data:image/png;base64,iVBORw0KGgo='
const empty = { portrait: null, costume: null, pose: null, extraImages: [] }
const config = () => structuredClone(DEFAULT_API_CONFIG)
const history = (provider, snapshot) => ({ id: 'history-id', createdAt: 1, prompt: 'submitted text', model: 'resolved-model', recipeSummary: 'summary', imageUrl: png, provider, snapshot })

test('full restore round-trips person, costume angle, pose depth, attachments, style and active provider settings', async () => {
  const uploads = uploadedReferences('fixture', png, 2, 3, 6)
  const recipe = {
    ...uploads,
    costume: { ...uploads.costume, 服装名称: '历史服装', selectedView: 'back', views: [{ id: 'back', label: '背面', 原图: png, 缩略图: png, 预览图: png }] },
    pose: { ...uploads.pose, source: undefined, 姿势名称: '历史姿势', useDepth: true, 角度: '仰视' },
    extraImages: [{ id: 'face-detail', name: '面部细节', url: png }, { id: 'reference', name: '参考', url: png }],
  }
  const old = config()
  Object.assign(old, { activeProvider: 'doubao', imagePassMode: 'base64', useProxy: true, stylePreset: 'anime', sendStitchedSheet: true })
  old.providers.doubao = { ...old.providers.doubao, baseUrl: 'https://historical.example', apiKey: 'synthetic-historical-key', model: 'custom', customModel: 'ep-fixture-only' }
  Object.assign(old.doubaoParams, { size: '4K', sequentialImageGeneration: 'auto', watermark: true, responseFormat: 'url' })
  const snap = await snapshotGeneration(recipe, old, 'submitted text', 'historic draft')
  assert.doesNotMatch(JSON.stringify(snap), /synthetic-historical-key|historical\.example/)
  const restored = prepareHistoryRestore(history('doubao', snap))
  assert.equal(restored.kind, 'full')
  assert.equal(restored.customPrompt, 'historic draft')
  assert.equal(restored.snapshot.recipe.portrait.原图, png)
  assert.equal(restored.snapshot.recipe.costume.selectedView, 'back')
  assert.equal(restored.snapshot.recipe.pose.useDepth, true)
  assert.equal(restored.snapshot.recipe.pose.角度, '仰视')
  assert.deepEqual(restored.snapshot.recipe.extraImages, recipe.extraImages)
  const current = config()
  current.providers.doubao.apiKey = 'synthetic-current-key'
  current.providers.doubao.baseUrl = 'https://current.example'
  current.providers.gpt.customModel = 'unrelated-gpt'
  current.gptParams.quality = 'low'
  const restoredConfig = restoreGenerationConfig(current, restored.snapshot)
  assert.equal(restoredConfig.activeProvider, 'doubao')
  assert.equal(restoredConfig.stylePreset, 'anime')
  assert.equal(restoredConfig.imagePassMode, 'base64')
  assert.equal(restoredConfig.sendStitchedSheet, true)
  assert.equal(restoredConfig.useProxy, false)
  assert.deepEqual(restoredConfig.providers.doubao, { baseUrl: 'https://current.example', apiKey: 'synthetic-current-key', model: 'custom', customModel: 'ep-fixture-only' })
  assert.deepEqual(restoredConfig.doubaoParams, old.doubaoParams)
  assert.equal(restoredConfig.providers.gpt, current.providers.gpt)
  assert.equal(restoredConfig.gptParams, current.gptParams)
  assert.notEqual(current.activeProvider, 'doubao')
})

test('automatic selection stays automatic; older snapshots use their saved final prompt', async () => {
  const before = config()
  before.activeProvider = 'gpt'
  const saved = await snapshotGeneration(empty, before, 'automatic submitted text', null)
  assert.equal(prepareHistoryRestore(history('gpt', saved)).customPrompt, null)
  assert.equal(restoreGenerationConfig(config(), saved).providers.gpt.model, 'auto-latest')
  const previous = { ...saved }
  delete previous.customPrompt
  assert.equal(prepareHistoryRestore(history('gpt', previous)).customPrompt, 'automatic submitted text')
  assert.equal(prepareHistoryRestore(history('gpt', { ...saved, customPrompt: '' })).customPrompt, '')
})

test('legacy, broken or inconsistent snapshots restore only the original prompt', async () => {
  const saved = await snapshotGeneration(empty, config(), 'snapshot text', null)
  assert.deepEqual(prepareHistoryRestore(history('gpt')), { kind: 'prompt-only', prompt: 'submitted text', reason: 'legacy' })
  for (const row of [history('gpt', saved), history('gemini', null), history('gemini', { ...saved, recipe: { ...saved.recipe, portrait: { id: 'invented' } } })]) {
    assert.deepEqual(prepareHistoryRestore(row), { kind: 'prompt-only', prompt: 'submitted text', reason: 'invalid' })
  }
  assert.throws(() => prepareHistoryRestore({ ...history('gpt'), prompt: undefined }), /没有可还原/)
})

test('Comfy restore uses the editable original, node attachments and timeout, not submitted inputs or endpoint secrets', async () => {
  const before = config(), current = config()
  before.activeProvider = 'comfyui'
  before.imagePassMode = 'base64'
  before.sendStitchedSheet = true
  current.imagePassMode = 'url'
  const workflow = JSON.stringify({ '19': { class_type: 'LoadImage', inputs: { image: 'original.png' } }, '5': { class_type: 'Sampler', inputs: { seed: 10 } } })
  const identity = workflowIdentity(workflow)
  Object.assign(before.comfyuiParams, { workflowPreset: 'custom', workflowJson: workflow, timeoutSec: 420, randomizeSeed: true, parameterOverrides: { workflowId: identity, values: { '5': { seed: 31 } } } })
  const saved = await snapshotGeneration({ ...empty, workflowImagesIdentity: identity, workflowImages: { '19': { id: 'sheet', name: '设定集', role: 'character_sheet', url: png } } }, before, 'prompt', null)
  saved.submittedWorkflowJson = '{"5":{"inputs":{"seed":99999}}}'
  // Stored external input has stale extras, or an imported attempt to assign unrelated credentials.
  saved.models.comfyui.apiKey = 'synthetic-old-key'
  const restored = prepareHistoryRestore(history('comfyui', saved))
  assert.equal(restored.kind, 'full')
  current.providers.comfyui.apiKey = 'synthetic-current-comfy-key'
  const output = restoreGenerationConfig(current, restored.snapshot)
  assert.equal(output.providers.comfyui.apiKey, 'synthetic-current-comfy-key')
  assert.equal(output.comfyuiParams.timeoutSec, 420)
  assert.equal(output.comfyuiParams.randomizeSeed, true)
  assert.equal(JSON.parse(output.comfyuiParams.workflowJson)['5'].inputs.seed, 10)
  assert.equal(output.comfyuiParams.parameterOverrides.values['5'].seed, 31)
  assert.match(JSON.stringify(restored.snapshot.recipe.workflowImages), /设定集/)
  assert.equal(restored.snapshot.recipe.workflowImagesIdentity, workflowIdentity(output.comfyuiParams.workflowJson))
  assert.equal(output.comfyuiParams.parameterOverrides.workflowId, workflowIdentity(output.comfyuiParams.workflowJson))
  assert.doesNotMatch(JSON.stringify(output), /99999|synthetic-old-key/)
  assert.equal(output.imagePassMode, 'url')
  assert.equal(output.sendStitchedSheet, false)
})

test('redacting embedded workflow credentials cannot replay stale node bindings', async () => {
  const before = config()
  before.activeProvider = 'comfyui'
  const workflowJson = JSON.stringify({ '19': { class_type: 'LoadImage', inputs: { image: 'original.png', api_key: 'synthetic-workflow-secret' } } })
  const original = workflowIdentity(workflowJson)
  Object.assign(before.comfyuiParams, { workflowJson, parameterOverrides: { workflowId: original, values: { '19': { weight: 1 } } } })
  const saved = await snapshotGeneration({ ...empty, workflowImagesIdentity: original, workflowImages: { '19': { id: 'sheet', name: 'sheet', url: png } } }, before, 'prompt', null)
  const parsed = prepareHistoryRestore(history('comfyui', saved))
  assert.equal(parsed.kind, 'full')
  assert.equal(parsed.skippedWorkflowInputs, true)
  assert.equal(parsed.snapshot.recipe.workflowImages, undefined)
  assert.equal(parsed.snapshot.settings.comfyuiParams.parameterOverrides, undefined)
  assert.notEqual(workflowIdentity(parsed.snapshot.settings.comfyuiParams.workflowJson), original)
  assert.doesNotMatch(JSON.stringify(parsed), /synthetic-workflow-secret/)
})

test('backup import/export retains manual, automatic and legacy prompt semantics', async () => {
  const generated = await snapshotGeneration(empty, config(), 'generated', null)
  const entries = [history('gemini', generated), { ...history('gemini', { ...generated, customPrompt: 'manual' }), id: 'manual' }]
  const legacy = { ...generated }
  delete legacy.customPrompt
  entries.push({ ...history('gemini', legacy), id: 'legacy' })
  const read = parseStudioBackup(serializeStudioBackup(empty, entries))
  assert.deepEqual(read.history.map(row => row.snapshot.customPrompt), [null, 'manual', undefined])
  assert.deepEqual(read.history.map(row => prepareHistoryRestore(row).customPrompt), [null, 'manual', 'generated'])
})
