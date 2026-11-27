export const BODY_VOLUME_LEVELS = [
  { id: 'very_slim', label: '非常纤细', promptZh: '全身软组织总体量很少，整体体积轻巧', promptEn: 'A distinctly small overall body volume with very little soft-tissue fullness.' },
  { id: 'slim', label: '偏纤细', promptZh: '全身软组织总体量偏少，整体体积偏小', promptEn: 'A small overall body volume with reduced soft-tissue fullness.' },
  { id: 'lean', label: '轻盈紧实', promptZh: '全身软组织总体量偏轻，呈紧实质感，不额外强调肌肉', promptEn: 'A light overall soft-tissue volume with a firm appearance and no extra muscular emphasis.' },
  { id: 'slightly_slim', label: '略偏纤细', promptZh: '全身软组织总体量略低于自然适中', promptEn: 'Slightly below-moderate overall soft-tissue volume.' },
  { id: 'moderate', label: '自然适中', promptZh: '全身软组织总体量自然适中，不刻意减薄或增厚', promptEn: 'A natural, moderate overall soft-tissue volume without deliberate thinning or thickening.' },
  { id: 'slightly_full', label: '微丰盈', promptZh: '全身软组织总体量略高于自然适中，稍显饱满', promptEn: 'Slightly above-moderate overall soft-tissue volume with modest fullness.' },
  { id: 'full', label: '丰盈', promptZh: '全身软组织总体量较充实，饱满感清楚', promptEn: 'A clearly full overall soft-tissue volume.' },
  { id: 'plump', label: '丰满', promptZh: '全身软组织总体量明显充实，质感饱满柔和', promptEn: 'A noticeably substantial overall soft-tissue volume, with a soft, full appearance.' },
  { id: 'plus_size', label: '大体量', promptZh: '全身软组织总体呈大体量，整体饱满', promptEn: 'A large overall soft-tissue volume with abundant fullness.' },
] as const

type BodyVolumeId = (typeof BODY_VOLUME_LEVELS)[number]['id']
const DEFAULT_VOLUME = 'moderate'
function normalizeBodyVolume(value: unknown): BodyVolumeId {
  if (value === '偏纤细') return 'slim'
  if (value === '自然适中') return 'moderate'
  if (value === '偏丰盈') return 'full'
  return BODY_VOLUME_LEVELS.find(level => level.id === value)?.id ?? DEFAULT_VOLUME
}
export function bodyVolumeLevel(value: unknown) {
  return BODY_VOLUME_LEVELS.find(level => level.id === normalizeBodyVolume(value))!
}

// Keep existing body-type selections and preset IDs; express their line quality,
// not a second instruction for total tissue volume.
const BODY_TYPE_LINES = {
  '纤细': '简洁，轮廓转折轻巧',
  '自然匀称': '自然协调',
  '健美': '有力量感',
  '丰盈': '曲线连贯、转折柔和',
} as const

