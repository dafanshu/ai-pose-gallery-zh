import type { PoseItem } from '@/types/gallery'
import type { AndroidGalleryItem } from './androidGallery'
import { uploadedReferences } from './recipeImages'

export const ANDROID_POSE_ANGLES = { front: '正面', high: '俯视', low: '仰视', side: '侧面', diag: '斜侧' } as const
type Angle = keyof typeof ANDROID_POSE_ANGLES
type Row = Pick<AndroidGalleryItem, 'slot' | 'name' | 'tags'>
const angleOrder = Object.keys(ANDROID_POSE_ANGLES)
const sourceIdPattern = /^([A-Za-z0-9_]+_(P[0-9]+))_(front|high|low|side|diag)$/
const localPrefix = 'android-gallery-pose:'

export function androidPoseView(row: Row) {
  if (row.slot !== 'pose') return null
  // ZIP v1 already carries the source ID, label and pose number in its tags.
  // Use the complete source ID to keep P001 from different series separate.
  for (const id of row.tags) {
    const match = sourceIdPattern.exec(id)
    if (!match) continue
    const [, group, number, angle] = match
    const label = ANDROID_POSE_ANGLES[angle as Angle]
    const suffix = ' · ' + label
    if (row.tags.includes(label) && row.tags.includes(number) && row.name.endsWith(suffix) && row.name.length > suffix.length)
      return { id, group, number, angle: angle as Angle, label, title: row.name.slice(0, -suffix.length) }
  }
  return null
}

export function androidSelectedPoseGroup(id?: string) {
  if (!id?.startsWith(localPrefix)) return null
  const match = sourceIdPattern.exec(id.slice(localPrefix.length))
  return match ? { group: match[1], id: match[0] } : null
}

export function androidPoseReference(row: AndroidGalleryItem) {
  const view = androidPoseView(row)
  const base = uploadedReferences(view?.title ?? row.name, row.dataUrl, 0, 0, 0).pose
  return { ...base, 分类: '本机图库', 体系: '本机图库',
    ...(view && { id: localPrefix + view.id, 姿势编号: view.number, 角度: view.label }),
  }
}

export function androidPosePromptLabel(pose: PoseItem): string {
  // Android gallery references are local images (source: upload), but unlike an
  // arbitrary album filename their action/title and viewpoint are gallery metadata.
  const known = pose.source !== 'upload' || androidSelectedPoseGroup(pose.id) !== null
  return known ? [pose.姿势名称, pose.角度].filter(Boolean).join('，') : ''
}

export function androidPoseCards<T extends Row>(all: readonly T[], matches: readonly T[], group?: string) {
  const groups = new Map<string, T[]>()
  for (const row of all) {
    const view = androidPoseView(row)
    if (!view) continue
    const entries = groups.get(view.group) ?? []
    if (!entries.some(entry => androidPoseView(entry)?.angle === view.angle)) entries.push(row)
    groups.set(view.group, entries)
  }
  if (group) {
    const rows = groups.get(group)
    return rows?.length ? [sortViews(rows)] : []
  }
  const seen = new Set<string>()
  return matches.flatMap(row => {
    const view = androidPoseView(row)
    if (!view) return [[row]]
    if (seen.has(view.group)) return []
    seen.add(view.group)
    return [sortViews(groups.get(view.group) ?? [row])]
  })
}

function sortViews<T extends Row>(rows: readonly T[]) {
  return [...rows].sort((a, b) => angleOrder.indexOf(androidPoseView(a)!.angle) - angleOrder.indexOf(androidPoseView(b)!.angle))
}
