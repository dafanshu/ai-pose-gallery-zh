import { normalizeBodyPresets, type BodyPreset } from './bodyProfile'
import type { ApiConfig, GenerationHistoryItem, RecipeState } from '../types/gallery'
import { ANDROID_PROVIDERS, androidFormConfig, getAndroidProvider, type AndroidProvider } from './androidStudio'
import { isBoundedAndroidImage } from './androidGallery'
import { MAX_BACKUP_BYTES, validateStudioBackup } from './studioBackup'

export const ANDROID_BACKUP_MAX_BYTES = MAX_BACKUP_BYTES
const CHUNK_BYTES = 192 * 1024
const FORMAT = 'role-studio-android-backup'
const INLINE = /^data:image\/(png|jpeg);base64,/
const TOKEN = /^img\/([0-9]{1,4})$/
const outputMaxBytes = 16 * 1024 * 1024
const MAX_IMAGES = 1024
const MAX_HISTORY = 30
const MAX_EXPANDED_IMAGE_CHARACTERS = 256 * 1024 * 1024

export type AndroidPreferences = {
  activeProvider: AndroidProvider
  models: Record<AndroidProvider, string>
  stylePreset: string
  size: ApiConfig['gptParams']['size']
  quality: ApiConfig['gptParams']['quality']
}
export type AndroidDraftSettings = { customPrompt: string | null; preferences: AndroidPreferences; poseDepthMode: boolean; bodyPresets?: BodyPreset[] }
export type AndroidBackup = AndroidDraftSettings & { recipe: RecipeState; history: GenerationHistoryItem[] }

type Token = { token: string }
type Cancelled = { cancelled: true }
export type AndroidBackupBridge = {
  pickBackup(): Promise<(Token & { size: number }) | Cancelled>
  readBackupChunk(input: Token & { offset: number }): Promise<{ data: string }>
  closeBackupRead(input: Token): Promise<void>
  createBackup(input: { size: number }): Promise<Token | Cancelled>
  writeBackupChunk(input: Token & { offset: number; data: string }): Promise<void>
  finishBackup(input: Token): Promise<void>
  cancelBackup(input: Token): Promise<void>
}

export function androidBackupPreferences(config: ApiConfig): AndroidPreferences {
  const current = androidFormConfig(config)
  return {
    activeProvider: getAndroidProvider(current.activeProvider)?.id ?? 'gpt',
    models: Object.fromEntries(ANDROID_PROVIDERS.map(({ id }) => [id, current.providers[id].model])) as AndroidPreferences['models'],
    stylePreset: current.stylePreset,
    size: current.gptParams.size,
    quality: current.gptParams.quality,
  }
}
export function restoreAndroidPreferences(current: ApiConfig, preferences: AndroidPreferences): ApiConfig {
  const providers = { ...current.providers }
  for (const { id } of ANDROID_PROVIDERS) providers[id] = { ...providers[id], model: preferences.models[id] }
  return androidFormConfig({
    ...current, providers, activeProvider: preferences.activeProvider, stylePreset: preferences.stylePreset,
    gptParams: { ...current.gptParams, size: preferences.size, quality: preferences.quality },
  })
}

function invalid(): never { throw new Error('安卓备份格式无效或文件不完整，未修改任何数据') }
function obj(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid()
  return input as Record<string, unknown>
}
function string(input: unknown, max: number): string {
  if (typeof input !== 'string' || input.length > max) return invalid()
  return input
}
function checkType<T extends string>(input: unknown, options: readonly T[]): T {
  if (typeof input !== 'string' || !options.includes(input as T)) return invalid()
  return input as T
}
export function validateAndroidDraftSettings(input: unknown): AndroidDraftSettings {
  const data = obj(input)
  const values = obj(data.preferences)
  const models = obj(values.models)
  const activeProvider = ANDROID_PROVIDERS.find(({ id }) => id === values.activeProvider)?.id ?? invalid()
  const preferences: AndroidPreferences = {
    activeProvider,
    // Unknown historical model IDs are mapped to current, supported defaults when applied.
    models: Object.fromEntries(ANDROID_PROVIDERS.map(({ id }) => [id, string(models[id], 200)])) as AndroidPreferences['models'],
    stylePreset: string(values.stylePreset, 256),
    size: checkType(values.size, ['auto', '1024x1024', '1024x1536', '1536x1024']),
    quality: checkType(values.quality, ['auto', 'low', 'medium', 'high']),
  }
  if (typeof data.poseDepthMode !== 'boolean') return invalid()
  return { preferences, customPrompt: data.customPrompt === null ? null : string(data.customPrompt, 1024 * 1024), poseDepthMode: data.poseDepthMode,
    ...(data.bodyPresets !== undefined && { bodyPresets: normalizeBodyPresets(data.bodyPresets) }) }
}

