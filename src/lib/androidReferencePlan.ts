import type { ExtraReferenceImage, RecipeState } from '@/types/gallery'
import { resolveLocalBodySources } from './bodyProfile'
import { EXTRA_REFERENCE_RULE_MAX } from './recipeImages'

// Match only stand-alone known labels, not arbitrary prose. In particular an old
// free-text body label must never become authorization to transfer anatomy.
const BODY_LABEL = /^(?:(?:胸部(?:形态|形状)?|胸型|胸围)(?:(?:[：:]\s*)?(?:偏丰满|自然适中|偏纤细)|[：:]\s*[^、，,；;]+)?|(?:臀部|臀型|腿长|腿长比例|腿身比例|腰臀比例|胯宽|腿部长度|大腿小腿粗细和长度比例)(?:[：:]\s*)?|(?:粗腿|细腿|大粗腿|宽胯|窄胯)(?:\s+(?:粗腿|细腿|大粗腿|宽胯|窄胯))*|(?:腿部粗细|臀胯宽度|胯宽)(?:[：:]\s*)?(?:偏粗|偏细|偏宽|偏窄|适中)?)$/
const OUTFIT_LABEL = /^(?:服装|服饰|衣服|穿搭|整套服装|整套服饰|上衣|外套|裤子|下装|裙子|连衣裙|帽子|鞋|鞋子|鞋袜|配饰|图中服装)$/
const POSE_LABEL = /^(?:姿势|站姿|坐姿|跪姿|蹲姿|躺姿|动作|肢体动作|构图|镜头|机位|视角|景别|正面|侧面|斜侧|俯视|仰视)$/
const normalizeLabel = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
const DETAIL_LABEL = /^(?:场景|背景|表情|光线|灯光|材质|纹样|色调|道具)$/
const knownLabel = (key: string) => [BODY_LABEL, POSE_LABEL, OUTFIT_LABEL, DETAIL_LABEL].some(pattern => pattern.test(key))
const labels = (value?: string) => (value ?? '').trim().slice(0, EXTRA_REFERENCE_RULE_MAX)
  .split(/[、，,；;\n]/).flatMap(part => {
    const trimmed = part.trim()
    if (!trimmed) return []
    const words = trimmed.split(/\s+/)
    // Recover known legacy lists without treating prose with spaces as separate permissions.
    return words.every(word => knownLabel(normalizeLabel(word))) ? words : [trimmed]
  })

export function extraRuleHasReservedLabels(use?: string): boolean {
  return labels(use).some(part => {
    const key = normalizeLabel(part)
    return BODY_LABEL.test(key) || POSE_LABEL.test(key)
  })
}

const excludesPose = (item: ExtraReferenceImage) => labels(item.excludeFeatures).some(part => POSE_LABEL.test(normalizeLabel(part)))

export function selectExtraPose(extras: readonly ExtraReferenceImage[], id: string, selected: boolean): ExtraReferenceImage[] {
  if (!extras.some(item => item.id === id)) return [...extras]
  return extras.map(item => {
    if (item.id === id) return { ...item, useAsPose: selected || undefined }
    if (!selected || !item.useAsPose) return item
    return { ...item, useAsPose: undefined }
  })
}

export function androidReferencePlan(recipe: RecipeState) {
  const extras = recipe.extraImages ?? []
  const mainPose = recipe.pose ? 1 + Number(Boolean(recipe.portrait)) + Number(Boolean(recipe.costume)) : null
  const extraPoseOffset = mainPose === null ? extras.findIndex(item => item.useAsPose === true && !excludesPose(item)) : -1
  const first = 1 + Number(Boolean(recipe.portrait)) + Number(Boolean(recipe.costume)) + Number(mainPose !== null)
  const selectedBody = recipe.bodyProfile?.enabled ? resolveLocalBodySources(extras, 1) : {}
  const bodyOwners = new Set(Object.values(selectedBody).map(value => value - 1))
  const sent = extras.flatMap((item, offset) => {
    const avoid = labels(item.excludeFeatures).filter(part => !BODY_LABEL.test(normalizeLabel(part)))
    const excluded = new Set(avoid.map(normalizeLabel))
    const ordinary = labels(item.useFeatures)
    const use = ordinary.filter(part => {
      const key = normalizeLabel(part)
      return !BODY_LABEL.test(key) && !POSE_LABEL.test(key) && !excluded.has(key) && !(recipe.costume && OUTFIT_LABEL.test(key))
    })
    const poseAuthorized = offset === extraPoseOffset
    const bodyAuthorized = bodyOwners.has(offset)
    // Preserve the legacy bare-reference behavior only for ordinary cards with
    // no competing main (or explicitly selected) role.
    const generic = !recipe.costume && mainPose === null && extraPoseOffset === -1 &&
      item.useAsPose !== true && !ordinary.length && !bodyAuthorized
    if (!use.length && !bodyAuthorized && !poseAuthorized && !generic) return []
    return [{ item, offset, use, avoid, bodyAuthorized, poseAuthorized }]
  }).map((entry, idx) => ({ ...entry, index: first + idx }))
  const sources = recipe.bodyProfile?.enabled ? resolveLocalBodySources(sent.map(entry => entry.item), first) : {}
  const extraPose = sent.find(entry => entry.poseAuthorized)
  const pose = mainPose !== null ? { index: mainPose, kind: 'main' as const }
    : extraPose ? { index: extraPose.index, kind: 'extra' as const } : null
  return { sent, sources, pose }
}
