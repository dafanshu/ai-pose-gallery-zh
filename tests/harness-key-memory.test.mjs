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
  const message = { channel: 'pose-studio-memory-v1', op: 'state', keys: { gpt: 'synthetic-test-value' } }
  handler({ source: {}, origin: fake.location.origin, data: message })
  handler({ source: parent, origin: 'https://foreign.example', data: message })
  handler({ source: parent, origin: fake.location.origin, data: { ...message, keys: { gpt: 'x'.repeat(16385) } } })
  assert.equal(received.length, 0)
  handler({ source: parent, origin: fake.location.origin, data: message })
  assert.equal(received[0].gpt, 'synthetic-test-value')
  rememberHarnessKeys({ providers: { gpt: { apiKey: 'synthetic-test-value', baseUrl: 'never-export-endpoint', model: 'never-export-model' } }, secret: 'never-export-other-field' })
  assert.deepEqual(sent[1], [{ channel: 'pose-studio-memory-v1', op: 'set', keys: { gpt: 'synthetic-test-value' } }, fake.location.origin])
  dispose()
  assert.equal(listeners.size, 0)
})
