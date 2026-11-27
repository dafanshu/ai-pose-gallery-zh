import { useEffect, useRef, useState } from 'react'
import { StarIcon } from 'lucide-react'
import { isNsfwCostume, isNsfwPose } from '@/api/gallery'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { idbRead, idbWrite } from '@/lib/idbStorage'
import {
  addReferenceFavorite, favoriteImage, favoriteLabel, isLocalReferenceFavorite, REFERENCE_FAVORITE_LABELS,
  referenceFavoritesKey, sameFavorite, type FavoriteSlot, type ReferenceFavorite,
} from '@/lib/androidReferenceFavorites'

function allowed(entry: ReferenceFavorite, safeMode: boolean): boolean {
  return !safeMode || !(entry.slot === 'costume' && isNsfwCostume(entry.item) || entry.slot === 'pose' && isNsfwPose(entry.item))
}

export function AndroidReferenceFavoritesDialog({ slot, current, canUse, safeMode, onClose, onSelect, onGallery, onPickExtra }: {
  slot: FavoriteSlot
  current: ReferenceFavorite | null
  canUse: boolean
  safeMode: boolean
  onClose: () => void
  onSelect: (entry: ReferenceFavorite) => void
  onGallery?: () => void
  onPickExtra?: () => void
}) {
  const [entries, setEntries] = useState<ReferenceFavorite[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [readAttempt, setReadAttempt] = useState(0)
  const pending = useRef(false)
  const key = referenceFavoritesKey(slot)
  const label = REFERENCE_FAVORITE_LABELS[slot]
  useEffect(() => {
    let active = true
    void idbRead<ReferenceFavorite[]>(key).then(values => {
      if (active) setEntries((values ?? []).filter(value => value.slot === slot && isLocalReferenceFavorite(value)))
    }).catch(() => { if (active) setError('无法读取本机收藏，请重试。') })
    return () => { active = false }
  }, [key, slot, readAttempt])

  const save = async (next: ReferenceFavorite[]) => {
    if (pending.current || !entries || next === entries) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await idbWrite(key, next)
      setEntries(next)
    } catch { setError('收藏未保存，请检查本机存储空间后重试。') }
    finally { pending.current = false; setBusy(false) }
  }

  const saved = current && entries?.some(entry => sameFavorite(entry, current))
  const savable = current && allowed(current, safeMode) && isLocalReferenceFavorite(current)
  const visible = entries?.filter(entry => allowed(entry, safeMode))
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose() }}>
    <DialogContent className="flex max-h-[85dvh] w-[calc(100%-1.5rem)] flex-col gap-3 p-4">
      <DialogHeader className="pr-8">
        <DialogTitle>{label}收藏</DialogTitle>
        <DialogDescription>{slot === 'extra' ? '点选后会添加到当前配方，保留裁剪和参考规则。' : `点选一项即可填入${label}槽。`}收藏只保存在本机，不会上传。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        {(slot !== 'extra' || current) && <Button type="button" size="sm" className="min-h-11" disabled={!savable || !entries || busy || Boolean(saved)}
          onClick={() => { if (current && entries) void save(addReferenceFavorite(entries, current)) }}>
          <StarIcon className="size-4" />{saved ? `当前${label}已收藏` : `收藏当前${label}`}
        </Button>}
        {onGallery && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || !canUse} onClick={onGallery}>打开{label}图库</Button>}
        {onPickExtra && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || !canUse} onClick={onPickExtra}>从相册添加</Button>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!entries && (error
        ? <Button type="button" size="sm" variant="outline" onClick={() => { setError(''); setReadAttempt(value => value + 1) }}>重试读取</Button>
        : <p role="status" className="text-sm text-muted-foreground">正在读取本机收藏…</p>)}
      {visible?.length === 0 && <p className="text-sm text-muted-foreground">还没有可用的{label}收藏。{slot === 'extra' ? '添加附图后，点图片旁的「收藏」即可保存。' : '可先从图库选素材，再回来收藏当前项。'}</p>}
      {!canUse && <p className="text-xs text-muted-foreground">参考图已达上限，请先移除一张再选用收藏。</p>}
      {visible && visible.length > 0 && <ul className="min-h-0 space-y-2 overflow-y-auto">
        {visible.map(entry => <li key={entries!.indexOf(entry)} className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
          <button type="button" aria-label={`选用 ${favoriteLabel(entry)}`} disabled={busy || !canUse}
            className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded text-left text-sm focus-visible:outline-2 disabled:opacity-50"
            onClick={() => onSelect(entry)}>
            <img src={favoriteImage(entry)} alt="" loading="lazy" decoding="async" className="h-12 w-10 shrink-0 rounded object-cover" />
            <span className="min-w-0">
              <span className="line-clamp-2">{favoriteLabel(entry)}</span>
              {entry.slot === 'extra' && (entry.item.cropUrl || entry.item.useFeatures || entry.item.excludeFeatures || entry.item.bodyOverrides?.length) ? <span className="block truncate text-xs text-muted-foreground">
                {[
                  entry.item.cropUrl && '已裁剪',
                  entry.item.useFeatures && `仅采用：${entry.item.useFeatures}`,
                  entry.item.excludeFeatures && `排除：${entry.item.excludeFeatures}`,
                  entry.item.bodyOverrides?.length && '局部形体',
                ].filter(Boolean).join(' · ')}
              </span> : null}
            </span>
          </button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0 px-2 text-xs"
            aria-label={`取消收藏 ${favoriteLabel(entry)}`} disabled={busy}
            onClick={() => { if (entries) void save(entries.filter(item => item !== entry)) }}>取消收藏</Button>
        </li>)}
      </ul>}
    </DialogContent>
  </Dialog>
}
