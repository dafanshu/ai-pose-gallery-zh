import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetUrl, storageKey, persistedValue, withoutSecrets, proxyUrl, transportHeaders } from '../src/lib/runtime.ts'
import { referenceImageUrl } from '../src/lib/recipeImages.ts'
import { parseStudioBackup, serializeStudioBackup, MAX_BACKUP_BYTES } from '../src/lib/studioBackup.ts'
import { generateCharacterImage, comfyFetch, defaultComfyBaseUrl, normalizeComfyBase, comfyCandidateUrls } from '../src/services/aiGenerator.ts'
import { resolveLatestOpenAIImageModel } from '../src/lib/openaiImageModels.ts'
const runtime = { basePath: '/api/ai-pose-studio', assetBase: '/api/ai-pose-studio/assets', proxyUrl: '/api/ai-pose-studio/proxy', comfyBase: '/api/ai-pose-studio/comfy', storageNamespace: 'ai-pose-harness-v1' }
function harness(t) {
  const old = globalThis.window
  globalThis.window = { __POSE_HARNESS__: runtime }
  t.after(() => { if (old === undefined) delete globalThis.window; else globalThis.window = old })
}
test('standalone asset, proxy and storage contracts are unchanged', () => {
  assert.equal(assetUrl('/img/test.webp'), '/img/test.webp')
  assert.equal(storageKey('pose_atlas_recipe_v3'), 'pose_atlas_recipe_v3')
  assert.equal(proxyUrl(), '/api/proxy')
  assert.equal(persistedValue({ apiKey: 'standalone' }).apiKey, 'standalone')
})
test('Harness isolates storage and resolves all gallery asset prefixes without rewriting external images', t => {
  harness(t)
  for (const name of ['data/pose-zh.json', 'img/depth/a.webp', 'thumbs/portrait/a.webp']) {
    assert.equal(assetUrl(name), `${runtime.assetBase}/${name}`)
    assert.equal(referenceImageUrl(name), `${runtime.assetBase}/${name}`)
    assert.equal(assetUrl(`/${name}`), `${runtime.assetBase}/${name}`)
  }
  for (const url of ['https://example.com/x.png', 'data:image/png;base64,AA==', 'blob:uploaded', '/api/ai-pose-studio/assets/img/a.png']) assert.equal(assetUrl(url), url)
  assert.equal(storageKey('recipe'), 'ai-pose-harness-v1:recipe')
  assert.equal(proxyUrl(), runtime.proxyUrl)
  assert.equal(defaultComfyBaseUrl(), runtime.comfyBase)
  assert.equal(normalizeComfyBase('http://localhost:8188'), runtime.comfyBase)
  assert.deepEqual(comfyCandidateUrls('http://localhost:8188'), [runtime.comfyBase])
})
test('Harness persistence strips nested credentials without mutating live state', t => {
  harness(t)
  const state = { providers: { gpt: { apiKey: 'SECRET', model: 'custom' } }, nested: [{ authorization: 'SECRET', safe: true }], workflowJson: '{"api_key":"SECRET","node":1}', baseUrl: 'https://user:SECRET@example.com/v1?api_key=SECRET'  }
  const saved = JSON.stringify(persistedValue(state))
  assert.ok(!saved.includes('SECRET'))
  assert.equal(state.providers.gpt.apiKey, 'SECRET')
  assert.equal(JSON.parse(withoutSecrets(state).workflowJson).node, 1)
})
const recipe = { portrait: null, costume: null, pose: null, extraImages: [] }
const history = [{ id: '1', createdAt: 1, provider: 'gpt', model: 'custom', prompt: 'test', imageUrl: 'data:image/png;base64,AA==', recipeSummary: 'test', apiKey: 'SECRET' }]
test('portable backup roundtrips recipes/history, strips secrets and excludes provider config', () => {
  const text = serializeStudioBackup(recipe, history)
  assert.ok(!text.includes('SECRET'))
  const restored = parseStudioBackup(text)
  assert.equal(restored.version, 1)
  assert.equal(restored.history.length, 1)
  assert.deepEqual(restored.recipe, recipe)
  assert.equal(restored.providers, undefined)
})
test('backup import rejects bad versions, oversized files, malformed entries and executable image URLs', () => {
  const good = JSON.parse(serializeStudioBackup(recipe, history))
  for (const value of [{ ...good, version: 2 }, { ...good, recipe: [] }, { ...good, history: [{ ...history[0], imageUrl: 'javascript:alert(1)' }] }, { ...good, history: [history[0], history[0]] }, { ...good, recipe: { ...recipe, extraImages: [1] } }]) assert.throws(() => parseStudioBackup(JSON.stringify(value)))
  assert.throws(() => parseStudioBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /50 MB/)
})
test('Harness model discovery forces authenticated same-origin proxy even when saved proxy option is off', async t => {
  harness(t)
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ data: [{ id: 'gpt-image-2' }] }) })
  assert.equal(await resolveLatestOpenAIImageModel({ baseUrl: 'https://api.openai.com/v1', apiKey: 'memory-only', useProxy: false }), 'gpt-image-2')
  assert.equal(calls[0].url, runtime.proxyUrl)
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(calls[0].init.headers.get('x-target-url'), 'https://api.openai.com/v1/models')
})
test('Harness generation forces same-origin proxy and retains abort signal', async t => {
  harness(t)
  const controller = new AbortController()
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ data: [{ b64_json: 'generated' }] }) })
  await generateCharacterImage({
    recipe: { ...recipe, extraImages: [{ id: 'ref', name: 'test', url: 'data:image/png;base64,AA==' }] }, prompt: 'test', signal: controller.signal,
    config: { activeProvider: 'gpt', imagePassMode: 'url', useProxy: false, providers: { gpt: { baseUrl: 'https://api.openai.com/v1', apiKey: 'memory-only', model: 'custom', customModel: 'manual' } }, gptParams: { endpointMode: 'images_edits_json', size: '1024x1536', quality: 'high', inputFidelity: 'omit', background: 'auto', outputFormat: 'png', moderation: 'auto' } },
  })
  assert.equal(calls[0].url, runtime.proxyUrl)
  assert.equal(calls[0].init.headers.get('Authorization'), null)
  assert.equal(calls[0].init.headers.get('x-studio-authorization'), 'Bearer memory-only')
  assert.equal(calls[0].init.signal, controller.signal)
  assert.equal(JSON.parse(calls[0].init.body).images[0].image_url, 'data:image/png;base64,AA==')
})

