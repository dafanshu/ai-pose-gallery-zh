import assert from 'node:assert/strict'
import { test } from 'node:test'
import { galleryPage, galleryZipCatalog, galleryZipImage, makeGalleryThumbs } from '../src/lib/androidGalleryZip.ts'
import { searchAndroidGallery } from '../src/lib/androidGallery.ts'

const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,1,1,0x11,0,0xff,0xd9])
const thumbResponse = { data: JPEG.toString('base64'), nextOffset: null, mime: 'image/jpeg' }
const chunk = 192 * 1024
const row = (id, slot = 'pose') => ({ id, slot, name: `测试素材 ${id}`, tags: [id % 2 ? '站立' : '坐姿'] })
const tick = () => new Promise(resolve => setImmediate(resolve))

test('loads a full searchable index in bounded metadata-only chunks and renders only 24 matches per page', async () => {
  const entries = Array.from({ length: 615 }, (_, id) => row(id, id < 300 ? 'costume' : 'pose'))
  const offsets = []
  const pack = await galleryZipCatalog({
    listGalleryZip: async ({ revision, offset }) => {
      assert.equal(revision, 'a')
      offsets.push(offset)
      const end = offset + 100
      return { items: entries.slice(offset, end), nextOffset: end < entries.length ? end : null }
    },
    readGalleryZipImage: async () => assert.fail('index must not read image bytes'),
  }, { installed: true, revision: 'a', count: entries.length })
  assert.deepEqual(offsets, [0, 100, 200, 300, 400, 500, 600])
  assert.equal(pack.items.length, 615)
  const matches = searchAndroidGallery(pack, 'pose', '测试素材', '坐姿')
  const page = galleryPage(matches, 1)
  assert.equal(page.visible.length, 24)
  assert.deepEqual(page.visible.map(item => item.id), matches.slice(24, 48).map(item => item.id))
  assert.ok(searchAndroidGallery(pack, 'pose', '614').some(item => item.id === 614))
})
test('rejects excessive entries, duplicate IDs and nonadvancing offsets before image reads', async () => {
  const status = { installed: true, revision: 'a', count: 2 }
  await assert.rejects(galleryZipCatalog({ listGalleryZip: async () => assert.fail('must reject too many rows') }, { ...status, count: 10_001 }), /素材包/)
  await assert.rejects(galleryZipCatalog({ listGalleryZip: async () => ({ items: [row(2), row(2)], nextOffset: null }) }, status), /素材包/)
  await assert.rejects(galleryZipCatalog({ listGalleryZip: async () => ({ items: [row(2)], nextOffset: 0 }) }, status), /素材包/)
})
test('thumbnail page changes bound work, drop stale deliveries and scope cached bytes to ZIP revision', async () => {
  const started = [], visible = [], pending = []
  let inFlight = 0, maxInFlight = 0
  const cache = makeGalleryThumbs({
    readGalleryZipImage: async ({ revision, id, kind, offset }) => {
      assert.equal(kind, 'thumb')
      assert.equal(offset, 0)
      started.push([revision, id])
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await new Promise(resolve => pending.push(resolve))
      inFlight--
      return thumbResponse
    },
  })
  const leave = cache.page('old', Array.from({ length: 50 }, (_, id) => row(id)), id => visible.push(id))
  assert.deepEqual(started, [['old', 0], ['old', 1], ['old', 2]])
  leave()
  cache.page('new', [row(0), row(24), row(25), row(26)], id => visible.push(id))
  assert.equal(started.length, 3)
  while (pending.length) { pending.shift()(); await tick() }
  assert.equal(maxInFlight, 3)
  assert.deepEqual(visible, [0, 24, 25, 26])
  assert.equal(started.length, 7)
  cache.page('new', [row(0)], id => visible.push(id))
  assert.equal(visible.at(-1), 0)
  assert.equal(started.length, 7)
})
test('only actual explicit image requests stream full-size reference; invalid chunk offsets fail', async () => {
  const full = Buffer.concat([JPEG, Buffer.alloc(chunk + 12)])
  const started = []
  const bridge = { readGalleryZipImage: async ({ revision, id, kind, offset }) => {
    assert.equal(revision, 'rev')
    assert.equal(id, 718)
    assert.equal(kind, 'image')
    started.push(offset)
    return { data: full.subarray(offset, offset + chunk).toString('base64'), nextOffset: offset === 0 ? chunk : null, mime: 'image/jpeg' }
  } }
  const image = await galleryZipImage(bridge, 'rev', 718, 'image')
  assert.deepEqual(started, [0, chunk])
  assert.deepEqual(Buffer.from(image.split(',')[1], 'base64'), full)
  await assert.rejects(galleryZipImage({ readGalleryZipImage: async () => ({ ...thumbResponse, nextOffset: 1 }) }, 'bad', 1, 'image'), /素材包/)
})

test('ZIP photos must respect their distinct dimension and byte budgets', async () => {
  const body = Buffer.from(JPEG)
  body.writeUInt16BE(321, 9)
  const bridge = { readGalleryZipImage: async () => ({ ...thumbResponse, data: body.toString('base64') }) }
  await assert.rejects(galleryZipImage(bridge, 'rev', 7, 'thumb'), /素材包/)
  assert.ok(await galleryZipImage(bridge, 'rev', 7, 'image'))
  body.writeUInt16BE(1281, 9)
  await assert.rejects(galleryZipImage(bridge, 'rev', 7, 'image'), /素材包/)
  await assert.rejects(galleryZipImage({ readGalleryZipImage: async () => ({
    ...thumbResponse, data: Buffer.concat([JPEG, Buffer.alloc(128 * 1024, 0)]).toString('base64'),
  }) }, 'rev', 7, 'thumb'), /素材包/)
})
