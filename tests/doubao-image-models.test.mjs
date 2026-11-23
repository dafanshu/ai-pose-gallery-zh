import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectDoubaoImageModels, doubaoModelOptions, doubaoModelsUrl, fetchDoubaoImageModels, OFFICIAL_DOUBAO_IMAGE_MODELS } from '../src/lib/doubaoImageModels.ts'

import { DEFAULT_API_CONFIG, mergeStoredConfig } from '../src/store/apiConfig.ts'

const latest = 'doubao-seedream-5-5-261028'
const row = { id: latest, domain: 'ImageGeneration', task_type: ['TextToImage', 'ImageToImage'], modalities: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, status: 'Published', api_supported: { undocumented: 'not interpreted' } }
const config = { baseUrl: 'https://ark.cn-beijing.volces.com', apiKey: 'synthetic-ark-key', useProxy: false }

test('Doubao discovery keeps API order and explicit image capabilities, not vision input', () => {
  const data = [row, { ...row, id: 'provider-image-edit-v2', status: 'Retiring' }, { id: 'doubao-seedream-next' },
    { id: 'doubao-vision-pro', modalities: { input_modalities: ['image'], output_modalities: ['text'] } },
    { ...row, id: 'text-only-image', task_type: ['TextToImage'] },
    { ...row, id: 'expired', status: 'Retired' }, { ...row, id: 'disabled', api_supported: false },
    { ...row, id: 'wrong-domain', domain: 'VideoGeneration' }, { id: 'random-image-name' },
    { id: 'seedream-chat', domain: 'Chat' }, null, [], { ...row, id: '<unsafe>' }, { ...row, id: 'custom' }, row]
  assert.deepEqual(selectDoubaoImageModels(data).models, [
    { id: latest, retiring: false, evidence: 'metadata' },
    { id: 'provider-image-edit-v2', retiring: true, evidence: 'metadata' },
    { id: 'doubao-seedream-next', retiring: false, evidence: 'name' },
  ])
  assert.deepEqual(selectDoubaoImageModels([{ ...row, id: 'older', created: 1 }, { ...row, created: 9 }]).models.map(x => x.id), ['older', latest])
})

test('exact official IDs use documented capabilities for omitted, null or empty fields only', () => {
  for (const missing of [{}, { domain: '', task_type: [], modalities: { output_modalities: [] } }, { domain: null, task_type: null, modalities: { output_modalities: null } }]) {
    assert.deepEqual(selectDoubaoImageModels([{ id: latest, ...missing }]), { models: [{ id: latest, retiring: false, evidence: 'official' }], rejectedOfficialIds: [] })
  }
  assert.deepEqual(selectDoubaoImageModels([{ ...row, domain: '' }]).models, [{ id: latest, retiring: false, evidence: 'official' }])
  for (const id of ['doubao-seedream-9-0-999999', 'unknown-image-edit']) {
    assert.deepEqual(selectDoubaoImageModels([{ id, domain: 'ImageGeneration', task_type: [], modalities: { output_modalities: [] } }]).models, [])
  }
})

test('official and sparse-name evidence never override contradictory, disabled or malformed fields', () => {
  for (const bad of [{ domain: 'VLM' }, { task_type: ['TextToImage'] }, { task_type: 'ImageToImage' }, { modalities: { output_modalities: ['text'] } }, { modalities: { output_modalities: 'image' } }, { modalities: [] }, { status: 'Disabled' }, { status: 'Retired' }, { api_supported: false }]) {
    const discovered = selectDoubaoImageModels([{ id: latest, ...bad }, row, { id: 'doubao-seedream-next', ...bad }])
    assert.deepEqual(discovered, { models: [], rejectedOfficialIds: [latest] })
    const options = doubaoModelOptions(discovered, [{ value: latest, label: 'old duplicate' }], latest)
    assert.equal(options.official.find(x => x.value === latest).disabled, true)
    assert.deepEqual(options.account, [])
    assert.deepEqual(options.existing, [])
    assert.equal([...options.official, ...options.existing].filter(x => x.value === latest).length, 1)
    assert.equal(mergeStoredConfig({ providers: { doubao: { model: latest } } }).providers.doubao.model, latest)
  }
})

