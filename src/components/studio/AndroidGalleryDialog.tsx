import { androidPoseCards, androidPoseView } from '@/lib/androidPoseViews'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUpIcon, ImageIcon, LoaderCircleIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ANDROID_GALLERY_KEY, ANDROID_GALLERY_SLOTS, androidGalleryFilterTags, searchAndroidGallery, validateAndroidGallery, type AndroidGalleryItem, type AndroidGalleryPack } from '@/lib/androidGallery'
import { galleryPage, galleryZipCatalog, galleryZipImage, makeGalleryThumbs, type GalleryZipCatalog, type GalleryZipItem } from '@/lib/androidGalleryZip'
import { androidStudio } from '@/lib/androidStudio'
import { idbDelete, idbRead } from '@/lib/idbStorage'
import type { ReferenceSlot } from '@/lib/randomRecipe'

type Catalog = GalleryZipCatalog | AndroidGalleryPack
type CatalogRow = GalleryZipItem | AndroidGalleryItem
const isZip = (pack: Catalog | null): pack is GalleryZipCatalog => pack !== null && 'revision' in pack

export function AndroidGalleryDialog({ slot, onClose, onSelect, poseFocus }: {
  slot: ReferenceSlot | null
  poseFocus?: { group: string; id: string } | null
  onClose: () => void
  onSelect: (item: AndroidGalleryItem) => void
}) {
  const [pack, setPack] = useState<Catalog | null>(null)
  const [status, setStatus] = useState<'idle' | 'reading' | 'ready' | 'failed'>('idle')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dialogAction, setDialogAction] = useState<'replace' | 'clear' | null>(null)
  const [thumbs] = useState(() => makeGalleryThumbs(androidStudio))
  const operation = useRef(false)
  const loaded = useRef(false)
  const mounted = useRef(false)
  const opened = Boolean(slot)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const localCatalog = async () => {
    const native = await androidStudio.galleryZipStatus()
    if (native.installed) return galleryZipCatalog(androidStudio, native)
    const saved = await idbRead<unknown>(ANDROID_GALLERY_KEY)
    return saved === undefined ? null : validateAndroidGallery(saved)
  }
  const readCatalog = async () => {
    if (operation.current) return
    operation.current = true
    setStatus('reading')
    setError('')
    try {
      setPack(await localCatalog())
      setStatus('ready')
    } catch {
      setStatus('failed')
      setError('无法读取本机素材包，可以重试或重新导入。')
    } finally { operation.current = false }
  }

  useEffect(() => {
    if (!opened || loaded.current) return
    loaded.current = true
    // oxlint-disable-next-line react/set-state-in-effect -- asynchronous local catalog load on first open
    void readCatalog()
  }, [opened])

  const choosePack = async () => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    setDialogAction(null)
    let installed = false
    try {
      const result = await androidStudio.pickGalleryZip()
      if ('cancelled' in result) return
      installed = true
      setPack(await galleryZipCatalog(androidStudio, result))
      setStatus('ready')
      setMessage(`已导入 ${result.count} 项素材，可离线选用。`)
    } catch (failure) {
      if (installed) { setPack(null); setStatus('failed') }
      setError(failure instanceof Error ? failure.message : '导入失败，请检查文件和设备空间。')
    } finally { operation.current = false; setBusy(false) }
  }

  const removePack = async () => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    setDialogAction(null)
    try {
      const removeZip = isZip(pack) || (status === 'failed' &&
        (await androidStudio.galleryZipStatus().catch(() => ({ installed: true }))).installed)
      if (removeZip) await androidStudio.clearGalleryZip()
      else await idbDelete(ANDROID_GALLERY_KEY)
      const fallback = await localCatalog()
      setPack(fallback)
      setStatus('ready')
      setMessage(removeZip && fallback ? '已移除 ZIP 素材包，已恢复原有的小型素材包。' : '已移除本机素材包。已选参考图和生成记录不受影响。')
    } catch { setError('未能读取或移除素材包，请重试。') }
    finally { operation.current = false; setBusy(false) }
  }

  const chooseItem = async (row: CatalogRow) => {
    if (operation.current) return
    if ('dataUrl' in row) { onSelect(row); return }
    if (!isZip(pack)) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      const dataUrl = await galleryZipImage(androidStudio, pack.revision, row.id, 'image')
      if (mounted.current) onSelect({ slot: row.slot, name: row.name, tags: row.tags, dataUrl })
    } catch { if (mounted.current) setError('无法读取这张素材的选用图片，请尝试另一张或重新导入素材包。') }
    finally { operation.current = false; setBusy(false) }
  }

  const close = () => {
    if (operation.current && busy) return
    setDialogAction(null)
    setMessage('')
    setError('')
    onClose()
  }

  const slotLabel = ANDROID_GALLERY_SLOTS.find(item => item.id === slot)?.label
  return <Dialog open={opened} onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="flex max-h-[88dvh] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-3 p-3 sm:p-5">
      <DialogHeader className="pr-8">
        <DialogTitle>{poseFocus ? '切换姿势视角' : slot === 'pose' ? '本机姿势库' : `选择${slotLabel || '角色'}素材`}</DialogTitle>
        <DialogDescription>从手机已导入的图库选择。浏览缩略图，点选后才读取参考图，整个过程离线。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => (pack || status === 'failed') ? setDialogAction('replace') : void choosePack()} disabled={busy || status === 'reading'}>
          {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />}
          {pack ? '替换素材包' : '导入素材包'}
        </Button>
        {(pack || status === 'failed') && <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => setDialogAction('clear')}>移除素材包</Button>}
        {status === 'failed' && <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => void readCatalog()}>重试读取</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {status === 'reading' && <p role="status" className="text-sm text-muted-foreground">正在读取本机素材索引…</p>}
      {busy && <p role="status" className="text-sm text-muted-foreground">正在处理本地素材，大文件导入可能需要等待。</p>}
      {dialogAction && <div className="space-y-2 rounded-lg border p-3 text-sm">
        <p>{dialogAction === 'replace' ? '选择新 ZIP 素材包。只有成功校验后才会替换本机图库。' : '移除后需重新导入才能浏览此素材包。'}已选参考图和生成记录不受影响。</p>
        <Button type="button" size="sm" variant={dialogAction === 'clear' ? 'destructive' : 'default'} className="mr-2 min-h-11"
          onClick={() => void (dialogAction === 'clear' ? removePack() : choosePack())}>{dialogAction === 'clear' ? '确认移除' : '选择新素材包'}</Button>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setDialogAction(null)}>取消</Button>
      </div>}
      {slot && <AndroidGalleryResults key={slot + ':' + (isZip(pack) ? pack.revision : 'legacy') + ':' + (poseFocus?.group ?? '')} poseFocus={poseFocus} pack={pack} slot={slot} ready={status === 'ready'}
        locked={busy || Boolean(dialogAction)} onSelect={row => void chooseItem(row)} thumbs={thumbs} />}
    </DialogContent>
  </Dialog>
}