function checkInline(image: unknown): string {
  if (typeof image !== 'string') return invalid()
  const prefix = INLINE.exec(image)
  if (!prefix) throw new Error('备份只支持本机已保存的 PNG/JPEG 图片，请先从手机图库或相册重选缺失参考图')
  if (!isBoundedAndroidImage(image, outputMaxBytes)) return invalid()
  return image
}
function mapRecipe(recipe: RecipeState, image: (value: string) => string): RecipeState {
  if ((recipe.extraImages?.length ?? 0) > 6 || Object.keys(recipe.workflowImages ?? {}).length || (recipe.costume?.views?.length ?? 0) > 24) return invalid()
  const raster = <T extends { 原图: string; 缩略图: string }>(item: T): T => ({ ...item, 原图: image(item.原图), 缩略图: image(item.缩略图) })
  return {
    ...(recipe.bodyProfile && { bodyProfile: recipe.bodyProfile }),
    portrait: recipe.portrait && raster(recipe.portrait),
    costume: recipe.costume && {
      ...raster(recipe.costume),
      预览图: recipe.costume.预览图 ? image(recipe.costume.预览图) : '',
      ...(recipe.costume.views && { views: recipe.costume.views.map(view => ({ ...raster(view), 预览图: view.预览图 ? image(view.预览图) : '' })) }),
    },
    pose: recipe.pose && raster(recipe.pose),
    extraImages: recipe.extraImages?.map(item => ({ ...item, url: image(item.url), ...(item.cropUrl && { cropUrl: image(item.cropUrl) }) })),
    ...(recipe.workflowImages && { workflowImages: Object.fromEntries(Object.entries(recipe.workflowImages)
      .map(([id, item]) => [id, { ...item, url: image(item.url) }])) }),
    workflowImagesIdentity: recipe.workflowImagesIdentity,
  }
}
function mapHistory(history: GenerationHistoryItem[], image: (value: string) => string) {
  if (history.length > MAX_HISTORY) return invalid()
  return history.map(item => ({
    ...item, imageUrl: image(item.imageUrl),
    ...(item.snapshot && { snapshot: { ...item.snapshot, recipe: mapRecipe(item.snapshot.recipe, image) } }),
  }))
}

export function serializeAndroidBackup(backup: AndroidBackup): Uint8Array {
  const draft = validateAndroidDraftSettings(backup)
  // Preserve full resolution while storing each repeated image only once.
  const images: string[] = []
  const indexes = new Map<string, number>()
  let imageSize = 0
  let expanded = 0
  const intern = (image: string) => {
    expanded += image.length
    if (expanded > MAX_EXPANDED_IMAGE_CHARACTERS) throw new Error('完整备份的配方图片过多，未生成备份文件')
    let index = indexes.get(image)
    if (index === undefined) {
      const valid = checkInline(image)
      index = images.length
      imageSize += valid.length
      if (imageSize > ANDROID_BACKUP_MAX_BYTES || index >= MAX_IMAGES) throw new Error('完整备份超过 50 MiB，未生成备份文件')
      indexes.set(valid, index)
      images.push(valid)
    }
    return `img/${index}`
  }
  const content = validateStudioBackup({
    format: 'pose-atlas-backup', version: 1, recipe: mapRecipe(backup.recipe, intern), history: mapHistory(backup.history, intern),
  })
  const bytes = new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: 1, ...draft, recipe: content.recipe, history: content.history, images }))
  if (bytes.length > ANDROID_BACKUP_MAX_BYTES) throw new Error('完整备份超过 50 MiB，未生成备份文件')
  return bytes
}

export function parseAndroidBackup(source: string): AndroidBackup {
  let raw: unknown
  try { raw = JSON.parse(source) } catch { return invalid() }
  const data = obj(raw)
  if (data.format !== FORMAT || data.version !== 1) throw new Error('请选择此安卓版导出的备份，不支持旧版或电脑版备份')
  const draft = validateAndroidDraftSettings(data)
  if (!Array.isArray(data.images) || data.images.length > MAX_IMAGES) return invalid()
  const images = data.images.map(checkInline)
  let expanded = 0
  const fromTable = (image: string): string => {
    const match = TOKEN.exec(image)
    const value = match && images[Number(match[1])]
    if (!value || (expanded += value.length) > MAX_EXPANDED_IMAGE_CHARACTERS) return invalid()
    return value
  }
  const content = validateStudioBackup({ format: 'pose-atlas-backup', version: 1, recipe: data.recipe, history: data.history })
  return { ...draft, recipe: mapRecipe(content.recipe, fromTable), history: mapHistory(content.history, fromTable) }
}

function binaryBytes(data: string, length: number) {
  if (typeof data !== 'string' || data.length !== Math.ceil(length / 3) * 4) return invalid()
  const binary = atob(data)
  if (binary.length !== length) return invalid()
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}
export async function readAndroidBackup(bridge: AndroidBackupBridge): Promise<AndroidBackup | null> {
  const picked = await bridge.pickBackup()
  if ('cancelled' in picked) return null
  const { token, size } = picked
  try {
    if (!Number.isInteger(size) || size < 1 || size > ANDROID_BACKUP_MAX_BYTES) throw new Error('备份为空或超过 50 MiB')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const text: string[] = []
    for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
      const { data } = await bridge.readBackupChunk({ token, offset })
      text.push(decoder.decode(binaryBytes(data, Math.min(size - offset, CHUNK_BYTES)), { stream: true }))
    }
    text.push(decoder.decode())
    return parseAndroidBackup(text.join(''))
  } finally { await bridge.closeBackupRead({ token }).catch(() => {}) }
}
export async function writeAndroidBackup(bridge: AndroidBackupBridge, bytes: Uint8Array): Promise<boolean> {
  if (bytes.length < 1 || bytes.length > ANDROID_BACKUP_MAX_BYTES) throw new Error('备份为空或超过 50 MiB')
  const picked = await bridge.createBackup({ size: bytes.length })
  if ('cancelled' in picked) return false
  const { token } = picked
  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES)
      let text = ''
      for (let i = 0; i < chunk.length; i += 8192) text += String.fromCharCode(...chunk.subarray(i, i + 8192))
      await bridge.writeBackupChunk({ token, offset, data: btoa(text) })
    }
    await bridge.finishBackup({ token })
    return true
  } catch (error) {
    await bridge.cancelBackup({ token }).catch(() => {})
    throw error
  }
}
