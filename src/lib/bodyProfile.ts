export const BODY_VOLUME_LEVELS = [
  { id: 'very_slim', label: '非常纤细', promptZh: '整体体积很轻巧，软组织量明显偏少，外轮廓细窄但保持自然', promptEn: 'A distinctly small overall body volume with very little soft-tissue fullness and a slender yet natural outline.' },
  { id: 'slim', label: '偏纤细', promptZh: '整体体积偏小，软组织较少，外轮廓自然收敛', promptEn: 'A small overall body volume with reduced soft-tissue fullness and a naturally narrow outline.' },
  { id: 'lean', label: '轻盈紧实', promptZh: '整体体积轻盈，软组织轮廓紧实、线条清晰，不额外强调肌肉', promptEn: 'A light overall body volume with a compact, defined soft-tissue outline, without extra muscular emphasis.' },
  { id: 'slightly_slim', label: '略偏纤细', promptZh: '整体体积略低于自然适中，软组织略少，外轮廓只有轻微收窄', promptEn: 'A slightly smaller-than-moderate body volume with subtly reduced soft-tissue fullness and a gently narrower outline.' },
  { id: 'moderate', label: '自然适中', promptZh: '整体体积自然适中，软组织不刻意减薄或增厚，外轮廓自然', promptEn: 'A moderate, natural body volume with neither reduced nor enhanced soft-tissue fullness and a natural outline.' },
  { id: 'slightly_full', label: '微丰盈', promptZh: '整体体积略高于自然适中，软组织稍微饱满，外轮廓轻微柔和', promptEn: 'A slightly above-moderate body volume with a modest increase in soft-tissue fullness and a gently softened outline.' },
  { id: 'full', label: '丰盈', promptZh: '整体体积较充实，软组织饱满感清楚，外轮廓自然圆润', promptEn: 'A clearly full overall body volume with noticeable soft-tissue fullness and a naturally rounded outline.' },
  { id: 'plump', label: '丰满', promptZh: '整体体积明显充实，软组织较为厚实，外轮廓饱满而柔和', promptEn: 'A noticeably substantial body volume with fuller soft tissue and a soft, rounded outline.' },
  { id: 'plus_size', label: '大体量', promptZh: '整体呈大体量，软组织总体更充实，外轮廓宽阔而饱满', promptEn: 'A large overall body volume with abundant soft-tissue fullness and a broad, full outline.' },
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
  '纤细': '线条简洁，轮廓转折轻巧',
  '自然匀称': '线条自然协调',
  '健美': '线条有力量感，局部形态以对应参数为准',
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
  legRatio: { label: '腿身比例', options: ['标准', '自然修长', '偏长'], default: '自然修长' },
  limbShape: { label: '四肢形态', options: ['标准', '纤细修长', '自然健美'], default: '标准' },
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
    `整体线条${BODY_TYPE_LINES[profile.bodyType]}`,
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
  const extra = profile.customDescription.trim()
  return [
    '【独立人物形体设定】',
    outline.join('，') + '。',
    `身体总体积：${bodyVolumeLevel(profile.bodyVolume).promptZh}。只调整全身软组织体量和整体外轮廓，不改变头身比例、骨骼长度、肩宽、腰线位置或腿身比例；胸部、腰部及四肢的局部形态仍由各自参数决定。`,
    extra && `补充形体细节（如冲突，以以上结构化参数为准）：${extra}`,
    '这是人物身体结构和人体比例的唯一基准；不沿用参考人物的骨骼长度、身体尺寸、体积或轮廓。换服饰、姿势、镜头与画风时保持同一形体；只允许自然关节运动、透视、衣料厚度与遮挡引起的视觉变化。',
  ].filter(Boolean).join('\n')
}

export function bodyDescriptionConflicts(profile: BodyProfile): boolean {
  const mentions = [...profile.customDescription.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*头身/g)]
  return mentions.some(match => Number(match[1]) !== profile.headRatio)
}
