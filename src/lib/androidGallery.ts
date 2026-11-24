import type { ReferenceSlot } from './randomRecipe'

export const ANDROID_GALLERY_KEY = 'android-gallery-pack-v1'
export const ANDROID_GALLERY_FORMAT = 'role-studio-gallery'
export const ANDROID_GALLERY_MAX_BYTES = 40 * 1024 * 1024
export const ANDROID_GALLERY_MAX_ITEMS = 600
export const ANDROID_GALLERY_CHUNK_BYTES = 192 * 1024
export const ANDROID_GALLERY_MAX_IMAGE = 5 * 1024 * 1024
export const ANDROID_GALLERY_SLOTS = [
  { id: 'portrait', label: '人像' },
  { id: 'costume', label: '服饰' },
  { id: 'pose', label: '姿势' },
] as const

export type AndroidGalleryItem = {
  slot: ReferenceSlot
  name: string
  tags: string[]
  dataUrl: string
}
export type AndroidGalleryPack = {
  format: typeof ANDROID_GALLERY_FORMAT
  version: 1
  items: AndroidGalleryItem[]
}

function rowObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('素材包结构不正确')
  return value as Record<string, unknown>
}

function cleanLabel(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) return false
  // Keep labels plain and one-line, while retaining Chinese names and tags.
  return ![...value].some(char => {
    const code = char.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159)
  })
}

function boundedDimensions(width: number, height: number) {
  return width > 0 && height > 0 && width <= 4096 && height <= 4096
}

function isLocalGalleryImage(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const png = value.startsWith('data:image/png;base64,')
  if (!png && !value.startsWith('data:image/jpeg;base64,')) return false
  const data = value.slice(value.indexOf(',') + 1)
  if (!data.length || data.length % 4 || data.length > Math.ceil(ANDROID_GALLERY_MAX_IMAGE / 3) * 4) return false
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  if (data.length * 3 / 4 - padding > ANDROID_GALLERY_MAX_IMAGE || /[^A-Za-z0-9+/]/.test(data.slice(0, data.length - padding))) return false
  // Validate actual file signature and dimensions. Never decode the whole package into pixels.
  const head = atob(data.slice(0, png ? 32 : 87_384))
  const b = (offset: number) => head.charCodeAt(offset)
  if (png) {
    if (!head.startsWith('\x89PNG\r\n\x1a\n\0\0\0\rIHDR') || head.length < 24) return false
    const u32 = (offset: number) => b(offset) * 0x1000000 + b(offset + 1) * 0x10000 + b(offset + 2) * 0x100 + b(offset + 3)
    return boundedDimensions(u32(16), u32(20))
  }
  if (b(0) !== 0xff || b(1) !== 0xd8) return false
  for (let i = 2; i + 3 < head.length;) {
    if (b(i++) !== 0xff) return false
    while (b(i) === 0xff) i++
    const marker = b(i++)
    const length = b(i) * 256 + b(i + 1)
    if (length < 2 || !Number.isFinite(length)) return false
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return length >= 8 && i + 6 < head.length && boundedDimensions(b(i + 5) * 256 + b(i + 6), b(i + 3) * 256 + b(i + 4))
    }
    if (marker === 0xda || marker === 0xd9) return false
    i += length
  }
  return false
}

export function validateAndroidGallery(input: unknown): AndroidGalleryPack {
  const data = rowObject(input)
  if (data.format !== ANDROID_GALLERY_FORMAT || data.version !== 1) {
    throw new Error('请选择手机素材包（不是合成台备份或原始图库 JSON）')
  }
  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > ANDROID_GALLERY_MAX_ITEMS) {
    throw new Error(`素材包须包含 1–${ANDROID_GALLERY_MAX_ITEMS} 项素材`)
  }
  let imageCharacters = 0
  const items: AndroidGalleryItem[] = data.items.map((value, index) => {
    const row = rowObject(value)
    const slot = ANDROID_GALLERY_SLOTS.find(item => item.id === row.slot)?.id
    if (!slot || !cleanLabel(row.name, 120) || !Array.isArray(row.tags) ||
        row.tags.length > 12 || !row.tags.every(value => cleanLabel(value, 60))) {
      throw new Error(`第 ${index + 1} 项的类别、名称或标签不符合素材包格式`)
    }
    if (!isLocalGalleryImage(row.dataUrl)) {
      throw new Error(`第 ${index + 1} 项不是可用的本地 PNG/JPEG 图片，或超过大小与分辨率限制`)
    }
    imageCharacters += row.dataUrl.length
    if (imageCharacters > ANDROID_GALLERY_MAX_BYTES) throw new Error('素材包超过 40 MiB')
    return { slot, name: (row.name as string).trim(), tags: row.tags.map((tag: string) => tag.trim()), dataUrl: row.dataUrl }
  })
  return { format: ANDROID_GALLERY_FORMAT, version: 1, items }
}

export type AndroidGalleryBridge = {
  pickGalleryPack(): Promise<{ cancelled: true } | { token: string; size: number }>
  readGalleryPackChunk(input: { token: string; offset: number }): Promise<{ data: string }>
  closeGalleryPack(input: { token: string }): Promise<void>
}

export async function readAndroidGalleryPack(bridge: AndroidGalleryBridge): Promise<AndroidGalleryPack | null> {
  const picked = await bridge.pickGalleryPack()
  if ('cancelled' in picked) return null
  const { token, size } = picked
  try {
    if (!Number.isInteger(size) || size < 1 || size > ANDROID_GALLERY_MAX_BYTES) throw new Error('素材包为空或超过 40 MiB，请缩小导出范围')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const text: string[] = []
    for (let offset = 0; offset < size;) {
      const { data } = await bridge.readGalleryPackChunk({ token, offset })
      const limit = Math.min(size - offset, ANDROID_GALLERY_CHUNK_BYTES)
      if (typeof data !== 'string' || !data || data.length > Math.ceil(limit / 3) * 4) throw new Error('无法完整读取素材包')
      const binary = atob(data)
      if (binary.length !== limit) throw new Error('无法完整读取素材包')
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index)
      text.push(decoder.decode(bytes, { stream: true }))
      offset += bytes.length
    }
    text.push(decoder.decode())
    let input: unknown
    try { input = JSON.parse(text.join('')) }
    catch { throw new Error('无法读取素材包，请选择完整的 UTF-8 JSON 文件') }
    return validateAndroidGallery(input)
  } finally {
    await bridge.closeGalleryPack({ token })
  }
}

export function searchAndroidGallery(pack: AndroidGalleryPack | null, slot: ReferenceSlot, query: string, tag?: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return (pack?.items ?? []).filter(item =>
    item.slot === slot && (!tag || item.tags.includes(tag)) && words.every(word => `${item.name} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(word)),
  )
}

export function androidGalleryFilterTags(pack: AndroidGalleryPack | null, slot: ReferenceSlot): string[] {
  const frequencies = new Map<string, number>()
  for (const item of pack?.items ?? []) {
    if (item.slot !== slot) continue
    for (const tag of new Set(item.tags)) {
      // Skip asset IDs, numbers and locators in the compact category controls.
      if (tag.length <= 22 && /\p{Script=Han}/u.test(tag)) frequencies.set(tag, (frequencies.get(tag) || 0) + 1)
    }
  }
  return [...frequencies].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag)
}