test('documented exact IDs are available without a query but never labeled live; defaults and manual stay unchanged', () => {
  const defaults = [{ value: 'legacy', label: 'legacy' }, { value: latest, label: 'duplicate' }, { value: 'custom', label: 'custom' }]
  const ids = OFFICIAL_DOUBAO_IMAGE_MODELS.map(x => x.value)
  assert.deepEqual(ids, [latest, 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915', 'doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128', 'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'])
  const options = doubaoModelOptions(null, defaults, 'saved-model')
  assert.deepEqual(options.account, [])
  assert.deepEqual(options.official.map(x => x.value), ids)
  assert.ok(options.official.every(x => !x.disabled))
  assert.deepEqual(options.existing.map(x => x.value), ['saved-model', 'legacy'])
  assert.match(options.existing[0].label, /当前配置/)
  assert.equal(options.manual.value, 'custom')
  assert.equal(DEFAULT_API_CONFIG.providers.doubao.model, 'doubao-seedream-5-0')
  assert.equal(mergeStoredConfig({ providers: { doubao: { model: 'custom', customModel: 'ep-fixture' } } }).providers.doubao.customModel, 'ep-fixture')
  assert.equal(defaults.length, 3)
})

test('successful discovery deduplicates official entries while preserving prior and retiring choices', () => {
  const defaults = OFFICIAL_DOUBAO_IMAGE_MODELS.map(x => ({ ...x }))
  const discovered = selectDoubaoImageModels([{ ...row, status: 'Retiring' }, { id: 'doubao-seedream-next' }, { id: 'doubao-seedream-5-0-flash-260915', domain: '' }])
  const options = doubaoModelOptions(discovered, defaults, latest)
  assert.deepEqual(options.account.map(x => x.value), [latest, 'doubao-seedream-next', 'doubao-seedream-5-0-flash-260915'])
  assert.match(options.account[0].label, /即将下线/)
  assert.match(options.account[1].label, /名称候选/)
  assert.match(options.account[2].label, /能力参照官方文档/)
  assert.equal(options.official.length, 5)
  assert.equal(options.existing.length, 0)
  const values = [...options.account, ...options.official, ...options.existing, options.manual].map(x => x.value)
  assert.equal(values.length, new Set(values).size)
})

test('official origin, API root and full generation endpoint normalize to one model-list endpoint', () => {
  for (const base of ['', '/', '/api/v3', '/api/v3///', '/api/v3/images/generations']) assert.equal(doubaoModelsUrl(config.baseUrl + base), config.baseUrl + '/api/v3/models')
  assert.equal(doubaoModelsUrl('https://compatible.example/v1'), 'https://compatible.example/v1/models')
  assert.equal(doubaoModelsUrl('https://compatible.example/v1/images/generations/'), 'https://compatible.example/v1/models')
  for (const url of ['https://u:p@example.com', 'https://example.com?key=secret', 'https://example.com#secret', 'file:///private', 'not a URL']) assert.throws(() => doubaoModelsUrl(url), /Base URL/)
})

for (const useProxy of [false, true]) test(`Doubao refresh uses current connection only; no generation request or response cache (${useProxy ? 'proxy' : 'direct'})`, async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ object: 'list', data: [row] }) })
  assert.equal((await fetchDoubaoImageModels({ ...config, useProxy })).models[0].id, latest)
  const { url, init } = calls[0]
  assert.equal(calls.length, 1)
  assert.equal(url, useProxy ? '/api/proxy' : config.baseUrl + '/api/v3/models')
  assert.equal(init.method, 'GET'); assert.equal(init.body, undefined)
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store')
  assert.equal(init.headers.get('authorization'), 'Bearer synthetic-ark-key')
  if (useProxy) assert.equal(init.headers.get('x-target-url'), config.baseUrl + '/api/v3/models')
})