test('backup parser rejects the reported portrait object-render crash', () => {
  const malformed = { ...recipe, portrait: { id: 'a', 标题: 'a', 原图: 'img/a.png', 缩略图: 'thumbs/a.png', 发型名称: { malformed: true } } }
  assert.throws(() => parseStudioBackup(JSON.stringify({ format: 'pose-atlas-backup', version: 1, recipe: malformed, history: [] })))
})

test('backup shape validation covers every nested recipe, history and snapshot field', async () => {
  const { DEFAULT_API_CONFIG } = await import('../src/store/apiConfig.ts')
  const { uploadedReferences } = await import('../src/lib/recipeImages.ts')
  const refs = uploadedReferences('Reference', 'data:image/png;base64,AA==', 10, 10, 100)
  const fullRecipe = { ...refs, extraImages: [{ id: 'x', name: 'Reference', url: 'img/a.png', role: 'character_sheet' }], workflowImagesIdentity: 'workflow-1', workflowImages: { '1': { id: 'x', name: 'Reference', url: 'img/a.png' } } }
  fullRecipe.pose.useDepth = true
  fullRecipe.costume.views = [{ id: 'front', label: 'Front', 原图: 'img/a.png', 预览图: 'img/a.png', 缩略图: 'thumbs/a.png' }]
  fullRecipe.costume.selectedView = 'front'
  fullRecipe.costume.一级分类 = '现实'
  fullRecipe.costume.来源 = 'test'
  fullRecipe.costume.来源地址 = 'https://example.com'
  fullRecipe.costume.日文名称 = 'test'
  fullRecipe.costume.敏感 = false
  const { providers, ...settings } = structuredClone(DEFAULT_API_CONFIG)
  settings.comfyuiParams.parameterOverrides = { workflowId: 'workflow-1', values: { '1': { text: 'Prompt', boolean: true, number: 1 } } }
  const models = Object.fromEntries(Object.entries(providers).map(([key, value]) => [key, { model: value.model, customModel: value.customModel }]))
  const item = { ...history[0], snapshot: { recipe: fullRecipe, prompt: 'test', settings, models, submittedWorkflowJson: '{}' } }
  const valid = { format: 'pose-atlas-backup', version: 1, recipe: fullRecipe, history: [item] }
  const clean = parseStudioBackup(JSON.stringify(valid))
  assert.equal(clean.recipe.portrait.发型名称, 'Reference')
  assert.equal(clean.history[0].snapshot.settings.gptParams.endpointMode, DEFAULT_API_CONFIG.gptParams.endpointMode)
  let checked = 0
  function visit(value, path = []) {
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        // apiKey is intentionally unknown and discarded, even if malformed.
        if (key === 'apiKey') continue
        const nextPath = [...path, key]
        const damaged = structuredClone(valid)
        let target = damaged
        for (const segment of path) target = target[segment]
        target[key] = typeof child === 'object' && child !== null ? 'invalid-object' : { malformed: true }
        assert.throws(() => parseStudioBackup(JSON.stringify(damaged)), `accepts wrong type at ${nextPath.join('.')}`)
        checked++
        visit(child, nextPath)
      }
    }
  }
  visit(valid)
  assert.ok(checked > 150, `checked ${checked} nested fields`)
  valid.recipe.unrecognized = { dangerous: 'javascript:alert(1)' }
  valid.history[0].snapshot.settings.providers = { gpt: { apiKey: 'SECRET' } }
  valid.history[0].snapshot.models.gpt.baseUrl = { malicious: true }
  const sanitized = parseStudioBackup(JSON.stringify(valid))
  assert.equal(sanitized.recipe.unrecognized, undefined)
  assert.equal(sanitized.history[0].snapshot.settings.providers, undefined)
  assert.equal(sanitized.history[0].snapshot.models.gpt.baseUrl, undefined)
  assert.ok(!JSON.stringify(sanitized).includes('SECRET'))
})


test('provider header mapping is Harness-only and removes the original auth headers', t => {
  const direct = transportHeaders({ Authorization: 'Bearer provider', 'x-goog-api-key': 'google', 'Content-Type': 'application/json' })
  assert.equal(direct.get('authorization'), 'Bearer provider')
  assert.equal(direct.get('x-goog-api-key'), 'google')
  harness(t)
  const mapped = transportHeaders(direct)
  assert.equal(mapped.get('authorization'), null)
  assert.equal(mapped.get('x-goog-api-key'), null)
  assert.equal(mapped.get('x-studio-authorization'), 'Bearer provider')
  assert.equal(mapped.get('x-studio-goog-api-key'), 'google')
  assert.equal(mapped.get('content-type'), 'application/json')
  assert.equal(direct.get('authorization'), 'Bearer provider')
})
test('Comfy HTTP uses the separate provider credential header in Harness', async t => {
  harness(t)
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ system: {} }) })
  await comfyFetch(runtime.comfyBase, '/system_stats', {}, 'comfy-provider-key')
  assert.equal(calls[0].init.headers.get('authorization'), null)
  assert.equal(calls[0].init.headers.get('x-studio-authorization'), 'Bearer comfy-provider-key')
})