export const BODY_OPTIONS = {
  bodyType: { label: '整体体型', options: ['纤细', '自然匀称', '健美', '丰盈'], default: '自然匀称' },
  shoulderWidth: { label: '肩宽', options: ['偏窄', '适中', '偏宽'], default: '适中' },
  neckLength: { label: '颈部长度', options: ['偏短', '标准', '修长'], default: '标准' },
  torsoLength: { label: '躯干长度', options: ['偏短', '标准', '偏长'], default: '标准' },
  chestShape: { label: '胸部形态', options: ['偏纤细', '自然适中', '偏丰满'], default: '自然适中' },
  waistShape: { label: '腰部形态', options: ['平直自然', '自然收腰', '曲线明显'], default: '自然收腰' },
  waistlinePosition: { label: '腰线位置', options: ['偏低', '标准', '偏高'], default: '标准' },
  waistHipRatio: { label: '腰臀比例', options: ['曲线柔和', '自然协调', '曲线明显'], default: '自然协调' },
  hipWidth: { label: '臀胯宽度', options: ['偏窄', '适中', '偏宽'], default: '适中' },
  legThickness: { label: '腿部粗细', options: ['偏细', '适中', '偏粗'], default: '适中' },
  legRatio: { label: '腿身比例', options: ['标准', '自然修长', '偏长'], default: '自然修长' },
  limbShape: { label: '手臂形态', options: ['标准', '纤细修长', '自然健美'], default: '标准' },
  bodyVolume: { label: '身体丰满程度', options: BODY_VOLUME_LEVELS.map(level => level.id), default: DEFAULT_VOLUME },
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
  { id: 'slender', name: '清秀纤细', parameters: { ...DEFAULT_BODY, bodyType: '纤细', bodyVolume: 'slim' } },
  { id: 'full', name: '自然丰盈', parameters: { ...DEFAULT_BODY, bodyType: '丰盈', bodyVolume: 'full' } },
  { id: 'athletic', name: '健美活力', parameters: { ...DEFAULT_BODY, bodyType: '健美', limbShape: '自然健美' } },
]
export const defaultBodyProfile = (enabled: boolean): BodyProfile => ({ ...DEFAULT_BODY, enabled, presetId: 'natural' })
const obj = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const validCustomId = (id: unknown): id is string => typeof id === 'string' && /^custom-[a-zA-Z0-9-]{1,60}$/.test(id)
export const normalizePresetName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 40)
export function normalizeBodyParameters(value: unknown): BodyParameters {
  const source = obj(value)
  const options = Object.fromEntries(BODY_FIELDS.map(key => {
    if (key === 'bodyVolume') return [key, normalizeBodyVolume(source?.[key])]
    const field = BODY_OPTIONS[key], option = source?.[key]
    if (key === 'legThickness' && option === undefined && source?.limbShape === '纤细修长') return [key, '偏细']
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
// Only these two local dimensions may be sourced from a supplemental image.
export const LOCAL_BODY_FIELDS = ['legThickness', 'hipWidth'] as const
export type LocalBodyField = typeof LOCAL_BODY_FIELDS[number]
export type LocalBodySources = Partial<Record<LocalBodyField, number>>
type LocalBodyReference = { id: string; bodyOverrides?: readonly LocalBodyField[] }

export function resolveLocalBodySources(references: readonly LocalBodyReference[], firstImage: number): LocalBodySources {
  const sources: LocalBodySources = {}
  references.forEach((reference, offset) => {
    for (const key of LOCAL_BODY_FIELDS) {
      // The editor keeps one owner per field; prefer the first if imported data lists several.
      if (sources[key] === undefined && Array.isArray(reference.bodyOverrides) && reference.bodyOverrides.includes(key)) {
        sources[key] = firstImage + offset
      }
    }
  })
  return sources
}

export function selectLocalBodySource<T extends LocalBodyReference>(
  references: readonly T[], id: string, field: LocalBodyField, selected: boolean,
): T[] {
  if (!references.some(reference => reference.id === id)) return [...references]
  return references.map(reference => {
    if (!selected && reference.id !== id) return reference
    return { ...reference, bodyOverrides: LOCAL_BODY_FIELDS.filter(key =>
      key === field ? selected && reference.id === id : reference.bodyOverrides?.includes(key)) }
  })
}

const WAIST_HIP_NOTES = {
  '曲线柔和': '腰与臀胯的宽度差较小',
  '自然协调': '腰部相对臀胯自然收束',
  '曲线明显': '腰部相对臀胯明显收束',
} as const
const WAIST_LINES = {
  '平直自然': '腰侧轮廓平顺',
  '自然收腰': '腰侧轮廓平滑过渡',
  '曲线明显': '腰侧轮廓转折清楚',
} as const
const ARM_LINES = { '标准': '比例自然', '纤细修长': '纤细修长', '自然健美': '自然健美' } as const

export function buildBodyPrompt(profile: BodyProfile, sources: LocalBodySources = {}): string {
  if (!profile.enabled) return ''
  const outline = [
    `人物采用 ${profile.headRatio.toFixed(1)} 头身比例（按自然直立比例定义）`,
    `整体线条${BODY_TYPE_LINES[profile.bodyType]}`,
    `肩宽${profile.shoulderWidth}`,
    `颈部长度${profile.neckLength}`,
    `躯干长度${profile.torsoLength}`,
    `胸部形态${profile.chestShape}`,
    WAIST_LINES[profile.waistShape],
    `腰线位置${profile.waistlinePosition}`,
    `腿部长度相对身高${profile.legRatio}`,
    `手臂${ARM_LINES[profile.limbShape]}`,
  ]
  const local = (field: LocalBodyField) => sources[field] === undefined
    ? `${BODY_OPTIONS[field].label}${profile[field] ?? BODY_OPTIONS[field].default}`
    : field === 'legThickness'
      ? `腿部粗细只参考图${sources[field]}可见的大腿和小腿横向厚度，不取腿长`
      : `臀胯宽度只参考图${sources[field]}可见的臀胯横向宽度，不取腰宽或腰臀比例`
  const extra = profile.customDescription.trim()
  return [
    '【独立人物形体设定】',
    outline.join('，') + '。',
    `身体总体积：${bodyVolumeLevel(profile.bodyVolume).promptZh}。仅定义全身软组织总体量，不统一放大或缩小任何局部。`,
    `${local('legThickness')}。${local('hipWidth')}。腰臀比例：${WAIST_HIP_NOTES[profile.waistHipRatio]}，按已确定的臀胯宽度调整腰部相对宽度。`,
    extra && `补充形体细节（不得改变以上已确定的属性）：${extra}`,
    '以上解析后的形体是唯一基准。保持实际结构不变，允许关节运动、自然透视、布料厚度与遮挡造成画面差异。',
  ].filter(Boolean).join('\n')
}

export function bodyDescriptionConflicts(profile: BodyProfile): boolean {
  const mentions = [...profile.customDescription.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*头身/g)]
  return mentions.some(match => Number(match[1]) !== profile.headRatio)
}
