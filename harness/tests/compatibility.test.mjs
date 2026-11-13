import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { HARNESS_TARGET, HARNESS_SOURCE, HARNESS_TAG, assertHostContract } from '../compatibility.mjs'
import { apply } from '../index.mjs'

test('manifest uses the official engines.dsh exact prerelease contract',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
  assert.equal(HARNESS_TARGET,'0.2.2-rc.1')
  assert.equal(HARNESS_TAG,'dsh-v0.2.2-rc.1')
  assert.equal(HARNESS_SOURCE,'66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db')
  assert.equal(manifest.engines.dsh,HARNESS_TARGET)
  assert.equal(manifest.engines.node,'>=24.9.0')
  assert.equal(manifest.dsh.manifestVersion,1)
  assert.equal(manifest.dsh.version,undefined)
  assert.ok(manifest.files.includes('compatibility.mjs'))
})
test('reviewed rc.1 service contract enables WebSocket capability',()=>{
  const ctx={effect(){},webServer:{register(){},registerUpgrade(){}},connection:{admit(){}}}
  assert.deepEqual(assertHostContract(ctx),{comfyWebSocket:true})
})
test('hosts without owner admission fail before registering a route',()=>{
  let registered=0
  const ctx={effect:fn=>fn(),webServer:{register(){registered++}},connection:{requestRejection(){}}}
  assert.throws(()=>apply(ctx),/connection\.admit owner admission is required/)
  assert.equal(registered,0)
})
test('missing web-profile services produce an actionable error',()=>{
  assert.throws(()=>assertHostContract({connection:{admit(){}}}),/0\.2\.2-rc\.1 web profile/)
})
test('missing optional upgrade service keeps authenticated HTTP polling only',()=>{
  let http,upgrades=0
  const ctx={effect:fn=>fn(),webServer:{register(route){http=route;return()=>{}}},connection:{admit:()=>({peer:{principal:{kind:'owner'}}})}}
  assert.deepEqual(assertHostContract(ctx),{comfyWebSocket:false})
  apply(ctx)
  assert.equal(typeof http.handler,'function')
  assert.equal(upgrades,0)
})
