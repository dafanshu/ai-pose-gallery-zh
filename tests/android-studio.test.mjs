import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANDROID_DEFAULT_IMAGE_MODEL, androidFormConfig, androidGenerationRequest, androidReferenceImages, androidStudio, isAndroidStudio } from '../src/lib/androidStudio.ts'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'
import { uploadedReferences } from '../src/lib/recipeImages.ts'

const png = 'data:image/png;base64,iVBORw0KGgo='
const empty = { portrait: null, costume: null, pose: null, extraImages: [] }
const config = () => structuredClone(DEFAULT_API_CONFIG)

test('Android normalizes restored settings without inheriting a desktop host, key or incompatible controls', () => {
  const initial = config()
  initial.activeProvider = 'doubao'
  initial.providers.gpt = { model: 'custom', customModel: 'third-party-model', baseUrl: 'https://third-party.invalid', apiKey: 'synthetic-key' }
  Object.assign(initial.gptParams, { endpointMode: 'chat', quality: 'xhigh', size: '1024x1024', inputFidelity: 'high', outputFormat: 'jpeg' })
  const fresh = androidFormConfig(initial)
  assert.equal(fresh.activeProvider, 'gpt')
  assert.deepEqual(fresh.providers.gpt, { model: ANDROID_DEFAULT_IMAGE_MODEL, customModel: '', baseUrl: 'https://api.openai.com', apiKey: '' })
  assert.deepEqual(fresh.gptParams, { endpointMode: 'images_edits', size: '1024x1024', quality: 'medium', inputFidelity: 'omit', background: 'auto', outputFormat: 'png', moderation: 'auto' })
  assert.equal(initial.activeProvider, 'doubao')
})

test('native request sends only local allowed inputs in recipe order, never a key or an endpoint', () => {
  const files = ['aA==', 'aQ==', 'ag==', 'aw=='].map(content => `data:image/png;base64,${content}`)
  const refs = {
    portrait: uploadedReferences('portrait', files[0], 1, 1, 0).portrait,
    costume: uploadedReferences('costume', files[1], 1, 1, 0).costume,
    pose: uploadedReferences('pose', files[2], 1, 1, 0).pose,
    extraImages: [{ id: 'extra', name: 'extra', url: files[3] }],
  }
  assert.deepEqual(androidGenerationRequest(refs, androidFormConfig(config()), 'compose test'), {
    model: ANDROID_DEFAULT_IMAGE_MODEL, prompt: 'compose test', images: files, size: '1024x1536', quality: 'high',
  })
})

test('desktop asset paths, remote URLs, SVG, missing refs and oversized ref sets do not fall back to network', () => {
  assert.throws(() => androidReferenceImages(empty), /1–6/)
  for (const url of ['https://third-party.invalid/img.png', 'img/example.jpg', 'data:image/svg+xml;base64,iVBORw0KGgo=']) {
    assert.throws(() => androidReferenceImages({ ...empty, extraImages: [{ id: 'external', name: 'external', url }] }), /从相册重新选择/)
  }
  assert.throws(() => androidReferenceImages({ ...empty, extraImages: Array.from({length: 7}, (_, i) => ({ id: String(i), name: 'too many', url: png })) }), /1–6/)
  assert.throws(() => androidGenerationRequest({ ...empty, extraImages: [{ id: 'valid', name: 'valid', url: png }] }, config(), 'test'), /安卓版支持/)
})

test('existing web and Harness builds cannot access the Android bridge', async () => {
  assert.equal(isAndroidStudio(), false)
  await assert.rejects(androidStudio.keyStatus(), /需要安装并打开安卓版/)
})

test('Android bridge uses native platform only and the mobile namespace never persists key fields', async () => {
  const calls = []
  const fakeBridge = {
    keyStatus: async () => ({ configured: true }),
    generate: async input => { calls.push(input); return {dataUrl: png} },
  }
  globalThis.__ANDROID_STUDIO__ = true
  globalThis.window = { Capacitor: { getPlatform: () => 'android', Plugins: { RoleStudio: fakeBridge } } }
  try {
    assert.equal(isAndroidStudio(), true)
    const { persistedValue, storageKey } = await import('../src/lib/runtime.ts')
    assert.equal(storageKey('draft'), 'android-personal:draft')
    assert.deepEqual(persistedValue({apiKey: 'detached', preferences: {quality: 'medium', authorization: 'secret'}}), {preferences: {quality: 'medium'}})
    assert.deepEqual(await androidStudio.keyStatus(), { configured: true })
    const request = androidGenerationRequest({ ...empty, extraImages: [{ id: 'valid', name: 'valid', url: png }] }, androidFormConfig(config()), 'test')
    assert.deepEqual(await androidStudio.generate(request), {dataUrl: png})
    assert.deepEqual(calls, [request])
    window.Capacitor.getPlatform = () => 'web'
    await assert.rejects(androidStudio.keyStatus(), /需要安装并打开安卓版/)
  } finally {
    delete globalThis.window
    delete globalThis.__ANDROID_STUDIO__
  }
})
