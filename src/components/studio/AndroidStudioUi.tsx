import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { CheckIcon, DownloadIcon, ImagePlusIcon, LoaderCircleIcon, StarIcon, XIcon } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ZoomViewport } from '@/components/common/ZoomViewport'
import { Field } from '@/components/common/FormSection'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { androidStudio } from '@/lib/androidStudio'
import { androidAlbumMarks } from '@/lib/androidAlbumMarks'
import { poseImagePath } from '@/lib/recipeImages'
import { toast } from '@/lib/notifications'
import type { GptParams, RecipeState } from '@/types/gallery'
import type { ReferenceSlot } from '@/lib/randomRecipe'

import { isAndroidLocalImage } from '@/lib/androidReferenceFavorites'
// oxlint-disable-next-line react/only-export-components -- shared native UI boundary
export { isAndroidLocalImage }

export function AndroidSaveImage({ dataUrl, name = 'character.png', compact = false, albumKey }: { dataUrl: string; name?: string; compact?: boolean; albumKey?: string }) {
  const saved = useSyncExternalStore(androidAlbumMarks.subscribe, () => androidAlbumMarks.has(albumKey), () => false)
  const canSave = useMemo(() => dataUrl?.startsWith('data:image/png;base64,') && isAndroidLocalImage(dataUrl), [dataUrl])
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const save = async () => {
    if (pending.current || !canSave) return
    pending.current = true
    setSaving(true)
    try {
      await androidStudio.saveImage({ dataUrl, name })
      androidAlbumMarks.mark(albumKey)
      toast.success('图片已保存到相册')
    } catch { toast.error('保存失败，请检查相册权限后重试') }
    finally { pending.current = false; setSaving(false) }
  }
  return <Button type="button" variant={saved ? 'secondary' : 'outline'} size="sm"
    data-album-saved={saved || undefined}
    className={`${compact ? 'min-h-11 w-full px-1 text-xs' : 'min-h-11'}${saved ? ' text-muted-foreground' : ''}`}
    disabled={saving || !canSave}
    title={!canSave ? '仅支持保存本机 PNG 图片' : saved ? '曾保存到相册；可以再次保存' : undefined}
    onClick={() => void save()}>
    {saving ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : saved ? <CheckIcon className="size-3.5" /> : <DownloadIcon className="size-3.5" />}
    {saving ? '保存中' : !canSave ? '仅存 PNG' : saved ? '已保存 · 再存' : compact ? '存相册' : '保存到相册'}
  </Button>
}

export function AndroidImageViewer({ imageUrl, open, onOpenChange, albumKey }: { imageUrl: string; open: boolean; onOpenChange: (open: boolean) => void; albumKey?: string }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} showCloseButton={false} className="flex h-[90dvh] w-[96vw] max-w-none flex-col gap-3 p-3 sm:max-w-6xl">
      <div className="flex flex-wrap items-center gap-2">
        <DialogTitle className="mr-auto">图片预览</DialogTitle>
        <AndroidSaveImage dataUrl={imageUrl} albumKey={albumKey} />
        <DialogClose asChild><Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="关闭图片预览"><XIcon className="size-4" /></Button></DialogClose>
      </div>
      <ZoomViewport imageUrl={isAndroidLocalImage(imageUrl) ? imageUrl : ''} className="min-h-0 flex-1" />
    </DialogContent>
  </Dialog>
}

export function AndroidReferenceSlots({ recipe, busy, count, limit, onPick, onFavorites, onClear, onPreview, onPoseView }: {
  recipe: RecipeState; busy: string | null; count: number; limit: number
  onPoseView?: () => void
  onPick: (slot: ReferenceSlot) => void; onFavorites: (slot: ReferenceSlot) => void; onClear: (slot: ReferenceSlot) => void; onPreview: (url: string) => void
}) {
  const slots = [
    { slot: 'portrait', label: '人像', item: recipe.portrait, url: recipe.portrait?.原图 || recipe.portrait?.缩略图, name: recipe.portrait?.标题 },
    { slot: 'costume', label: '服饰', item: recipe.costume, url: recipe.costume?.预览图 || recipe.costume?.原图 || recipe.costume?.缩略图, name: recipe.costume?.服装名称 },
    { slot: 'pose', label: '姿势', item: recipe.pose, url: recipe.pose ? poseImagePath(recipe.pose) : '', name: recipe.pose?.姿势名称 },
  ] as const
  return <div className="col-span-full grid min-w-0 grid-cols-1 gap-2 @min-[42rem]/section:grid-cols-3">
    {slots.map(({ slot, label, item, url, name }) => <div key={slot} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl bg-background p-3">
      {isAndroidLocalImage(url) ? <button type="button" aria-label={`放大${label}参考图`} onClick={() => onPreview(url)} className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><img src={url} alt={name || label} className="h-20 w-16 rounded-lg object-cover" /></button>
        : <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-muted"><ImagePlusIcon className="size-5 text-muted-foreground" /></div>}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium">{label}</div>
        <p className="truncate text-xs text-muted-foreground">{item ? name : '可选，从本机图库选取'}{slot === 'pose' && recipe.pose?.角度 ? ' · ' + recipe.pose.角度 : ''}</p>
        {item && !isAndroidLocalImage(url) && <p className="text-xs text-amber-700 dark:text-amber-400">图片不在本机，请从图库重新选择</p>}
        <Button variant="outline" size="sm" className="mt-1 min-h-11 max-w-full px-2 text-xs" disabled={busy !== null || (!item && count >= limit)} onClick={() => onPick(slot)}>
          {busy === slot && <LoaderCircleIcon className="size-4 animate-spin" />}{item ? '更换图库素材' : '从图库选择'}
        </Button>
        <Button type="button" variant="outline" size="sm" aria-label={`${label}收藏`} className="ml-1 mt-1 min-h-11 px-2 text-xs"
          disabled={busy !== null} onClick={() => onFavorites(slot)}><StarIcon className="size-3.5" />收藏</Button>
        {slot === 'pose' && onPoseView && <Button variant="outline" size="sm" className="ml-1 mt-1 min-h-11 px-2 text-xs"
          disabled={busy !== null} onClick={onPoseView}>切换视角</Button>}
      </div>
      {item && <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={`移除${label}参考图`} onClick={() => onClear(slot)}><XIcon className="size-4" /></Button>}
    </div>)}
  </div>
}

export function AndroidImageOptions({ params, onChange }: { params: GptParams; onChange: (value: Partial<GptParams>) => void }) {
  return <>
    <Field label="输出尺寸">
      <Select value={params.size} onValueChange={value => onChange({ size: value as GptParams['size'] })}>
        <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="1024x1536">竖图 · 1024 × 1536</SelectItem><SelectItem value="1024x1024">方图 · 1024 × 1024</SelectItem><SelectItem value="1536x1024">横图 · 1536 × 1024</SelectItem><SelectItem value="auto">自动</SelectItem></SelectContent>
      </Select>
    </Field>
    <Field label="渲染质量" hint="更高质量通常需要更多时间与费用。">
      <Select value={params.quality} onValueChange={value => onChange({ quality: value as GptParams['quality'] })}>
        <SelectTrigger className="min-h-11 w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="auto">自动</SelectItem><SelectItem value="low">低</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="high">高</SelectItem></SelectContent>
      </Select>
    </Field>
  </>
}
