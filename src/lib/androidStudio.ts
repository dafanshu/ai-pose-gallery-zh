import type { AndroidBackupBridge } from './androidBackup'
import type { AndroidGalleryBridge } from './androidGallery'
import type { ApiConfig, RecipeState } from '@/types/gallery'
import { poseImagePath } from './recipeImages'

import { isAndroidStudio } from './androidTarget'
export { isAndroidStudio } from './androidTarget'
export const ANDROID_DEFAULT_IMAGE_MODEL = 'gpt-image-2.6-flare'
export const ANDROID_IMAGE_MODELS = [
  { value: ANDROID_DEFAULT_IMAGE_MODEL, label: 'GPT Image 2.6 Flare' },
  { value: 'gpt-image-2.6-sunburst', label: 'GPT Image 2.6 Sunburst' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
] as const
export const ANDROID_PROVIDERS = [
  { id: 'gpt', name: 'OpenAI GPT Image', endpoint: 'https://api.openai.com', models: ANDROID_IMAGE_MODELS, limit: 6 },
  { id: 'gemini', name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com', models: [
    { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
  ], limit: 3 },
  { id: 'qwen', name: '阿里云百炼 Qwen', endpoint: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com', models: [
    { value: 'qwen-image-3.0-pro', label: 'Qwen Image 3.0 Pro' },
    { value: 'qwen-image-3.0', label: 'Qwen Image 3.0' },
  ], limit: 3 },
  { id: 'doubao', name: '火山方舟 Doubao', endpoint: 'https://ark.cn-beijing.volces.com', models: [
    { value: 'doubao-seedream-5-5-261028', label: 'Seedream 5.5' },
    { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  ], limit: 6 },
] as const
export type AndroidProvider = (typeof ANDROID_PROVIDERS)[number]['id']
export function getAndroidProvider(id: string) {
  return ANDROID_PROVIDERS.find(provider => provider.id === id)
}
export const ANDROID_REFERENCE_LIMIT = 6

export type AndroidPhoto = { dataUrl: string; name: string } | { cancelled: true }
type GenerationRequest = { provider: AndroidProvider; model: string; prompt: string; images: string[]; size: string; quality: string }
interface RoleStudioBridge extends AndroidGalleryBridge, AndroidBackupBridge {
  keyStatus(input: { provider: AndroidProvider }): Promise<{ configured: boolean; workspaceId?: string }>
  saveKey(input: { provider: AndroidProvider; key: string; workspaceId?: string }): Promise<void>
  pasteKeyFromClipboard(): Promise<{ key: string }>
  clearKey(input: { provider: AndroidProvider }): Promise<void>
  pickImage(): Promise<AndroidPhoto>
  generate(input: GenerationRequest): Promise<{ dataUrl: string }>
  saveImage(input: { dataUrl: string; name: string }): Promise<void>
}
type CapacitorWindow = Window & { Capacitor?: { getPlatform?: () => string; Plugins?: { RoleStudio?: RoleStudioBridge } } }

function bridge(): RoleStudioBridge {
  const cap = typeof window === 'undefined' ? undefined : (window as CapacitorWindow).Capacitor
  const plugin = cap?.Plugins?.RoleStudio
  if (!isAndroidStudio() || cap?.getPlatform?.() !== 'android' || !plugin) {
    throw new Error('此功能需要安装并打开安卓版')
  }
  return plugin
}

export const androidStudio: RoleStudioBridge = {
  keyStatus: async (input) => bridge().keyStatus(input),
  saveKey: async (input) => bridge().saveKey(input),
  pasteKeyFromClipboard: async () => bridge().pasteKeyFromClipboard(),
  clearKey: async (input) => bridge().clearKey(input),
  pickImage: async () => bridge().pickImage(),
  pickGalleryPack: async () => bridge().pickGalleryPack(),
  readGalleryPackChunk: async (input) => bridge().readGalleryPackChunk(input),
  closeGalleryPack: async (input) => bridge().closeGalleryPack(input),
  pickBackup: async () => bridge().pickBackup(),
  readBackupChunk: async (input) => bridge().readBackupChunk(input),
  closeBackupRead: async (input) => bridge().closeBackupRead(input),
  createBackup: async (input) => bridge().createBackup(input),
  writeBackupChunk: async (input) => bridge().writeBackupChunk(input),
  finishBackup: async (input) => bridge().finishBackup(input),
  cancelBackup: async (input) => bridge().cancelBackup(input),
  generate: async (input) => bridge().generate(input),
  saveImage: async (input) => bridge().saveImage(input),
}

const sizes = new Set<string>(['auto', '1024x1024', '1024x1536', '1536x1024'])
const qualities = new Set<string>(['auto', 'low', 'medium', 'high'])
const localRaster = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

/** History and imported backups are data, not authority to initiate another provider connection. */
export function androidFormConfig(config: ApiConfig): ApiConfig {
  const providers = { ...config.providers }
  for (const { id, endpoint, models } of ANDROID_PROVIDERS) {
    const selected = providers[id].model
    providers[id] = { baseUrl: endpoint, apiKey: '', customModel: '',
      model: models.some(item => item.value === selected) ? selected : models[0].value }
  }
  providers.comfyui = { baseUrl: '', model: '', customModel: '', apiKey: '' }
  return {
    ...config,
    activeProvider: getAndroidProvider(config.activeProvider)?.id ?? 'gpt',
    imagePassMode: 'base64',
    useProxy: false,
    sendStitchedSheet: false,
    providers,
    gptParams: {
      endpointMode: 'images_edits',
      size: sizes.has(config.gptParams.size) ? config.gptParams.size : '1024x1536',
      quality: qualities.has(config.gptParams.quality) ? config.gptParams.quality : 'medium',
      inputFidelity: 'omit', background: 'auto', outputFormat: 'png', moderation: 'auto',
    },
  }
}

export function androidReferenceImages(recipe: RecipeState): string[] {
  const refs = [
    recipe.portrait && (recipe.portrait.原图 || recipe.portrait.缩略图),
    recipe.costume && (recipe.costume.预览图 || recipe.costume.原图 || recipe.costume.缩略图),
    recipe.pose && poseImagePath(recipe.pose),
    ...(recipe.extraImages || []).map(item => item.url),
  ].filter((value): value is string => Boolean(value))
  if (refs.length < 1 || refs.length > ANDROID_REFERENCE_LIMIT) {
    throw new Error('请选择 1–6 张本地参考图')
  }
  if (refs.some(value => !localRaster.test(value))) {
    throw new Error('历史参考图未存入备份或不是本地图片。请从图库重选，或重新添加附加参考图后再生成。')
  }
  return refs
}

export function androidGenerationRequest(recipe: RecipeState, config: ApiConfig, prompt: string): GenerationRequest {
  const provider = getAndroidProvider(config.activeProvider)
  if (!provider) throw new Error('请选择安卓版支持的厂商')
  const model = config.providers[provider.id].model
  const { size, quality } = config.gptParams
  if (!provider.models.some(item => item.value === model) ||
      (provider.id === 'gpt' && (!sizes.has(size) || !qualities.has(quality)))) {
    throw new Error('请选择安卓版支持的模型和输出选项')
  }
  if (!prompt.trim() || prompt.length > (provider.id === 'gpt' ? 32000 : 4000)) throw new Error('请检查提示词长度')
  const images = androidReferenceImages(recipe)
  if (images.length > provider.limit) throw new Error(`${provider.name} 最多支持 ${provider.limit} 张参考图，请减少参考图后再试`)
  return { provider: provider.id, model, prompt, size: provider.id === 'gpt' ? size : '', quality: provider.id === 'gpt' ? quality : '', images }
}