function AndroidGalleryResults({ pack, slot, ready, locked, onSelect, thumbs, poseFocus }: {
  poseFocus?: { group: string; id: string } | null
  pack: Catalog | null
  slot: ReferenceSlot
  ready: boolean
  locked: boolean
  onSelect: (item: CatalogRow) => void
  thumbs: ReturnType<typeof makeGalleryThumbs>
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [tag, setTag] = useState('')
  const tags = useMemo(() => androidGalleryFilterTags(pack, slot), [pack, slot])
  const activeTag = tags.includes(tag) ? tag : ''
  const matches = useMemo(() => searchAndroidGallery<CatalogRow>(pack, slot, query, activeTag), [pack, slot, query, activeTag])
  const cards = useMemo(() => slot === 'pose' ? androidPoseCards<CatalogRow>(pack?.items ?? [], matches, poseFocus?.group) : [], [slot, pack, matches, poseFocus?.group])
  const { visible, index, pages } = useMemo(() => galleryPage(matches, page), [matches, page])
  const posePage = useMemo(() => galleryPage(cards, page), [cards, page])
  const shownPage = slot === 'pose' ? posePage : { index, pages }
  const total = slot === 'pose' ? cards.length : matches.length
  const scroller = useRef<HTMLDivElement>(null)
  if (!ready) return null
  if (!pack) return <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
    暂无本机图库。先在电脑从现有图库导出手机 ZIP 素材包，再把 ZIP 文件传到手机，在这里导入。
  </p>
  const go = (next: number) => { setPage(next); scroller.current?.scrollTo(0, 0) }
  return <>
    {!poseFocus && <div className="relative">
      <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="min-h-11 pl-9" type="search" maxLength={120} placeholder="按名称或标签查找" aria-label="搜索本地素材"
        value={query} onChange={event => { setQuery(event.target.value); go(0) }} />
    </div>}
    {!poseFocus && tags.length > 0 && <div className="flex min-h-11 shrink-0 items-center gap-1.5 overflow-x-auto" aria-label="素材标签">
      {['', ...tags].map(value => <Button key={value} type="button" size="sm" className="min-h-10 shrink-0"
        variant={activeTag === value ? 'default' : 'outline'} aria-pressed={activeTag === value}
        onClick={() => { setTag(value); go(0) }}>{value || '全部'}</Button>)}
    </div>}
    <div className="min-h-0 overflow-y-auto" ref={scroller}>
      {!total && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{poseFocus ? '当前素材包里没有这组姿势。配方已保存的视角仍可继续使用。' : (query.trim() || activeTag) ? '没有匹配的素材，试试其他关键词或标签。' : '当前素材包不含此类素材。'}</p>}
      {slot === 'pose' ? <PosePageTiles key={JSON.stringify([posePage.index, activeTag, query])}
        cards={posePage.visible} revision={isZip(pack) ? pack.revision : undefined} selectedId={poseFocus?.id}
        preferredAngle={tags.includes(activeTag) ? activeTag : ''} locked={locked} onSelect={onSelect} thumbs={thumbs} />
        : <PageTiles key={JSON.stringify([index, activeTag, query])} rows={visible} revision={isZip(pack) ? pack.revision : undefined}
          locked={locked} onSelect={onSelect} thumbs={thumbs} />}
    </div>
    {shownPage.pages > 1 && <div className="flex shrink-0 items-center justify-between gap-2 text-sm" aria-label="素材分页">
      <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={locked || shownPage.index === 0} onClick={() => go(shownPage.index - 1)}>上一页</Button>
      <span>{shownPage.index + 1} / {shownPage.pages} 页 · {total} 项</span>
      <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={locked || shownPage.index + 1 >= shownPage.pages} onClick={() => go(shownPage.index + 1)}>下一页</Button>
    </div>}
  </>
}

function PageTiles({ rows, revision, locked, onSelect, thumbs, renderControls }: {
  renderControls?: (row: CatalogRow, index: number) => React.ReactNode
  rows: CatalogRow[]
  revision?: string
  locked: boolean
  onSelect: (item: CatalogRow) => void
  thumbs: ReturnType<typeof makeGalleryThumbs>
}) {
  const [previews, setPreviews] = useState<Record<number, string | undefined>>({})
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!revision) return
    const zipRows = rows.filter((item): item is GalleryZipItem => 'id' in item)
    const receive = (id: number, image?: string) => setPreviews(current => ({ ...current, [id]: image }))
    if (!grid.current || typeof IntersectionObserver === 'undefined') return thumbs.page(revision, zipRows, receive)

    const byId = new Map(zipRows.map(row => [String(row.id), row]))
    const cancel = new Map<Element, () => void>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          cancel.get(entry.target)?.()
          cancel.delete(entry.target)
          continue
        }
        const row = byId.get(entry.target.getAttribute('data-gallery-thumb') ?? '')
        if (!row || cancel.has(entry.target)) continue
        let finished = false
        const stop = thumbs.page(revision, [row], (id, image) => {
          finished = true
          receive(id, image)
          observer.unobserve(entry.target)
          cancel.delete(entry.target)
        })
        if (!finished) cancel.set(entry.target, stop)
      }
    }, { root: grid.current.parentElement, rootMargin: '160px 0px' })
    grid.current.querySelectorAll('[data-gallery-thumb]').forEach(tile => observer.observe(tile))
    return () => {
      observer.disconnect()
      for (const stop of cancel.values()) stop()
    }
  }, [revision, rows, thumbs])
  return <div ref={grid} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {rows.map((item, index) => {
      const preview = 'dataUrl' in item ? item.dataUrl : previews[item.id]
      const view = renderControls ? androidPoseView(item) : null
      return <div key={view?.group ?? ('id' in item ? item.id : index)} className="min-w-0 overflow-hidden rounded-xl border bg-background">
        <button key={'id' in item ? item.id : index} data-gallery-thumb={'id' in item ? item.id : undefined} type="button" disabled={locked}
        className="block w-full min-w-0 overflow-hidden rounded-xl text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
        onClick={() => onSelect(item)}>
        {preview ? <img src={preview} alt="" loading="lazy" decoding="async" className="aspect-4/3 w-full bg-muted object-contain" /> :
          <span className="grid aspect-4/3 w-full place-content-center bg-muted text-muted-foreground" aria-hidden="true"><ImageIcon className="size-5" /></span>}
        <span className="block truncate px-2 pt-2 text-sm font-medium" title={view?.title ?? item.name}>{view?.title ?? item.name}</span>
        <span className="block min-h-6 truncate px-2 text-xs text-muted-foreground" title={item.tags.join(' · ')}>{view ? `${view.number} · ${view.label} · 加入配方` : item.tags.join(' · ')}</span>
        </button>
        {renderControls?.(item, index)}
      </div>
    })}
  </div>
}


