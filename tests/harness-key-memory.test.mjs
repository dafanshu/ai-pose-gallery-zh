import test from 'node:test'
import assert from 'node:assert/strict'
import { connectHarnessKeyMemory, rememberHarnessKeys } from '../src/lib/harnessKeyMemory.ts'

test('credential memory handshake validates parent and origin, sends only keys and disposes listener', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const sent = [], listeners = new Map(), received = []
  const parent = { postMessage: (...args) => sent.push(args) }
  const fake = { parent, __POSE_HARNESS__: {}, location: { origin: 'https://host.example' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fake })
  t.after(() => original ? Object.defineProperty(globalThis, 'window', original) : delete globalThis.window)
  const dispose = connectHarnessKeyMemory(keys => received.push(keys))
  assert.deepEqual(sent[0], [{ channel: 'pose-studio-memory-v1', op: 'get' }, 'https://host.example'])
  const handler = listeners.get('message')
  const message = { channel: 'pose-studio-memory-v1', op: 'state', epoch: 1, keys: { gpt: 'synthetic-test-value' } }
  handler({ source: {}, origin: fake.location.origin, data: message })
  handler({ source: parent, origin: 'https://foreign.example', data: message })
  handler({ source: parent, origin: fake.location.origin, data: { ...message, keys: { gpt: 'x'.repeat(16385) } } })
  assert.equal(received.length, 0)
  handler({ source: parent, origin: fake.location.origin, data: message })
  assert.equal(received[0].gpt, 'synthetic-test-value')
  rememberHarnessKeys({ providers: { gpt: { apiKey: 'synthetic-test-value', baseUrl: 'never-export-endpoint', model: 'never-export-model' } }, secret: 'never-export-other-field' })
  assert.deepEqual(sent[1], [{ channel: 'pose-studio-memory-v1', op: 'set', keys: { gpt: 'synthetic-test-value' }, epoch: 1 }, fake.location.origin])
  dispose()
  assert.equal(listeners.size, 0)
})

test('delayed handshake cannot erase edited keys after a style change; clear and reload still erase them', async t => {
  const { createKeyVault } = await import('../harness/workbench.mjs')
  const { DEFAULT_API_CONFIG, mergeStoredConfig } = await import('../src/store/apiConfig.ts')
  const { persistedValue } = await import('../src/lib/runtime.ts')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const replies = [], outgoing = [], listeners = new Map()
  const frame = { postMessage: data => replies.push(structuredClone(data)) }
  const vault = createKeyVault('https://host.example'); vault.connect(frame)
  const parent = { postMessage: data => { outgoing.push(data); vault.handle({source:frame,origin:'https://host.example',data}) } }
  Object.defineProperty(globalThis,'window',{configurable:true,value:{parent,__POSE_HARNESS__:{},location:{origin:'https://host.example'},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}})
  t.after(()=>original?Object.defineProperty(globalThis,'window',original):delete globalThis.window)
  let config = structuredClone(DEFAULT_API_CONFIG)
  const receive = keys => { config={...config,providers:Object.fromEntries(Object.entries(config.providers).map(([id,value])=>[id,{...value,apiKey:keys[id]}]))} }
  const deliver = data => listeners.get('message')({source:parent,origin:'https://host.example',data})
  const dispose = connectHarnessKeyMemory(receive)
  const delayed = structuredClone(replies[0]); deliver(replies.shift())
  config.providers.gpt.apiKey='synthetic-gpt-only'; config.providers.gemini.apiKey='synthetic-gemini-only'
  rememberHarnessKeys(config)
  config={...config,stylePreset:'anime',activeProvider:'gpt'}
  rememberHarnessKeys(config)
  deliver(delayed)
  assert.equal(config.providers.gpt.apiKey,'synthetic-gpt-only')
  assert.equal(config.providers.gemini.apiKey,'synthetic-gemini-only')
  assert.equal(config.providers.qwen.apiKey,'')
  assert.doesNotMatch(JSON.stringify(persistedValue(config)),/synthetic-/)
  const saved=persistedValue(config)
  vault.clear(); deliver(replies.shift()); rememberHarnessKeys(config)
  assert.ok(Object.values(config.providers).every(p=>p.apiKey===''))
  deliver(delayed); assert.equal(config.providers.gpt.apiKey,'')
  dispose(); config=mergeStoredConfig(saved)
  assert.equal(config.providers.gpt.apiKey,'')
  assert.ok(outgoing.length>=3)
})

test('explicit provider edits before handshake survive restore, but explicit clear wins', async t => {
  const { noteHarnessKeyEdit } = await import('../src/lib/harnessKeyMemory.ts')
  const original=Object.getOwnPropertyDescriptor(globalThis,'window'), listeners=new Map(), received=[]
  const parent={postMessage(){}}
  Object.defineProperty(globalThis,'window',{configurable:true,value:{parent,__POSE_HARNESS__:{},location:{origin:'https://host.example'},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)}})
  t.after(()=>original?Object.defineProperty(globalThis,'window',original):delete globalThis.window)
  const deliver=data=>listeners.get('message')({source:parent,origin:'https://host.example',data:{channel:'pose-studio-memory-v1',op:'state',epoch:1,keys:{gemini:'synthetic-existing'},...data}})
  let dispose=connectHarnessKeyMemory(keys=>received.push(keys))
  noteHarnessKeyEdit('gpt','synthetic-new'); deliver({})
  assert.equal(received.at(-1).gpt,'synthetic-new'); assert.equal(received.at(-1).gemini,'synthetic-existing')
  dispose(); dispose=connectHarnessKeyMemory(keys=>received.push(keys))
  noteHarnessKeyEdit('gpt','synthetic-new'); deliver({cleared:true,keys:{}})
  assert.equal(received.at(-1).gpt,''); dispose()
})