test('Harness refresh forces same-origin owner proxy and separates provider auth', async t => {
  const old = globalThis.window
  globalThis.window = { __POSE_HARNESS__: { proxyUrl: '/api/ai-pose-studio/proxy' } }
  t.after(() => { if (old === undefined) delete globalThis.window; else globalThis.window = old })
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ data: [row] }) })
  await fetchDoubaoImageModels(config)
  assert.equal(calls[0].url, '/api/ai-pose-studio/proxy')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(calls[0].init.headers.get('authorization'), null)
  assert.equal(calls[0].init.headers.get('x-studio-authorization'), 'Bearer synthetic-ark-key')
  assert.equal(calls[0].init.headers.get('x-target-url'), config.baseUrl + '/api/v3/models')
})

for (const [status, reason] of [[401, /Key/], [403, /白名单/], [404, /不支持模型列表/], [405, /不支持模型列表/], [429, /请求受限/], [500, /服务状态/]]) test(`HTTP ${status} has actionable error without reflecting upstream credentials/body`, async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'DO-NOT-REFLECT-synthetic-secret' } }, { status }))
  await assert.rejects(fetchDoubaoImageModels(config), error => { assert.match(error.message, new RegExp('HTTP ' + status)); assert.match(error.message, reason); assert.match(error.message, /当前模型保持不变/); assert.doesNotMatch(error.message, /DO-NOT-REFLECT|synthetic-secret/); return true })
})

for (const [label, response, expected] of [
  ['bad JSON', () => new Response('<html>private</html>'), /有效 JSON/],
  ['wrong shape', () => Response.json({ items: [row] }), /data 数组/],
]) test(`invalid model discovery: ${label}`, async t => {
  t.mock.method(globalThis, 'fetch', response)
  await assert.rejects(fetchDoubaoImageModels(config), expected)
})

test('blank key, invalid URL and pre-cancelled refresh do not reach the network', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ data: [row] }) })
  await assert.rejects(fetchDoubaoImageModels({ ...config, apiKey: '   ' }), /输入或解锁/)
  await assert.rejects(fetchDoubaoImageModels({ ...config, baseUrl: 'https://example.com?key=secret' }), /Base URL/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(fetchDoubaoImageModels({ ...config, signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 0)
})

test('late network/body results stay cancelled; successive connections never share a cached list', async t => {
  let controller = new AbortController()
  const mock = t.mock.method(globalThis, 'fetch', async () => { controller.abort(); return Response.json({ data: [row] }) })
  await assert.rejects(fetchDoubaoImageModels({ ...config, signal: controller.signal }), { name: 'AbortError' })
  controller = new AbortController()
  mock.mock.mockImplementation(async () => ({ ok: true, json: async () => { controller.abort(); return { data: [row] } } }))
  await assert.rejects(fetchDoubaoImageModels({ ...config, signal: controller.signal }), { name: 'AbortError' })
  const keys = []
  mock.mock.mockImplementation(async (_url, init) => { keys.push(init.headers.get('authorization')); return Response.json({ data: [{ ...row, id: 'model-' + keys.length }] }) })
  assert.equal((await fetchDoubaoImageModels(config)).models[0].id, 'model-1')
  assert.equal((await fetchDoubaoImageModels({ ...config, baseUrl: 'https://other.example/v1', apiKey: 'other-synthetic' })).models[0].id, 'model-2')
  assert.deepEqual(keys, ['Bearer synthetic-ark-key', 'Bearer other-synthetic'])
})

test('network errors are bounded and do not expose thrown response details', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private-key-in-error') })
  await assert.rejects(fetchDoubaoImageModels(config), error => { assert.match(error.message, /网络、跨域、重定向或 15 秒超时/); assert.doesNotMatch(error.message, /private-key/); return true })
})

test('empty or fully filtered HTTP 200 is distinct from a failed refresh; docs stay selectable', async t => {
  const data = [[], [{ id: 'doubao-vision-pro', modalities: { input_modalities: ['image'], output_modalities: ['text'] } }]]
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ data: data.shift() }))
  for (let i = 0; i < 2; i++) {
    const result = await fetchDoubaoImageModels(config)
    assert.deepEqual(result, { models: [], rejectedOfficialIds: [] })
    const options = doubaoModelOptions(result, [], 'custom')
    assert.equal(options.official[0].value, latest)
    assert.equal(options.official[0].disabled, false)
    assert.equal(options.account.length, 0)
  }
  assert.equal(mock.mock.callCount(), 2)
})
