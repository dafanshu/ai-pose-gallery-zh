import type { ExtraReferenceImage, RecipeState } from '@/types/gallery'
import type { ReferenceSlot } from './randomRecipe'
import { LOCAL_BODY_FIELDS, resolveLocalBodySources } from './bodyProfile'
import { poseImagePath } from './recipeImages'

export const REFERENCE_FAVORITE_LABELS = { portrait: '人像', costume: '服饰', pose: '姿势', extra: '附加图片' } as const

export type FavoriteSlot = ReferenceSlot | 'extra'

export type ReferenceFavorite = {
  [Slot in ReferenceSlot]: { slot: Slot; item: NonNullable<RecipeState[Slot]> }
}[ReferenceSlot] | { slot: 'extra'; item: ExtraReferenceImage }

export const referenceFavoritesKey = (slot: FavoriteSlot) => `android-reference-favorites:${slot}`

export const isAndroidLocalImage = (url: string | null | undefined): url is string =>
  Boolean(url && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(url))

export function referenceFavorite(slot: ReferenceSlot, recipe: RecipeState): ReferenceFavorite | null {
  if (slot === 'portrait' && recipe.portrait) return { slot, item: recipe.portrait }
  if (slot === 'costume' && recipe.costume) return { slot, item: recipe.costume }
  if (slot === 'pose' && recipe.pose) return { slot, item: recipe.pose }
  return null
}

export function favoriteImage(entry: ReferenceFavorite): string {
  if (entry.slot === 'extra') return entry.item.cropUrl ?? entry.item.url
  return entry.slot === 'pose' ? poseImagePath(entry.item) : entry.item.原图 || entry.item.缩略图
}

export function favoriteLabel(entry: ReferenceFavorite): string {
  switch (entry.slot) {
    case 'extra': return entry.item.name.trim() || '附加参考图'
    case 'portrait': return entry.item.标题 || entry.item.发型名称
    case 'costume': return entry.item.服装名称
    case 'pose': return [entry.item.姿势名称, entry.item.角度].filter(Boolean).join(' · ')
  }
}

export function sameFavorite(a: ReferenceFavorite, b: ReferenceFavorite): boolean {
  if (a.slot !== b.slot) return false
  if (a.slot === 'extra' && b.slot === 'extra') {
    const x = a.item, y = b.item
    return x.url === y.url && x.cropUrl === y.cropUrl && x.name === y.name &&
      (x.useFeatures ?? '') === (y.useFeatures ?? '') && (x.excludeFeatures ?? '') === (y.excludeFeatures ?? '') &&
      x.role === y.role && LOCAL_BODY_FIELDS.every(key => Boolean(x.bodyOverrides?.includes(key)) === Boolean(y.bodyOverrides?.includes(key)))
  }
  if (a.slot === 'pose' && b.slot === 'pose' && (a.item.角度 !== b.item.角度 || Boolean(a.item.useDepth) !== Boolean(b.item.useDepth))) return false
  return favoriteImage(a) === favoriteImage(b)
}

export function isLocalReferenceFavorite(entry: ReferenceFavorite): boolean {
  return isAndroidLocalImage(favoriteImage(entry)) && (entry.slot !== 'extra' || isAndroidLocalImage(entry.item.url))
}

export function restoreExtraFavorite(item: ExtraReferenceImage, selected: readonly ExtraReferenceImage[]) {
  const sources = resolveLocalBodySources(selected, 1)
  const wanted = LOCAL_BODY_FIELDS.filter(field => item.bodyOverrides?.includes(field))
  const bodyOverrides = wanted.filter(field => sources[field] === undefined)
  const { id: _oldId, ...rest } = item
  return { image: { ...rest, bodyOverrides }, keptExistingBodySource: bodyOverrides.length !== wanted.length }
}

export function addReferenceFavorite(existing: ReferenceFavorite[], entry: ReferenceFavorite): ReferenceFavorite[] {
  if (!isLocalReferenceFavorite(entry) || existing.some(value => sameFavorite(value, entry))) return existing
  return [entry, ...existing]
}
