import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AUTOMATIC_GPT_IMAGE_MODEL, selectLatestKnownOpenAIImageModel, resolveLatestOpenAIImageModel } from '../src/lib/openaiImageModels.ts'
import { DEFAULT_API_CONFIG, mergeStoredConfig } from '../src/store/apiConfig.ts'
import { generateCharacterImage, PROVIDER_META } from '../src/services/aiGenerator.ts'

const latest = 'gpt-image-2.6-sunburst'
const discoveryConfig = { baseUrl: 'https://vendor.example/v1', apiKey: 'vendor-key', useProxy: false }
const recipe = { portrait: null, costume: null, pose: null, extraImages: [{ id: 'ref', name: 'Ref', url: 'data:image/png;base64,aGVsbG8=' }] }

test('catalogue order ignores list order, creation time, unknown aliases and fake future versions', () => {
  const data = [{ id: 'gpt-image-99', created: 9999999999 }, { id: 'gpt-image-2.6-flare', created: 9999999999 }, { id: 'gpt-image-2', created: 9999999999 }, { id: latest, created: 1 }]
  assert.equal(selectLatestKnownOpenAIImageModel(data), latest)
  assert.equal(selectLatestKnownOpenAIImageModel(data.toReversed()), latest)
  assert.equal(selectLatestKnownOpenAIImageModel([{ id: 'vendor-' + latest }, { id: 'chatgpt-image-latest' }, { id: 'gpt-image-2.5' }, { id: 'gpt-image-1' }]), undefined)
  assert.equal(selectLatestKnownOpenAIImageModel([null, {}, 'invalid', { id: 1 }]), undefined)
})

test('shutdown entries are excluded and an explicitly supported older model can be selected', () => {
  const now = Date.parse('2026-11-13T12:00:00Z')
  assert.equal(selectLatestKnownOpenAIImageModel([{ id: latest, shutdown_date: '2026-11-12' }, { id: 'gpt-image-2.6-flare', shutdown_date: null }], now), 'gpt-image-2.6-flare')
  assert.equal(selectLatestKnownOpenAIImageModel([{ id: latest, shutdown_date: now / 1000 }], now), undefined)
  assert.equal(selectLatestKnownOpenAIImageModel([{ id: latest, shutdown_date: 'invalid' }], now), undefined)
  assert.equal(selectLatestKnownOpenAIImageModel([{ id: latest, shutdown_date: '2026-11-14' }], now), latest)
  assert.equal(selectLatestKnownOpenAIImageModel([{ id: 'gpt-image-1.5' }, { id: 'gpt-image-2' }], now), 'gpt-image-2')
})

test('fresh defaults opt into compatibility and automatic discovery', () => {
  const config = mergeStoredConfig({})
  assert.equal(config.gptParams.inputFidelity, 'omit')
  assert.equal(config.providers.gpt.model, AUTOMATIC_GPT_IMAGE_MODEL)
  assert.equal(PROVIDER_META.gpt.models[0].value, AUTOMATIC_GPT_IMAGE_MODEL)
})

test('stored models, custom endpoint/key and high/low survive hydration and repeated changes', () => {
  for (const model of ['gpt-image-2.5', 'gpt-image-1.5', 'custom', AUTOMATIC_GPT_IMAGE_MODEL]) {
    for (const inputFidelity of ['high', 'low', 'omit']) {
      const stored = { providers: { gpt: { model, customModel: 'vendor-model', baseUrl: 'https://vendor.example/v1', apiKey: 'vendor-key' } }, gptParams: { inputFidelity } }
      const config = mergeStoredConfig(JSON.parse(JSON.stringify(stored)))
      assert.deepEqual(config.providers.gpt, stored.providers.gpt)
      assert.equal(config.gptParams.inputFidelity, inputFidelity)
      assert.equal(config.gptParams.endpointMode, 'images_edits_json')
      const updated = { ...config, gptParams: { ...config.gptParams, inputFidelity: 'omit' } }
      assert.equal(mergeStoredConfig(JSON.parse(JSON.stringify(updated))).gptParams.inputFidelity, 'omit')
    }
  }
  assert.equal(DEFAULT_API_CONFIG.gptParams.inputFidelity, 'omit')
})

for (const useProxy of [false, true]) {
  test(`discovery uses current credentials and endpoint only (${useProxy ? 'proxy' : 'direct'})`, async (t) => {
    const calls = []
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url, init })
      return Response.json({ data: [{ id: latest }] })
    })
    assert.equal(await resolveLatestOpenAIImageModel({ ...discoveryConfig, useProxy }), latest)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, useProxy ? '/api/proxy' : 'https://vendor.example/v1/models')
    assert.equal(calls[0].init.method, 'GET')
    assert.equal(calls[0].init.redirect, 'error')
    assert.equal(calls[0].init.cache, 'no-store')
    assert.equal(calls[0].init.credentials, 'omit')
    assert.equal(calls[0].init.body, undefined)
    assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer vendor-key')
    if (useProxy) assert.equal(calls[0].init.headers.get('x-target-url'), 'https://vendor.example/v1/models')
  })
}

