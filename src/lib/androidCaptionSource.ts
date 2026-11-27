import type { GenerationHistoryItem } from '@/types/gallery'

export const isCaptionImage = (image?: string | null): image is string => Boolean(image?.startsWith('data:image/png;base64,') || image?.startsWith('data:image/jpeg;base64,'))
export function captionIndex(history: GenerationHistoryItem[]) {
  return history.filter(item => isCaptionImage(item.imageUrl)).map(item => {
    const recipe = item.snapshot?.recipe
    return {
      id: item.id, version: String(item.createdAt), label: item.recipeSummary.slice(0, 160),
      prompt: (item.prompt || '').slice(0, 32000),
      costume: recipe?.costume?.服装名称 || '', portrait: recipe?.portrait?.发型名称 || '',
      pose: recipe?.pose?.姿势名称 || '', style: item.snapshot?.settings.stylePreset || '',
    }
  })
}
