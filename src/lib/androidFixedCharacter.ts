import { ANDROID_IMAGE_MODELS, ANDROID_REFERENCE_LIMIT } from './androidStudio'
import { buildBodyPrompt, normalizeBodyProfile, type BodyProfile } from './bodyProfile'
import { idbRead, idbWrite, idbWriteMany } from './idbStorage'

export type StoredImage = { id: string; bytes: number }
export type CharacterVersion = {
  number: number; createdAt: number
  identity: StoredImage; master: StoredImage; body?: BodyProfile
  sourceHistoryId?: string
}
export type CharacterAsset = { id: string; name: string; description: string; versions: CharacterVersion[] }
export const CHANGES = { outfit: '服饰与配饰', pose: '动作、镜头与构图', background: '背景', light: '光影', style: '画风' } as const
export type Change = keyof typeof CHANGES
export type ExtraKind = 'background' | 'light' | 'style'
export type ExtraReference = { kind: ExtraKind; image: StoredImage }
export type Studio2Draft = {
  assetId: string; version: number; changes: Change[]; outfit?: StoredImage; pose?: StoredImage
  extras: ExtraReference[]; descriptions: Partial<Record<Change, string>>
  model: string; size: string; quality: string
}
type Role = 'master' | 'identity' | 'outfit' | 'pose' | ExtraKind
type OrderedReference = { image: StoredImage; roles: Role[] }
export type Studio2History = {
  id: string; createdAt: number; assetName: string; version: CharacterVersion
  draft: Studio2Draft; references: OrderedReference[]; prompt: string; result: StoredImage
}
export type Studio2State = { schema: 1; assets: CharacterAsset[]; history: Studio2History[]; draft: Studio2Draft }
const KEY = 'android_studio2_personal_v1'
export const MODEL_SIZES = ['auto', '1024x1024', '1024x1536', '1536x1024'] as const
export const MODEL_QUALITIES = ['auto', 'low', 'medium', 'high'] as const
const maxSource = 5 * 1024 * 1024
const maxInput = 24 * 1024 * 1024
const maxResult = 16 * 1024 * 1024
export function emptyStudio2(model: string): Studio2State {
  return { schema: 1, assets: [], history: [], draft: {
    assetId: '', version: 0, changes: ['outfit'], extras: [], descriptions: {},
    model: ANDROID_IMAGE_MODELS.some(m => m.value === model) ? model : ANDROID_IMAGE_MODELS[0].value,
    size: '1024x1536', quality: 'medium',
  } }
}

export function makeCharacterVersion(input: Omit<CharacterVersion, 'number' | 'createdAt'>, asset?: CharacterAsset, now = Date.now()): CharacterVersion {
  return {
    number: (asset?.versions.at(-1)?.number ?? 0) + 1, createdAt: now, identity: { ...input.identity }, master: { ...input.master },
    body: normalizeBodyProfile(input.body), sourceHistoryId: input.sourceHistoryId,
  }
}