function PosePageTiles({ cards, revision, selectedId, preferredAngle, locked, onSelect, thumbs }: {
  cards: CatalogRow[][]; revision?: string; selectedId?: string; preferredAngle: string; locked: boolean
  onSelect: (row: CatalogRow) => void; thumbs: ReturnType<typeof makeGalleryThumbs>
}) {
  const [active, setActive] = useState<Record<number, number>>({})
  const rows = useMemo(() => cards.map((views, i) => views[active[i]] ??
    views.find(view => selectedId && androidPoseView(view)?.id === selectedId) ??
    views.find(view => preferredAngle && androidPoseView(view)?.label === preferredAngle) ?? views[0]), [cards, active, selectedId, preferredAngle])
  return <PageTiles rows={rows} revision={revision} locked={locked} onSelect={onSelect} thumbs={thumbs}
    renderControls={(item, i) => cards[i].length > 1 && <div className="flex flex-wrap gap-1 px-2 pb-2" aria-label="姿势视角">
      {cards[i].map((view, j) => {
        const label = androidPoseView(view)?.label
        return <Button key={j} type="button" variant={item === view ? 'default' : 'outline'}
          size="sm" className="min-h-9 px-2 text-xs" disabled={locked}
          aria-pressed={item === view} onClick={() => setActive(previous => ({ ...previous, [i]: j }))}>{label}</Button>
      })}
    </div>} />
}
