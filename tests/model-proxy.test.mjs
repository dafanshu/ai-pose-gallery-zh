import assert from 'node:assert/strict'
import { test } from 'node:test'
import { onRequestGet, onRequestPost } from '../functions/api/proxy.ts'
import worker from '../worker.ts'

function request(target, method = 'GET') {
  return new Request('https://gallery.example/api/proxy', {
    method,
    headers: { 'x-target-url': target, Authorization: 'Bearer test-only', Cookie: 'never-forward', 'x-unrelated': 'never-forward' },
  })
}

test('GET model proxy preserves allowlist, auth and upstream status without forwarding other headers', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ data: [] }, { status: 200 }) })
  const result = await onRequestGet({ request: request('https://api.openai.com/v1/models') })
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('Cache-Control'), 'no-store')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.body, undefined)
  assert.deepEqual([...calls[0].init.headers], [['authorization', 'Bearer test-only']])
})

test('GET proxy denies unknown origins, private hosts, alternate paths, query, fragment and embedded credentials', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not forward') })
  for (const target of [
    'https://unknown.example/v1/models', 'http://api.openai.com/v1/models', 'http://127.0.0.1/v1/models',
    'https://api.openai.com/v1/files', 'https://api.openai.com/v1/models/', 'https://api.openai.com/custom/v1/models',
    'https://api.openai.com/v1/models?key=value', 'https://api.openai.com/v1/models#fragment',
    'https://user:pass@api.openai.com/v1/models', 'https://api.openai.com.evil.example/v1/models',
  ]) assert.equal((await onRequestGet({ request: request(target) })).status, 403, target)
  assert.equal((await onRequestGet({ request: request('invalid') })).status, 400)
  assert.equal(mock.mock.callCount(), 0)
})

test('GET proxy uses existing configured allowlist without broadening it', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => { calls.push(url); return Response.json({ data: [] }) })
  const env = { PROXY_ALLOWED_ORIGINS: 'https://vendor.example' }
  assert.equal((await onRequestGet({ request: request('https://vendor.example/v1/models'), env })).status, 200)
  assert.equal((await onRequestGet({ request: request('https://other.example/v1/models'), env })).status, 403)
  assert.deepEqual(calls, ['https://vendor.example/v1/models'])
})

test('GET proxy fails closed for redirects and retains error status from upstream', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.redirect, 'error')
    throw new TypeError('redirect refused')
  })
  assert.equal((await onRequestGet({ request: request('https://api.openai.com/v1/models') })).status, 502)
  mock.mock.mockImplementation(async () => Response.json({ error: 'unauthorized' }, { status: 401 }))
  assert.equal((await onRequestGet({ request: request('https://api.openai.com/v1/models') })).status, 401)
})

test('POST generation behavior and allowlist are unchanged', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ data: [] }) })
  assert.equal((await onRequestPost({ request: request('https://api.openai.com/v1/images/edits', 'POST') })).status, 200)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal((await onRequestPost({ request: request('https://unknown.example/v1/images/edits', 'POST') })).status, 403)
  assert.equal(calls.length, 1)
})

test('Worker dispatches GET models, rejects other verbs and keeps assets routing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [] }))
  const env = { ASSETS: { fetch: async () => new Response('asset') } }
  assert.equal((await worker.fetch(request('https://api.openai.com/v1/models'), env)).status, 200)
  assert.equal((await worker.fetch(request('https://api.openai.com/v1/models', 'DELETE'), env)).status, 405)
  assert.equal(await (await worker.fetch(new Request('https://gallery.example/'), env)).text(), 'asset')
})
