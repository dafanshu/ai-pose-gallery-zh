import { useRef, useState } from 'react'
import { DownloadIcon, ImagePlusIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ZoomViewport } from '@/components/common/ZoomViewport'
import { Field } from '@/components/common/FormSection'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { androidStudio } from '@/lib/androidStudio'
import { poseImagePath } from '@/lib/recipeImages'
import { toast } from '@/lib/notifications'
import type { GptParams, RecipeState } from '@/types/gallery'
import type { ReferenceSlot } from '@/lib/randomRecipe'

// Never let imported desktop URLs initiate network requests in the native UI.
// oxlint-disable-next-line react/only-export-components -- shared native UI boundary
export const isAndroidLocalImage = (url: string | null | undefined): url is string =>
  Boolean(url && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(url))

export function AndroidSaveImage({ dataUrl, name = 'character.png', compact = false }: { dataUrl: string; name?: string; compact?: boolean }) {
  const canSave = isAndroidLocalImage(dataUrl) && dataUrl.startsWith('data:image/png;base64,')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const save = async () => {
    if (pending.current || !canSave) return
    pending.current = true
    setSaving(true)
    try {
      await androidStudio.saveImage({ dataUrl, name })
      toast.success('图片已保存到相册')
    } catch { toast.error('保存失败，请检查相册权限后重试') }
    finally { pending.current = false; setSaving(false) }
  }
  return <Button type="button" variant="outline" size="sm" className={compact ? 'min-h-11 w-full px-1 text-xs' : 'min-h-11'} disabled={saving || !canSave} title={!canSave ? '仅支持保存本机 PNG 图片' : undefined} onClick={() => void save()}>
    {saving ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <DownloadIcon className="size-3.5" />}
    {saving ? '保存中' : !canSave ? '仅存 PNG' : compact ? '存相册' : '保存到相册'}
  </Button>
}

export function AndroidImageViewer({ imageUrl, open, onOpenChange }: { imageUrl: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} showCloseButton={false} className="flex h-[90dvh] w-[96vw] max-w-none flex-col gap-3 p-3 sm:max-w-6xl">
      <div className="flex flex-wrap items-center gap-2">
        <DialogTitle className="mr-auto">图片预览</DialogTitle>
        <AndroidSaveImage dataUrl={imageUrl} />
        <DialogClose asChild><Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="关闭图片预览"><XIcon className="size-4" /></Button></DialogClose>
      </div>
      <ZoomViewport imageUrl={isAndroidLocalImage(imageUrl) ? imageUrl : ''} className="min-h-0 flex-1" />
    </DialogContent>
  </Dialog>
}

export function AndroidReferenceSlots({ recipe, busy, count, limit, onPick, onClear, onPreview }: {
  recipe: RecipeState; busy: string | null; count: number; limit: number
  onPick: (slot: ReferenceSlot) => void; onClear: (slot: ReferenceSlot) => void; onPreview: (url: string) => void
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
        <p className="truncate text-xs text-muted-foreground">{item ? name : '可选，从本机图库选取'}</p>
        {item && !isAndroidLocalImage(url) && <p className="text-xs text-amber-700 dark:text-amber-400">图片不在本机，请从图库重新选择</p>}
        <Button variant="outline" size="sm" className="mt-1 min-h-11 max-w-full px-2 text-xs" disabled={busy !== null || (!item && count >= limit)} onClick={() => onPick(slot)}>
          {busy === slot && <LoaderCircleIcon className="size-4 animate-spin" />}{item ? '更换图库素材' : '从图库选择'}
        </Button>
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
