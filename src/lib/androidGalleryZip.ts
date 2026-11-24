import { ANDROID_GALLERY_CHUNK_BYTES, ANDROID_GALLERY_MAX_IMAGE, ANDROID_GALLERY_SLOTS, isBoundedAndroidImage } from './androidGallery'
import type { ReferenceSlot } from './randomRecipe'

export const GALLERY_PAGE = 24
const INDEX_PAGE = 100
const MAX_ROWS = 10_000
const CACHE_LIMIT = 48
const THUMB_WORKERS = 3
const THUMB_BYTES = 128 * 1024

export type GalleryZipItem = { id: number; slot: ReferenceSlot; name: string; tags: string[] }
type ZipStatus = { installed: false } | { installed: true; revision: string; count: number }
type Installed = Extract<ZipStatus, { installed: true }>
export type GalleryZipCatalog = Installed & { items: GalleryZipItem[] }
export interface GalleryZipBridge {
  galleryZipStatus(): Promise<ZipStatus>
  pickGalleryZip(): Promise<Installed | { cancelled: true }>
  listGalleryZip(input: { revision: string; offset: number }): Promise<{ items: GalleryZipItem[]; nextOffset: number | null }>
  readGalleryZipImage(input: { revision: string; id: number; kind: 'thumb' | 'image'; offset: number }): Promise<{ data: string; nextOffset: number | null; mime: 'image/jpeg' }>
  clearGalleryZip(): Promise<void>
}

function invalid(): never { throw new Error('无法读取 ZIP 素材包，请重新导入有效的手机图库。') }

export async function galleryZipCatalog(bridge: GalleryZipBridge, status: Installed): Promise<GalleryZipCatalog> {
  const { revision, count } = status
  if (!revision || !Number.isInteger(count) || count < 1 || count > MAX_ROWS) return invalid()
  const items: GalleryZipItem[] = []
  const ids = new Set<number>()
  for (let offset = 0; offset < count;) {
    const result = await bridge.listGalleryZip({ revision, offset })
    const expected = Math.min(INDEX_PAGE, count - offset)
    if (!Array.isArray(result.items) || !result.items.length || result.items.length > expected || (result.nextOffset === null ? offset + result.items.length !== count : result.nextOffset !== offset + result.items.length || result.nextOffset >= count)) return invalid()
    for (const { id, slot, name, tags } of result.items) {
      if (!Number.isSafeInteger(id) || id < 0 || ids.has(id) || !ANDROID_GALLERY_SLOTS.some(item => item.id === slot) ||
          typeof name !== 'string' || !name.trim() || name.length > 240 || !Array.isArray(tags) || tags.length > 12 ||
          !tags.every(tag => typeof tag === 'string' && tag.length <= 120)) return invalid()
      ids.add(id)
      items.push({ id, slot, name, tags })
    }
    offset += result.items.length
  }
  return { installed: true, revision, count, items }
}

export async function galleryZipImage(bridge: GalleryZipBridge, revision: string, id: number, kind: 'thumb' | 'image') {
  const max = kind === 'thumb' ? THUMB_BYTES : ANDROID_GALLERY_MAX_IMAGE
  const chunks: string[] = []
  for (let offset = 0;;) {
    const { data, nextOffset, mime } = await bridge.readGalleryZipImage({ revision, id, kind, offset })
    if (mime !== 'image/jpeg' || typeof data !== 'string' || !data.length || data.length % 4 ||
        data.length > Math.ceil(Math.min(max - offset, ANDROID_GALLERY_CHUNK_BYTES) / 3) * 4) return invalid()
    chunks.push(data)
    if (nextOffset === null) break
    // Every non-final block is full-sized and therefore has no base64 padding.
    if (nextOffset !== offset + ANDROID_GALLERY_CHUNK_BYTES || nextOffset >= max || data.length !== ANDROID_GALLERY_CHUNK_BYTES / 3 * 4 || data.endsWith('=')) return invalid()
    offset = nextOffset
  }
  const image = 'data:image/jpeg;base64,' + chunks.join('')
  return isBoundedAndroidImage(image, max, kind === 'thumb' ? 320 : 1280) ? image : invalid()
}

export function galleryPage<T>(items: readonly T[], page: number): { visible: T[]; index: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / GALLERY_PAGE))
  const index = Math.max(0, Math.min(page, pages - 1))
  return { visible: items.slice(index * GALLERY_PAGE, (index + 1) * GALLERY_PAGE), index, pages }
}

/** One shared bounded queue; effects from stale pages can no longer enqueue native reads. */
export function makeGalleryThumbs(bridge: GalleryZipBridge) {
  type Job = { revision: string; row: GalleryZipItem; isCurrent: () => boolean; done: (image?: string) => void }
  const cache = new Map<string, string>()
  const queue: Job[] = []
  let running = 0
  function pump() {
    while (running < THUMB_WORKERS && queue.length) {
      const job = queue.shift()!
      if (!job.isCurrent()) { job.done(); continue }
      const { revision, row, done } = job
      const key = revision + ':' + row.id
      const hit = cache.get(key)
      if (hit) { cache.delete(key); cache.set(key, hit); done(hit); continue }
      running++
      void galleryZipImage(bridge, revision, row.id, 'thumb').then(image => {
        if (job.isCurrent()) {
          cache.set(key, image)
          while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
          done(image)
        } else done()
      }, () => done()).finally(() => { running--; pump() })
    }
  }
  return {
    page: (revision: string, rows: readonly GalleryZipItem[], receive: (id: number, image?: string) => void) => {
      let current = true
      for (const row of rows.slice(0, GALLERY_PAGE)) {
        queue.push({ revision, row, isCurrent: () => current, done: image => { if (current) receive(row.id, image) } })
      }
      pump()
      return () => {
        current = false
        for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].isCurrent()) queue.splice(i, 1)
      }
    },
  }
}
