import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectDoubaoImageModels, doubaoModelOptions, doubaoModelsUrl, fetchDoubaoImageModels } from '../src/lib/doubaoImageModels.ts'

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
  assert.deepEqual(selectDoubaoImageModels(data), [
    { id: latest, retiring: false, nameOnly: false },
    { id: 'provider-image-edit-v2', retiring: true, nameOnly: false },
    { id: 'doubao-seedream-next', retiring: false, nameOnly: true },
  ])
  assert.deepEqual(selectDoubaoImageModels([{ ...row, id: 'older', created: 1 }, { ...row, created: 9 }]).map(x => x.id), ['older', latest])
})

test('sparse Seedream fallback never overrides contradictory or malformed metadata', () => {
  for (const bad of [{ domain: 'Chat' }, { task_type: ['TextToImage'] }, { task_type: 'ImageToImage' }, { modalities: { output_modalities: ['text'] } }, { modalities: { output_modalities: 'image' } }, { status: 'Disabled' }, { api_supported: false }]) {
    assert.deepEqual(selectDoubaoImageModels([{ id: latest, ...bad }]), [])
  }
})

test('model options preserve saved/default/custom choices without duplicates or auto-selection', () => {
  const defaults = [{ value: 'legacy', label: 'legacy' }, { value: 'custom', label: 'custom' }]
  const discovered = selectDoubaoImageModels([row])
  const options = doubaoModelOptions(discovered, defaults, 'saved-model', true)
  assert.deepEqual(options.map(x => x.value), [latest, 'saved-model', 'legacy', 'custom'])
  assert.match(options[1].label, /当前配置.*未在最新列表确认/)
  assert.match(options[2].label, /内置参考.*未在最新列表确认/)
  assert.deepEqual(doubaoModelOptions(discovered, defaults, latest, true).map(x => x.value), [latest, 'legacy', 'custom'])
  assert.equal(doubaoModelOptions([], defaults, 'custom', false).at(-1).value, 'custom')
  assert.equal(defaults.length, 2)
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
  assert.equal((await fetchDoubaoImageModels({ ...config, useProxy }))[0].id, latest)
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
  ['empty', () => Response.json({ data: [] }), /没有可识别/],
  ['vision only', () => Response.json({ data: [{ id: 'doubao-vision-pro', modalities: { input_modalities: ['image'], output_modalities: ['text'] } }] }), /没有可识别/],
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
  assert.equal((await fetchDoubaoImageModels(config))[0].id, 'model-1')
  assert.equal((await fetchDoubaoImageModels({ ...config, baseUrl: 'https://other.example/v1', apiKey: 'other-synthetic' }))[0].id, 'model-2')
  assert.deepEqual(keys, ['Bearer synthetic-ark-key', 'Bearer other-synthetic'])
})

test('network errors are bounded and do not expose thrown response details', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private-key-in-error') })
  await assert.rejects(fetchDoubaoImageModels(config), error => { assert.match(error.message, /网络、跨域、重定向或 15 秒超时/); assert.doesNotMatch(error.message, /private-key/); return true })
})

test('empty official domain is treated as absent, not a contradictory capability', () => {
  assert.deepEqual(selectDoubaoImageModels([{ ...row, domain: '' }]), [{ id: latest, retiring: false, nameOnly: false }])
  assert.deepEqual(selectDoubaoImageModels([{ id: latest, domain: '' }]), [{ id: latest, retiring: false, nameOnly: true }])
})