test('base URLs normalize once and credential-bearing/query URLs are rejected before fetch', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => { calls.push(url); return Response.json({ data: [{ id: latest }] }) })
  for (const baseUrl of ['https://vendor.example', 'https://vendor.example/', 'https://vendor.example/v1///']) {
    await resolveLatestOpenAIImageModel({ ...discoveryConfig, baseUrl })
  }
  assert.deepEqual(calls, Array(3).fill('https://vendor.example/v1/models'))
  for (const baseUrl of ['https://user:pass@vendor.example/v1', 'https://vendor.example/v1?key=value', 'https://vendor.example/v1#secret', 'ftp://vendor.example']) {
    await assert.rejects(resolveLatestOpenAIImageModel({ ...discoveryConfig, baseUrl }), /Base URL/)
  }
  assert.equal(calls.length, 3)
})

for (const [label, response, message] of [
  ['unauthorized', () => Response.json({}, { status: 401 }), /HTTP 401/],
  ['proxy denied', () => Response.json({}, { status: 403 }), /HTTP 403/],
  ['no models endpoint', () => Response.json({}, { status: 404 }), /HTTP 404/],
  ['bad JSON', () => new Response('<html>not JSON</html>'), /有效 JSON/],
  ['bad shape', () => Response.json({ models: [] }), /data 数组/],
  ['empty list', () => Response.json({ data: [] }), /没有可自动选择/],
  ['unknown only', () => Response.json({ data: [{ id: 'vendor-image-99' }] }), /手动选择/],
]) {
  test(`discovery reports actionable failure: ${label}`, async (t) => {
    t.mock.method(globalThis, 'fetch', response)
    await assert.rejects(resolveLatestOpenAIImageModel(discoveryConfig), message)
  })
}

test('network/redirect failures and cancellation never choose a fallback model', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed') })
  await assert.rejects(resolveLatestOpenAIImageModel(discoveryConfig), /网络、跨域、重定向或超时/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(resolveLatestOpenAIImageModel({ ...discoveryConfig, signal: controller.signal }), { name: 'AbortError' })
})

test('cancellation while reading models is preserved and no endpoint/key cache is reused', async (t) => {
  const controller = new AbortController()
  const mock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => { controller.abort(); throw new Error('body interrupted') },
  }))
  await assert.rejects(resolveLatestOpenAIImageModel({ ...discoveryConfig, signal: controller.signal }), { name: 'AbortError' })
  const calls = []
  mock.mock.mockImplementation(async (url, init) => {
    calls.push({ url, auth: init.headers.get('Authorization') })
    return Response.json({ data: [{ id: latest }] })
  })
  await resolveLatestOpenAIImageModel(discoveryConfig)
  await resolveLatestOpenAIImageModel({ ...discoveryConfig, baseUrl: 'https://other.example/v1', apiKey: 'other-key' })
  assert.deepEqual(calls, [
    { url: 'https://vendor.example/v1/models', auth: 'Bearer vendor-key' },
    { url: 'https://other.example/v1/models', auth: 'Bearer other-key' },
  ])
})

for (const endpointMode of ['images_edits_json', 'images_edits']) {
  for (const useProxy of [false, true]) {
    test(`generation resolves actual model without mutating configuration: ${endpointMode}/${useProxy}`, async (t) => {
      const config = structuredClone(DEFAULT_API_CONFIG)
      config.activeProvider = 'gpt'
      config.providers.gpt = { ...config.providers.gpt, ...discoveryConfig, model: AUTOMATIC_GPT_IMAGE_MODEL }
      config.gptParams.endpointMode = endpointMode
      config.useProxy = useProxy
      const before = JSON.stringify(config)
      const calls = []
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        calls.push({ url, init })
        return init.method === 'GET' ? Response.json({ data: [{ id: latest }] }) : Response.json({ data: [{ b64_json: 'generated' }] })
      })
      const result = await generateCharacterImage({ recipe, prompt: 'Test', config })
      assert.equal(result.modelUsed, latest)
      assert.equal(calls.length, 2)
      const body = calls[1].init.body
      const fields = body instanceof FormData ? Object.fromEntries(body) : JSON.parse(body)
      assert.equal(fields.model, latest)
      assert.equal(Object.hasOwn(fields, 'input_fidelity'), false)
      assert.equal(JSON.stringify(config), before)
    })
  }
}

for (const endpointMode of ['responses', 'chat']) {
  test(`automatic mode rejects unsupported ${endpointMode} before network access`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch') })
    const config = structuredClone(DEFAULT_API_CONFIG)
    config.activeProvider = 'gpt'
    config.providers.gpt.apiKey = 'test'
    config.gptParams.endpointMode = endpointMode
    await assert.rejects(generateCharacterImage({ recipe, prompt: 'Test', config }), /仅适用于/)
    assert.equal(fetch.mock.callCount(), 0)
  })
}

test('discovery failure does not submit a generation request or overwrite a saved model', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ data: [] }) })
  const config = structuredClone(DEFAULT_API_CONFIG)
  config.activeProvider = 'gpt'
  config.providers.gpt.apiKey = 'test'
  const before = JSON.stringify(config)
  await assert.rejects(generateCharacterImage({ recipe, prompt: 'Test', config }), /手动选择/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(JSON.stringify(config), before)
})
