import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANDROID_GALLERY_CHUNK_BYTES, ANDROID_GALLERY_MAX_BYTES, androidGalleryFilterTags, readAndroidGalleryPack, searchAndroidGallery, validateAndroidGallery } from '../src/lib/androidGallery.ts'
import { androidFormConfig, androidGenerationRequest } from '../src/lib/androidStudio.ts'
import { uploadedReferences } from '../src/lib/recipeImages.ts'
import { snapshotGeneration, prepareHistoryRestore } from '../src/lib/generationSnapshot.ts'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWq0AAAAASUVORK5CYII='
// Minimal JPEG marker sequence for the format/dimensions validator. Device decoder tests use real encoded images.
const jpegHeader = 'data:image/jpeg;base64,' + Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,1,1,0x11,0,0xff,0xd9]).toString('base64')
const gallery = (...items) => ({ format: 'role-studio-gallery', version: 1, items })
const item = (slot = 'pose', patch = {}) => ({ slot, name: '站立 正面', tags: ['全身', '通用'], dataUrl: image, ...patch })

test('mobile gallery accepts bounded inline PNG and JPEG and ignores unexpected metadata', () => {
  const pack = validateAndroidGallery(gallery(item('portrait', { apiKey: 'not stored' }), item('costume', { dataUrl: jpegHeader }), item('pose')))
  assert.deepEqual(pack.items, [item('portrait'), item('costume', { dataUrl: jpegHeader }), item('pose')])
})

test('mobile gallery rejects network references, SVG, malformed image headers and excessive dimensions', () => {
  const raw = Buffer.from(image.split(',')[1], 'base64')
  raw.writeUInt32BE(4097, 16)
  for (const dataUrl of [
    '/img/pose.png', 'https://example.invalid/pose.png', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AAAA', 'data:image/png;base64,====', 'data:image/jpeg;base64,AA==',
    'data:image/png;base64,' + raw.toString('base64'),
    'data:image/png;base64,' + 'AAAA'.repeat(1_800_000),
  ]) {
    assert.throws(() => validateAndroidGallery(gallery(item('pose', { dataUrl }))), /PNG\/JPEG/)
  }
})

test('known localized categories and finite plain labels are required', () => {
  for (const patch of [{ slot: 'extra' }, { name: 'X'.repeat(121) }, { name: 'bad\nname' }, { tags: ['X'.repeat(61)] }, { tags: new Array(13).fill('Tag') }]) {
    assert.throws(() => validateAndroidGallery(gallery(item('pose', patch))), /类别、名称或标签/)
  }
  assert.throws(() => validateAndroidGallery({ format: 'old', version: 1, items: [] }), /手机素材包/)
  assert.throws(() => validateAndroidGallery(gallery()), /1–600/)
  assert.throws(() => validateAndroidGallery(gallery(...Array.from({ length: 601 }, () => item()))), /1–600/)
})

function packBridge(bytes, sizeOverride = bytes.length) {
  const calls = []
  const bridge = {
    pickGalleryPack: async () => ({ token: 'fixture', size: sizeOverride }),
    readGalleryPackChunk: async ({ token, offset }) => {
      assert.equal(token, 'fixture')
      calls.push(offset)
      return { data: bytes.subarray(offset, offset + ANDROID_GALLERY_CHUNK_BYTES).toString('base64') }
    },
    closeGalleryPack: async ({ token }) => { calls.push(token) },
  }
  return { bridge, calls }
}

test('system document bridge checks size before reading, cleans up on failure and skips cancelled picks', async () => {
  const oversized = packBridge(Buffer.alloc(0), ANDROID_GALLERY_MAX_BYTES + 1)
  await assert.rejects(readAndroidGalleryPack(oversized.bridge), /40 MiB/)
  assert.deepEqual(oversized.calls, ['fixture'])
  const truncated = packBridge(Buffer.from('{}'), 20)
  await assert.rejects(readAndroidGalleryPack(truncated.bridge), /无法完整读取/)
  assert.deepEqual(truncated.calls, [0, 'fixture'])
  const invalid = packBridge(Buffer.from('incomplete file'))
  await assert.rejects(readAndroidGalleryPack(invalid.bridge), /UTF-8 JSON/)
  assert.deepEqual(invalid.calls, [0, 'fixture'])
  const cancelled = packBridge(Buffer.alloc(0))
  cancelled.bridge.pickGalleryPack = async () => ({ cancelled: true })
  assert.equal(await readAndroidGalleryPack(cancelled.bridge), null)
  assert.deepEqual(cancelled.calls, [])
})

test('pack read handles a split Chinese character, with local categories searchable and filterable', async () => {
  const json = JSON.stringify(gallery(
    item('portrait', { name: '甲', tags: ['STUDIO', '男', '123'] }),
    item('portrait', { name: '乙', tags: ['Studio'] }),
    item('pose', { name: '甲', tags: ['STUDIO', '男', '123'] }),
  ))
  const prefix = json.slice(0, json.indexOf('甲'))
  const padding = ' '.repeat(ANDROID_GALLERY_CHUNK_BYTES - Buffer.byteLength(prefix) - 1)
  const fixture = packBridge(Buffer.from(padding + json))
  const pack = await readAndroidGalleryPack(fixture.bridge)
  assert.deepEqual(fixture.calls, [0, ANDROID_GALLERY_CHUNK_BYTES, 'fixture'])
  assert.deepEqual(searchAndroidGallery(pack, 'portrait', ' studio 男 ').map(result => result.name), ['甲'])
  assert.equal(searchAndroidGallery(pack, 'portrait', '').length, 2)
  assert.deepEqual(androidGalleryFilterTags(pack, 'portrait'), ['男'])
  assert.deepEqual(searchAndroidGallery(pack, 'portrait', 'studio', '男').map(result => result.name), ['甲'])
  assert.equal(searchAndroidGallery(pack, 'pose', '').length, 1)
  assert.equal(searchAndroidGallery(pack, 'costume', '').length, 0)
})

test('selected gallery references materialized from local data survive history snapshot without pack access', async () => {
  const pose = validateAndroidGallery(gallery(item())).items[0]
  const recipe = { portrait: null, costume: null, pose: uploadedReferences(pose.name, pose.dataUrl, 1, 1, 0).pose }
  const config = androidFormConfig({ ...DEFAULT_API_CONFIG, activeProvider: 'qwen' })
  assert.deepEqual(androidGenerationRequest(recipe, config, 'example').images, [image])
  const snapshot = await snapshotGeneration(recipe, config, 'example', null)
  const restored = prepareHistoryRestore({ provider: 'qwen', prompt: 'example', snapshot })
  assert.equal(restored.kind, 'full')
  assert.equal(restored.snapshot.recipe.pose.原图, image)
})