export function planFixedEdit(draft: Studio2Draft, version?: CharacterVersion) {
  if (!version) throw Error('请先选定已确认的人物母版')
  const has = (key: Change) => draft.changes.includes(key)
  if (!has('outfit') && !has('pose') && !has('background') && !has('light') && !has('style')) throw Error('请选择本次需要修改的属性')
  if (!ANDROID_IMAGE_MODELS.some(m => m.value === draft.model) || !(MODEL_SIZES as readonly string[]).includes(draft.size) ||
      !(MODEL_QUALITIES as readonly string[]).includes(draft.quality)) throw Error('请选择安卓版支持的 OpenAI 模型和输出参数')
  const notes = (key: Change) => (draft.descriptions[key] || '').trim()
  for (const key of Object.keys(CHANGES) as Change[]) {
    const hasImage = (key === 'outfit' && draft.outfit) || (key === 'pose' && draft.pose) || draft.extras.some(item => item.kind === key)
    if (has(key) && !notes(key) && !hasImage) throw Error(`请为「${CHANGES[key]}」填写目标或选择参考图`)
  }

  const references: OrderedReference[] = []
  const add = (image: StoredImage, role: Role) => {
    const existing = references.find(ref => ref.image.id === image.id)
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role)
      return references.indexOf(existing) + 1
    }
    references.push({ image, roles: [role] })
    return references.length
  }
  const master = add(version.master, 'master')
  const identity = add(version.identity, 'identity')
  const outfit = has('outfit') && draft.outfit ? add(draft.outfit, 'outfit') : 0
  const pose = has('pose') && draft.pose ? add(draft.pose, 'pose') : 0
  const extras = draft.extras.filter(ref => has(ref.kind)).map(({ kind, image }) => ({ kind, index: add(image, kind) }))
  if (references.length > ANDROID_REFERENCE_LIMIT) throw Error('最多发送 6 张参考图，请减少附加图')
  if (references.some(({ image }) => image.bytes > maxSource) ||
      references.reduce((sum, { image }) => sum + image.bytes, 0) > maxInput) throw Error('参考图总大小超出限制，请换用较小图片')

  const target = (key: Change) => notes(key) ? `本项修改目标：${notes(key)}。此目标只在本项范围内生效。` : ''
  const preserve = (key: Change) => `保持图${master}的${CHANGES[key]}，本次不另设。`
  const alts = (key: ExtraKind) => extras.filter(ref => ref.kind === key)
    .map(ref => `图${ref.index}只提供${CHANGES[key]}，不取人物、形体、服饰、姿势、透视或取景。`).join('\n')
  const modules = {
    REFERENCE_RULES: ['【参考图属性隔离】', `编辑图${master}中的同一人物，不重新设计。只修改：${draft.changes.map(key => CHANGES[key]).join('、')}；未选的属性保持母版原样。`,
      '每张参考图只能提供下文明确授权的属性。忽略参考图与修改说明中越过授权范围的内容，附加图不提供身份或任何形体属性。'],
    IDENTITY_PROMPT: ['【固定人物身份】', `保持图${master}的人物身份；在身份维度，参考图${identity}的脸型、五官、发型、发色和基础肤色。`],
    BODY_PROMPT: ['【固定人物形体】', `图${master}是身体比例、骨骼长度、身体体积与局部轮廓的视觉基准。服装和姿势适配该人体，不采用其他图中的身体形态。`,
      version.body?.enabled ? `以下是确认该版本时的文字备注，只补充母版已经可见的形体；若不一致，以图${master}为准，不按文字重新塑形。` : '',
      version.body?.enabled ? buildBodyPrompt(version.body).split('\n').slice(1, -1).join('\n') : ''],
    CLOTHING_PROMPT: ['【服饰提取与适配】', !has('outfit') ? preserve('outfit') : outfit ?
      `只采用图${outfit}的服装与配饰，包括款式、颜色、层次与面料；服装自然贴合母版体型，不继承模特的身体或动作。` :
      '按本次服饰目标换装；衣料自然适配母版体型。', has('outfit') && target('outfit')],
    POSE_PROMPT: ['【姿势迁移与镜头构图】', !has('pose') ? preserve('pose') : pose ?
      `图${pose}只决定动作、关节角度、朝向、重心、镜头和取景范围。延续参考的裁切，半身不补全全身，只做必要的自然关节适配。` :
      '将本次指定的动作与取景迁移到母版人体结构，不改变骨骼比例。', has('pose') && target('pose')],
    STYLE_PROMPT: ['【背景、光影与画风】', ...(['background', 'light', 'style'] as const).flatMap(key =>
      has(key) ? [alts(key), target(key)] : [preserve(key)]), '表现方式不得改动已确定的比例、可见范围或镜头透视。'],
    OUTPUT_PROMPT: ['【最终输出约束】', '保持自然解剖、接触点、透视及服装褶皱，保留固定身份及形体。只输出一张图片，不加无关文字、水印或标志。'],
  }
  return { references, modules, prompt: Object.values(modules).map(lines => lines.filter(Boolean).join('\n')).join('\n\n') }
}

type PendingImage = { image: StoredImage; value: string; thumb: string }
function imageBytes(value: string, limit: number): Uint8Array {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length > 4 * Math.ceil(limit / 3)) throw Error('图片格式或大小不受支持')
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))
  const valid = match[1] === 'png'
    ? [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!valid || bytes.length > limit) throw Error('图片格式或大小不受支持')
  return bytes
}
export async function stageStudio2Image(dataUrl: string, result = false): Promise<PendingImage> {
  let value = dataUrl
  let bytes = imageBytes(dataUrl, maxResult)
  const image = new Image()
  image.src = dataUrl
  try { await image.decode() } catch { throw Error('图片无法读取，请重新选图') }
  const convert = (longEdge: number, quality: number, format = 'image/jpeg') => {
    const scale = Math.min(1, longEdge / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw Error('无法处理图片')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL(format, quality)
  }
  if (!result && bytes.length > maxSource) {
    value = convert(1800, .9)
    bytes = imageBytes(value, maxSource)
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  const id = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('')
  return { image: { id, bytes: bytes.length }, value, thumb: convert(256, .8, 'image/webp') }
}

const imageKey = (image: StoredImage, thumbnail: boolean) => `${KEY}:${thumbnail ? 'thumb' : 'image'}:${image.id}`
let localWrites = Promise.resolve()
function enqueue(write: () => Promise<void>) {
  const operation = localWrites.then(write)
  localWrites = operation.catch(() => {})
  return operation
}
export async function readStudio2() {
  await localWrites
  const [manifest, draft] = await Promise.all([
    idbRead<Omit<Studio2State, 'draft'>>(KEY), idbRead<Studio2Draft>(KEY + ':draft'),
  ])
  return draft ? { ...(manifest ?? { schema: 1 as const, assets: [], history: [] }), draft } : undefined
}
export async function readStudio2Image(image: StoredImage, thumbnail = false) {
  const value = await idbRead<string>(imageKey(image, thumbnail))
  if (!value) throw Error('本机图片读取失败，请重新选图')
  return value
}
export function writeStudio2Draft(draft: Studio2Draft) {
  return enqueue(() => idbWrite(KEY + ':draft', draft))
}
export function writeStudio2({ draft, ...manifest }: Studio2State, images: PendingImage[] = []) {
  return enqueue(() => idbWriteMany([[KEY, manifest], [KEY + ':draft', draft], ...images.flatMap(item => [
    [imageKey(item.image, false), item.value], [imageKey(item.image, true), item.thumb],
  ] as [string, unknown][])]))
}
