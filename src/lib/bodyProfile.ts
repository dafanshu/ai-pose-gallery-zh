export const BODY_OPTIONS = {
  bodyType: { label: '整体体型', options: ['纤细', '自然匀称', '健美', '丰盈'], default: '自然匀称' },
  shoulderWidth: { label: '肩宽', options: ['偏窄', '适中', '偏宽'], default: '适中' },
  neckLength: { label: '颈部长度', options: ['偏短', '标准', '修长'], default: '标准' },
  torsoLength: { label: '躯干长度', options: ['偏短', '标准', '偏长'], default: '标准' },
  chestShape: { label: '胸部形态', options: ['偏纤细', '自然适中', '偏丰满'], default: '自然适中' },
  waistShape: { label: '腰部形态', options: ['平直自然', '自然收腰', '曲线明显'], default: '自然收腰' },
  waistlinePosition: { label: '腰线位置', options: ['偏低', '标准', '偏高'], default: '标准' },
  waistHipRatio: { label: '腰臀比例', options: ['曲线柔和', '自然协调', '曲线明显'], default: '自然协调' },
  legRatio: { label: '腿身比例', options: ['标准', '自然修长', '偏长'], default: '自然修长' },
  limbShape: { label: '四肢形态', options: ['标准', '纤细修长', '自然健美'], default: '标准' },
  bodyVolume: { label: '身体丰满程度', options: ['偏纤细', '自然适中', '偏丰盈'], default: '自然适中' },
} as const

type Fields = typeof BODY_OPTIONS
export const BODY_FIELDS = Object.keys(BODY_OPTIONS) as (keyof Fields)[]
export const HEAD_RATIO = { min: 6, max: 9, step: 0.1, default: 7.5 } as const
export const BODY_DESCRIPTION_MAX = 500
export const BODY_PRESET_LIMIT = 40
export type BodyParameters = { [K in keyof Fields]: Fields[K]['options'][number] } &
  { headRatio: number; customDescription: string }
export type BodyProfile = BodyParameters & { enabled: boolean; presetId?: string }
export type BodyPreset = { id: string; name: string; parameters: BodyParameters }

const shapeDefaults = Object.fromEntries(BODY_FIELDS.map(key => [key, BODY_OPTIONS[key].default])) as Pick<BodyParameters, keyof Fields>
export const DEFAULT_BODY: BodyParameters = { ...shapeDefaults, headRatio: HEAD_RATIO.default, customDescription: '' }
export const BUILTIN_BODY_PRESETS: readonly BodyPreset[] = [
  { id: 'natural', name: '自然写实', parameters: { ...DEFAULT_BODY } },
  { id: 'elegant', name: '修长优雅', parameters: { ...DEFAULT_BODY, headRatio: 8 } },
  { id: 'slender', name: '清秀纤细', parameters: { ...DEFAULT_BODY, bodyType: '纤细', bodyVolume: '偏纤细' } },
  { id: 'full', name: '自然丰盈', parameters: { ...DEFAULT_BODY, bodyType: '丰盈', bodyVolume: '偏丰盈' } },
  { id: 'athletic', name: '健美活力', parameters: { ...DEFAULT_BODY, bodyType: '健美', limbShape: '自然健美' } },
]
export const defaultBodyProfile = (enabled: boolean): BodyProfile => ({ ...DEFAULT_BODY, enabled, presetId: 'natural' })
const obj = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const validCustomId = (id: unknown): id is string => typeof id === 'string' && /^custom-[a-zA-Z0-9-]{1,60}$/.test(id)
export const normalizePresetName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 40)
export function normalizeBodyParameters(value: unknown): BodyParameters {
  const source = obj(value)
  const options = Object.fromEntries(BODY_FIELDS.map(key => {
    const field = BODY_OPTIONS[key], option = source?.[key]
    return [key, (field.options as readonly unknown[]).includes(option) ? option : field.default]
  })) as Pick<BodyParameters, keyof Fields>
  const ratio = source?.headRatio
  return {
    ...options,
    headRatio: typeof ratio === 'number' && Number.isFinite(ratio) ? Math.round(Math.min(HEAD_RATIO.max, Math.max(HEAD_RATIO.min, ratio)) * 10) / 10 : DEFAULT_BODY.headRatio,
    customDescription: typeof source?.customDescription === 'string' ? source.customDescription.slice(0, BODY_DESCRIPTION_MAX) : '',
  }
}
export function normalizeBodyProfile(value: unknown): BodyProfile | undefined {
  const source = obj(value)
  if (!source || typeof source.enabled !== 'boolean') return undefined
  const { presetId } = source
  return { ...normalizeBodyParameters(source), enabled: source.enabled,
    ...(validCustomId(presetId) || BUILTIN_BODY_PRESETS.some(p => p.id === presetId) ? { presetId: presetId as string } : {}) }
}
export function normalizeBodyPresets(value: unknown): BodyPreset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.slice(0, BODY_PRESET_LIMIT).flatMap((entry): BodyPreset[] => {
    const source = obj(entry)
    if (!source || !validCustomId(source.id) || seen.has(source.id) || typeof source.name !== 'string' || !obj(source.parameters)) return []
    const name = normalizePresetName(source.name)
    if (!name) return []
    seen.add(source.id)
    return [{ id: source.id, name, parameters: normalizeBodyParameters(source.parameters) }]
  })
}
export function buildBodyPrompt(profile: BodyProfile): string {
  if (!profile.enabled) return ''
  const outline = [
    `人物采用 ${profile.headRatio.toFixed(1)} 头身比例（按自然直立比例定义，不按画面投影凑数）`,
    `整体体型${profile.bodyType}`,
    `肩宽${profile.shoulderWidth}`,
    `颈部长度${profile.neckLength}`,
    `躯干长度${profile.torsoLength}`,
    `胸部形态${profile.chestShape}`,
    `腰部${profile.waistShape}`,
    `腰线位置${profile.waistlinePosition}`,
    `腰臀比例${profile.waistHipRatio}`,
    `腿部${profile.legRatio}`,
    `四肢${profile.limbShape === '标准' ? '比例自然' : profile.limbShape}`,
  ]
  const repeatsBuild = (profile.bodyType === '丰盈' && profile.bodyVolume === '偏丰盈') || (profile.bodyType === '纤细' && profile.bodyVolume === '偏纤细')
  if (!repeatsBuild) {
    outline.push(`身体丰满程度${profile.bodyVolume}`)
  }
  const extra = profile.customDescription.trim()
  return [
    '【独立人物形体设定】',
    outline.join('，') + '。',
    extra && `补充形体细节（如冲突，以以上结构化参数为准）：${extra}`,
    '这是人物身体结构和人体比例的唯一基准；不沿用参考人物的骨骼长度、身体尺寸、体积或轮廓。换服饰、姿势、镜头与画风时保持同一形体；只允许自然关节运动、透视、衣料厚度与遮挡引起的视觉变化。',
  ].filter(Boolean).join('\n')
}

export function bodyDescriptionConflicts(profile: BodyProfile): boolean {
  const mentions = [...profile.customDescription.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*头身/g)]
  return mentions.some(match => Number(match[1]) !== profile.headRatio)
}
