import { LOCAL_BODY_FIELDS, normalizeBodyProfile } from './bodyProfile'
import type { GenerationHistoryItem, GenerationSnapshot, RecipeState } from '../types/gallery'
import { withoutSecrets } from './runtime'

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024
export interface StudioBackup {
  format: 'pose-atlas-backup'
  version: 1
  recipe: RecipeState
  history: GenerationHistoryItem[]
}
type Parser = (value: unknown) => unknown
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const invalid = (): never => { throw new Error('备份中的配方、历史记录或快照格式无效') }
const text: Parser = value => typeof value === 'string' ? value : invalid()
const number: Parser = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid()
const boolean: Parser = value => typeof value === 'boolean' ? value : invalid()
const oneOf = (...values: string[]): Parser => value => typeof value === 'string' && values.includes(value) ? value : invalid()
const optional = (parse: Parser): Parser => value => value === undefined ? undefined : parse(value)
const nullable = (parse: Parser): Parser => value => value === null ? null : parse(value)
const array = (parse: Parser, limit = 10000): Parser => value => Array.isArray(value) && value.length <= limit ? value.map(parse) : invalid()
const dictionary = (parse: Parser): Parser => value => {
  if (!record(value) || Object.keys(value).length > 10000) return invalid()
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return invalid()
    return [key, parse(item)]
  }))
}
/** Rebuild only known fields. Never spread untrusted backup objects into app state. */
const shape = (fields: Record<string, Parser>): Parser => value => {
  if (!record(value)) return invalid()
  return Object.fromEntries(Object.entries(fields).flatMap(([key, parse]) => {
    const parsed = parse(Object.hasOwn(value, key) ? value[key] : undefined)
    return parsed === undefined ? [] : [[key, parsed]]
  }))
}
const image: Parser = value => typeof value === 'string' && value.length <= MAX_BACKUP_BYTES && /^(?:data:image\/(?:png|jpeg|webp|gif);base64,|https?:\/\/|\/?(?:img|thumbs)\/|\/api\/ai-pose-studio\/(?:assets|comfy)\/)/i.test(value) ? value : invalid()
const preview: Parser = value => value === '' ? '' : image(value)
const common = { id: text, 原图: image, 缩略图: image, 检索: text }
const portrait = shape({ ...common, source: optional(oneOf('upload')), 分区: text, 发长: text, 发型名称: text, 标题: text, 宽: number, 高: number, 字节数: number, 精选: boolean, 热门: boolean })
const costumeView = shape({ id: text, label: text, 缩略图: image, 预览图: preview, 原图: image })
const costume = shape({ ...common, source: optional(oneOf('upload', 'charadb', 'gia-anime', 'shisei')), views: optional(array(costumeView)), selectedView: optional(text), 一级分类: optional(oneOf('现实', '二次元')), 来源: optional(text), 来源地址: optional(text), 日文名称: optional(text), 敏感: optional(boolean), 分类: text, 服装名称: text, 标签: array(text), 关键词: text, 预览图: preview })
const pose = shape({ ...common, source: optional(oneOf('upload')), useDepth: optional(boolean), 体系: text, 姿势编号: text, 分类: text, 姿势名称: text, 角度: text })
const extraImage = shape({ id: text, name: text, url: image, cropUrl: optional(image), bodyOverrides: optional(array(oneOf(...LOCAL_BODY_FIELDS), LOCAL_BODY_FIELDS.length)), useFeatures: optional(text), excludeFeatures: optional(text), role: optional(oneOf('character_sheet')) })
const recipe = shape({ bodyProfile: optional(normalizeBodyProfile), portrait: nullable(portrait), costume: nullable(costume), pose: nullable(pose), extraImages: optional(array(extraImage)), workflowImages: optional(dictionary(extraImage)), workflowImagesIdentity: optional(text) })
const provider = oneOf('gemini', 'gpt', 'qwen', 'doubao', 'comfyui')
const scalar: Parser = value => typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value : invalid()
const settings = shape({
  activeProvider: provider, imagePassMode: oneOf('url', 'base64'), useProxy: boolean, stylePreset: text, sendStitchedSheet: boolean,
  gptParams: shape({ endpointMode: oneOf('images_edits_json', 'images_edits', 'responses', 'chat'), size: oneOf('auto', '1024x1536', '1024x1024', '1536x1024'), quality: oneOf('auto', 'low', 'medium', 'high', 'xhigh', 'max'), inputFidelity: oneOf('omit', 'high', 'low'), background: oneOf('auto', 'opaque', 'transparent'), outputFormat: oneOf('png', 'jpeg', 'webp'), moderation: oneOf('auto', 'low') }),
  geminiParams: shape({ endpointMode: oneOf('native', 'openai_chat'), aspectRatio: oneOf('3:4', '1:1', '4:3', '9:16', '16:9'), imageSize: oneOf('1K', '2K', '4K') }),
  qwenParams: shape({ size: oneOf('1024*1536', '1328*1328', '928*1664', '1664*928'), promptExtend: boolean, watermark: boolean, negativePrompt: text, n: number }),
  doubaoParams: shape({ size: oneOf('2K', '4K', '1K', '1728x2304', '2048x2048', '1440x2560', '2560x1440'), sequentialImageGeneration: oneOf('disabled', 'auto'), watermark: boolean, responseFormat: oneOf('b64_json', 'url') }),
  comfyuiParams: shape({ workflowPreset: oneOf('qwen2509_3img', 'qwen2509_2img', 'qwen21_3img', 'qwen21_2img', 'custom'), workflowJson: text, promptNodeId: text, portraitNodeId: text, costumeNodeId: text, poseNodeId: text, stitchedNodeId: text, randomizeSeed: boolean, timeoutSec: number, configVersion: optional(number), parameterOverrides: optional(shape({ workflowId: text, values: dictionary(dictionary(scalar)) })) }),
})
const model = shape({ model: text, customModel: text })
const snapshot = shape({ recipe, prompt: text, customPrompt: optional(nullable(text)), settings, models: shape({ gemini: model, gpt: model, qwen: model, doubao: model, comfyui: model }), submittedExtraOffsets: optional(array(value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 6 ? value : invalid(), 6)), submittedWorkflowJson: optional(text) })
/** Use the same field whitelist for local history and portable backups. */
export function validateGenerationSnapshot(raw: unknown): GenerationSnapshot {
  return withoutSecrets(snapshot(raw)) as GenerationSnapshot
}
const historyItem = shape({ id: text, createdAt: number, provider, model: text, prompt: text, imageUrl: image, recipeSummary: text, snapshot: optional(snapshot) })
const archive = shape({ format: oneOf('pose-atlas-backup'), version: value => value === 1 ? 1 : invalid(), recipe, history: array(historyItem) })
export function parseStudioBackup(source: string): StudioBackup {
  if (new TextEncoder().encode(source).byteLength > MAX_BACKUP_BYTES) throw new Error('备份不能超过 50 MB')
  return validateStudioBackup(JSON.parse(source))
}

export function validateStudioBackup(raw: unknown): StudioBackup {
  if (!record(raw) || raw.format !== 'pose-atlas-backup' || raw.version !== 1) throw new Error('不支持的备份格式或版本')
  const value = archive(raw) as StudioBackup
  const ids = new Set<string>()
  for (const item of value.history) {
    if (ids.has(item.id)) return invalid()
    ids.add(item.id)
  }
  return withoutSecrets(value)
}
export function serializeStudioBackup(recipe: RecipeState, history: GenerationHistoryItem[]): string {
  const source = JSON.stringify(withoutSecrets({ format: 'pose-atlas-backup', version: 1, recipe, history }))
  return JSON.stringify(parseStudioBackup(source))
}
