import type { RecipeState } from '@/types/gallery'
import { resolveLocalBodySources } from './bodyProfile'
import { EXTRA_REFERENCE_RULE_MAX } from './recipeImages'

// Match only stand-alone known labels, not arbitrary prose. In particular an old
// free-text body label must never become authorization to transfer anatomy.
const BODY_LABEL = /^(?:(?:胸部|胸部形态|胸型|胸围|臀部|臀型|腿长|腿长比例|腿身比例|腰臀比例|胯宽|腿部长度|大腿小腿粗细和长度比例)(?:[：:]\s*)?|(?:粗腿|细腿|大粗腿|宽胯|窄胯)(?:\s+(?:粗腿|细腿|大粗腿|宽胯|窄胯))*|(?:腿部粗细|臀胯宽度|胯宽)(?:[：:]\s*)?(?:偏粗|偏细|偏宽|偏窄|适中)?)$/
const OUTFIT_LABEL = /^(?:服装|服饰|衣服|穿搭|整套服装|整套服饰|上衣|外套|裤子|下装|裙子|连衣裙|帽子|鞋|鞋子|鞋袜|配饰|图中服装)$/
const POSE_LABEL = /^(?:姿势|站姿|坐姿|跪姿|蹲姿|躺姿|动作|肢体动作|构图|镜头|机位|视角|景别|正面|侧面|斜侧|俯视|仰视)$/
const labels = (value?: string) => (value ?? '').trim().slice(0, EXTRA_REFERENCE_RULE_MAX)
  .split(/[、，,；;\n]/).map(part => part.trim()).filter(Boolean)
const normalizeLabel = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()

export function androidReferencePlan(recipe: RecipeState) {
  const extras = recipe.extraImages ?? []
  const first = 1 + Number(Boolean(recipe.portrait)) + Number(Boolean(recipe.costume)) + Number(Boolean(recipe.pose))
  const selectedBody = recipe.bodyProfile?.enabled ? resolveLocalBodySources(extras, 1) : {}
  const bodyOwners = new Set(Object.values(selectedBody).map(value => value - 1))
  const sent = extras.flatMap((item, offset) => {
    const avoid = labels(item.excludeFeatures).filter(part => !BODY_LABEL.test(normalizeLabel(part)))
    const excluded = new Set(avoid.map(normalizeLabel))
    const use = labels(item.useFeatures).filter(part => {
      const key = normalizeLabel(part)
      return !BODY_LABEL.test(key) && !excluded.has(key) && !(recipe.costume && OUTFIT_LABEL.test(key)) && !(recipe.pose && POSE_LABEL.test(key))
    })
    // With an outfit or pose slot, an exclusion by itself doesn't authorize any
    // positive feature. Keep such extras in the recipe, but omit their pixels.
    const generic = !recipe.costume && !recipe.pose && !item.useFeatures?.trim() && !bodyOwners.has(offset)
    if (!use.length && !bodyOwners.has(offset) && !generic) return []
    return [{ item, offset, use, avoid, bodyAuthorized: bodyOwners.has(offset) }]
  }).map((entry, idx) => ({ ...entry, index: first + idx }))
  const sources = recipe.bodyProfile?.enabled ? resolveLocalBodySources(sent.map(entry => entry.item), first) : {}
  return { sent, sources }
}
