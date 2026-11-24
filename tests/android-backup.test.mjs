import assert from 'node:assert/strict'
import { test } from 'node:test'
import { androidBackupPreferences, parseAndroidBackup, readAndroidBackup, restoreAndroidPreferences, serializeAndroidBackup, validateAndroidDraftSettings, writeAndroidBackup } from '../src/lib/androidBackup.ts'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'
import { uploadedReferences } from '../src/lib/recipeImages.ts'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJm0AAAAASUVORK5CYII='
const chunkBytes = 192 * 1024
const text = bytes => new TextDecoder().decode(bytes)
function fixture() {
  const config = structuredClone(DEFAULT_API_CONFIG)
  config.activeProvider = 'qwen'
  config.stylePreset = 'film'
  config.gptParams = { ...config.gptParams, size: '1536x1024', quality: 'low' }
  config.providers.qwen = { ...config.providers.qwen, model: 'qwen-image-3.0', apiKey: 'fixture-QWEN-SECRET', baseUrl: 'https://example.invalid/private' }
  const recipe = { portrait: null, costume: null, pose: null, extraImages: [], ...uploadedReferences('portrait', image, 1, 1, 1) }
  const { providers, ...settings } = config
  const models = Object.fromEntries(Object.entries(providers).map(([key, value]) => [key, { model: value.model, customModel: value.customModel, apiKey: value.apiKey }]))
  return {
    recipe, customPrompt: '拍摄于傍晚', poseDepthMode: true, preferences: androidBackupPreferences(config),
    history: [{id: 'known', createdAt: 1, provider: 'qwen', model: 'qwen-image-3.0', prompt: '历史提示词', imageUrl: image,
      recipeSummary: '头像一张', snapshot: { recipe, settings, models, prompt: '历史提示词', customPrompt: null }}],
  }
}
test('exports a complete offline Android archive, deduplicating actual images and excluding connection fields', () => {
  const input = fixture()
  const encoded = text(serializeAndroidBackup(input))
  const raw = JSON.parse(encoded)
  assert.deepEqual(raw.images, [image])
  assert.ok(!/fixture-QWEN-SECRET|baseUrl|example\.invalid|apiKey|workspaceId/.test(encoded))
  const restored = parseAndroidBackup(encoded)
  assert.equal(restored.customPrompt, '拍摄于傍晚')
  assert.equal(restored.poseDepthMode, true)
  assert.equal(restored.recipe.portrait.原图, image)
  assert.equal(restored.history[0].imageUrl, image)
  assert.equal(restored.history[0].snapshot.recipe.portrait.缩略图, image)
  assert.deepEqual(restored.preferences, input.preferences)
  const config = restoreAndroidPreferences(DEFAULT_API_CONFIG, restored.preferences)
  assert.equal(config.activeProvider, 'qwen')
  assert.equal(config.providers.qwen.model, 'qwen-image-3.0')
  assert.equal(config.providers.qwen.apiKey, '')
  assert.equal(config.stylePreset, 'film')
  assert.equal(config.gptParams.size, '1536x1024')
  assert.equal(config.gptParams.quality, 'low')
  // Ordinary edits after restore may be persisted in the same draft slot.
  const modified = { ...restored, customPrompt: '编辑后的提示词', preferences: androidBackupPreferences({ ...config, stylePreset: 'realistic' }) }
  const reopened = validateAndroidDraftSettings(structuredClone(modified))
  assert.equal(reopened.customPrompt, '编辑后的提示词')
  assert.equal(restoreAndroidPreferences(DEFAULT_API_CONFIG, reopened.preferences).stylePreset, 'realistic')
})
test('rejects old formats, invalid metadata, missing references and nonlocal or nonraster data', () => {
  const encoded = text(serializeAndroidBackup(fixture()))
  const raw = JSON.parse(encoded)
  assert.throws(() => parseAndroidBackup(encoded.slice(0, -7)), /格式无效/)
  assert.throws(() => parseAndroidBackup(JSON.stringify({ ...raw, version: 444 })), /不支持/)
  assert.throws(() => parseAndroidBackup(JSON.stringify({ ...raw, images: [] })), /格式无效/)
  assert.throws(() => parseAndroidBackup(JSON.stringify({ ...raw, history: [{ ...raw.history[0], imageUrl: 'https://example.invalid/remote.png' }] })), /格式无效/)
  assert.throws(() => parseAndroidBackup(JSON.stringify({ ...raw, images: ['data:image/svg+xml;base64,aaaa'] })), /PNG\/JPEG/)
  assert.throws(() => parseAndroidBackup(JSON.stringify({ ...raw, images: ['data:image/png;base64,aGVsbG8='] })), /格式无效/)
  assert.throws(() => serializeAndroidBackup({ ...fixture(), history: Array(31).fill(fixture().history[0]) }), /格式无效/)
  assert.throws(() => serializeAndroidBackup({ ...fixture(), history: [{ ...fixture().history[0], imageUrl: 'https://example.invalid/private.png' }] }), /本机已保存/)
  assert.throws(() => parseAndroidBackup(JSON.stringify({ ...raw, history: [raw.history[0], raw.history[0]] })), /无效/)
})
test('native bridge preserves exact bytes and split UTF-8, safely handling system cancellations', async () => {
  const input = fixture()
  input.history[0].prompt = 'a历史'
  const initial = Buffer.from(serializeAndroidBackup(input)).indexOf(Buffer.from('a历史'))
  assert.ok(initial > 0)
  input.history[0].prompt = 'a'.repeat(chunkBytes - initial - 1) + '历史'
  const bytes = serializeAndroidBackup(input)
  assert.equal(Buffer.from(bytes).indexOf(Buffer.from('历史')), chunkBytes - 1)
  const output = []
  const calls = []
  const bridge = {
    createBackup: async ({ size }) => { assert.equal(size, bytes.length); return { token: 'output' } },
    writeBackupChunk: async ({ token, offset, data }) => {
      assert.equal(token, 'output')
      assert.equal(offset, output.length * chunkBytes)
      output.push(Buffer.from(data, 'base64'))
    },
    finishBackup: async ({ token }) => calls.push(token),
    cancelBackup: async () => assert.fail('not cancelled'),
    pickBackup: async () => ({ token: 'input', size: bytes.length }),
    readBackupChunk: async ({ token, offset }) => {
      assert.equal(token, 'input')
      return { data: Buffer.from(bytes.subarray(offset, offset + chunkBytes)).toString('base64') }
    },
    closeBackupRead: async ({ token }) => calls.push(token),
  }
  assert.equal(await writeAndroidBackup(bridge, bytes), true)
  assert.deepEqual(Buffer.concat(output), Buffer.from(bytes))
  assert.equal((await readAndroidBackup(bridge)).history[0].prompt, input.history[0].prompt)
  assert.deepEqual(calls, ['output', 'input'])
  assert.equal(await readAndroidBackup({ pickBackup: async () => ({ cancelled: true }) }), null)
  assert.equal(await writeAndroidBackup({ createBackup: async () => ({ cancelled: true }) }, bytes), false)
})
test('a short read or a failed write cannot be mistaken for a restored or completed backup', async () => {
  const calls = []
  const bytes = serializeAndroidBackup(fixture())
  await assert.rejects(readAndroidBackup({
    pickBackup: async () => ({ token: 'input', size: bytes.length }),
    readBackupChunk: async () => ({ data: 'AAAA' }),
    closeBackupRead: async ({ token }) => calls.push(token),
  }), /格式无效/)
  await assert.rejects(writeAndroidBackup({
    createBackup: async () => ({ token: 'output' }),
    writeBackupChunk: async () => { throw new Error('write failed') },
    finishBackup: async () => assert.fail('must not finish after write fails'),
    cancelBackup: async ({ token }) => calls.push(token),
  }, bytes), /write failed/)
  await assert.rejects(readAndroidBackup({
    pickBackup: async () => ({ token: 'oversize', size: 50 * 1024 * 1024 + 1 }),
    readBackupChunk: async () => assert.fail('must reject over-limit file before reading chunks'),
    closeBackupRead: async ({ token }) => calls.push(token),
  }), /超过 50 MiB/)
  assert.deepEqual(calls, ['input', 'output', 'oversize'])
})
