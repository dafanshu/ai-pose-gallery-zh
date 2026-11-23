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
export const ANDROID_REFERENCE_LIMIT = 6

export type AndroidPhoto = { dataUrl: string; name: string } | { cancelled: true }
type GenerationRequest = { model: string; prompt: string; images: string[]; size: string; quality: string }
interface RoleStudioBridge {
  keyStatus(): Promise<{ configured: boolean }>
  saveKey(input: { key: string }): Promise<void>
  clearKey(): Promise<void>
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
  keyStatus: async () => bridge().keyStatus(),
  saveKey: async (input) => bridge().saveKey(input),
  clearKey: async () => bridge().clearKey(),
  pickImage: async () => bridge().pickImage(),
  generate: async (input) => bridge().generate(input),
  saveImage: async (input) => bridge().saveImage(input),
}

const models = new Set<string>(ANDROID_IMAGE_MODELS.map(item => item.value))
const sizes = new Set<string>(['auto', '1024x1024', '1024x1536', '1536x1024'])
const qualities = new Set<string>(['auto', 'low', 'medium', 'high'])
const localRaster = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/

/** History and imported backups are data, not authority to initiate another provider connection. */
export function androidFormConfig(config: ApiConfig): ApiConfig {
  const selected = config.providers.gpt
  return {
    ...config,
    activeProvider: 'gpt',
    imagePassMode: 'base64',
    useProxy: false,
    sendStitchedSheet: false,
    providers: { ...config.providers, gpt: {
      baseUrl: 'https://api.openai.com', apiKey: '', customModel: '',
      model: models.has(selected.model) ? selected.model : ANDROID_DEFAULT_IMAGE_MODEL,
    } },
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
    throw new Error('历史参考图未存入备份或不是本地图片。请从相册重新选择后再生成。')
  }
  return refs
}

export function androidGenerationRequest(recipe: RecipeState, config: ApiConfig, prompt: string): GenerationRequest {
  const model = config.providers.gpt.model, {size, quality} = config.gptParams
  if (config.activeProvider !== 'gpt' || !models.has(model) || !sizes.has(size) || !qualities.has(quality)) {
    throw new Error('请选择安卓版支持的 OpenAI 模型、尺寸和画质')
  }
  if (!prompt.trim()) throw new Error('请输入提示词')
  return { model, prompt, size, quality, images: androidReferenceImages(recipe) }
}
