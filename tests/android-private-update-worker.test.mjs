import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import worker from '../mobile/android/private-updates/worker.mjs'

const token = '1'.repeat(64)
const sha = 'c'.repeat(64)
function fixture() {
  const reads = []
  const objects = new Map([
    ['manifests/2099998980.json', '{"versionCode":1020}'],
    ['manifests/2099998978.json', '{"versionCode":1022}'],
    [`apks/1022/${sha}.apk`, 'signed apk'],
  ])
  const env = {
    UPDATE_READER_SHA256: createHash('sha256').update(token).digest('hex'),
    UPDATES: {
      async list({ prefix, cursor, limit }) {
        assert.equal(limit, 1000)
        reads.push('list')
        const keys = [...objects.keys()].filter(k => k.startsWith(prefix))
        return cursor ? { objects: [{key: keys[1]}], truncated: false }
          : { objects: [{key: keys[0]}], truncated: true, cursor: 'page-2' }
      },
      async get(key) {
        reads.push(key)
        const body = objects.get(key)
        return body ? { body, size: Buffer.byteLength(body) } : null
      },
    },
  }
  const req = (path, method = 'GET', credential = token) =>
    new Request(`https://updates.example.com${path}`, { method, headers: { Authorization: `Bearer ${credential}` } })
  return { env, reads, req }
}

test('update source is closed by default and never accesses R2 without a valid bearer', async () => {
  const { env, reads, req } = fixture()
  assert.equal((await worker.fetch(req('/v1/latest.json', 'GET', '2'.repeat(64)), env)).status, 401)
  assert.equal((await worker.fetch(req('/v1/latest.json'), { ...env, UPDATE_READER_SHA256: undefined })).status, 401)
  assert.deepEqual(reads, [])
})

test('newest published version wins even when old versions are retained, APK streams with no public cache', async () => {
  const { env, reads, req } = fixture()
  let response = await worker.fetch(req('/v1/latest.json'), env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal((await response.json()).versionCode, 1022)
  response = await worker.fetch(req(`/v1/apk/1022/${sha}`), env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'application/vnd.android.package-archive')
  assert.equal(await response.text(), 'signed apk')
  assert.deepEqual(reads, ['list', 'list', 'manifests/2099998978.json', `apks/1022/${sha}.apk`])
})

test('APK reader cannot write, list bucket contents, or use query tokens or arbitrary keys', async () => {
  const { env, reads, req } = fixture()
  for (const path of ['/','/v1/apk/0/' + sha, '/v1/apk/2100000001/' + sha, '/v1/apk/1022/x', '/v1/latest.json?key=123'])
    assert.equal((await worker.fetch(req(path), env)).status, 404)
  assert.equal((await worker.fetch(req('/v1/latest.json', 'PUT'), env)).status, 405)
  assert.deepEqual(reads, [])
})
