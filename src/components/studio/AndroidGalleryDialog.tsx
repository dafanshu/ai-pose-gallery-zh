import { useEffect, useRef, useState } from 'react'
import { FileUpIcon, LoaderCircleIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ANDROID_GALLERY_KEY, ANDROID_GALLERY_SLOTS, androidGalleryFilterTags, readAndroidGalleryPack, searchAndroidGallery, validateAndroidGallery, type AndroidGalleryItem, type AndroidGalleryPack } from '@/lib/androidGallery'
import { androidStudio } from '@/lib/androidStudio'
import { idbDelete, idbRead, idbWrite } from '@/lib/idbStorage'
import type { ReferenceSlot } from '@/lib/randomRecipe'

const PAGE = 24

export function AndroidGalleryDialog({ slot, onClose, onSelect }: {
  slot: ReferenceSlot | null
  onClose: () => void
  onSelect: (item: AndroidGalleryItem) => void
}) {
  const [pack, setPack] = useState<AndroidGalleryPack | null>(null)
  const [status, setStatus] = useState<'idle' | 'reading' | 'ready' | 'failed'>('idle')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [replacement, setReplacement] = useState<AndroidGalleryPack | null>(null)
  const [clearing, setClearing] = useState(false)
  const operation = useRef(false)
  const loaded = useRef(false)
  const opened = Boolean(slot)

  const readCatalog = async () => {
    if (operation.current) return
    operation.current = true
    setStatus('reading')
    setError('')
    try {
      const saved = await idbRead<unknown>(ANDROID_GALLERY_KEY)
      setPack(saved === undefined ? null : validateAndroidGallery(saved))
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

  const persistPack = async (next: AndroidGalleryPack) => {
    await idbWrite(ANDROID_GALLERY_KEY, next)
    setPack(next)
    setStatus('ready')
    setMessage(`已导入 ${next.items.length} 项素材，可离线选用。`)
  }

  const choosePack = async () => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    setReplacement(null)
    setClearing(false)
    try {
      const next = await readAndroidGalleryPack(androidStudio)
      if (!next) return
      if (pack) setReplacement(next)
      else await persistPack(next)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '导入失败，请检查文件和设备空间。')
    } finally { operation.current = false; setBusy(false) }
  }

  const replacePack = async () => {
    if (!replacement || operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      await persistPack(replacement)
      setReplacement(null)
    } catch { setError('未能保存新素材包，原素材包未删除。请检查设备空间后重试。') }
    finally { operation.current = false; setBusy(false) }
  }

  const removePack = async () => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    setClearing(false)
    try {
      await idbDelete(ANDROID_GALLERY_KEY)
      setPack(null)
      setStatus('ready')
      setMessage('已移除本机素材包。已选参考图和生成记录不受影响。')
    } catch { setError('未能移除素材包，请重试。') }
    finally { operation.current = false; setBusy(false) }
  }

  const close = () => {
    if (busy) return
    setReplacement(null)
    setClearing(false)
    setMessage('')
    setError('')
    onClose()
  }

  const slotLabel = ANDROID_GALLERY_SLOTS.find(item => item.id === slot)?.label
  return <Dialog open={opened} onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="flex max-h-[88dvh] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-3 p-3 sm:p-5">
      <DialogHeader className="pr-8">
        <DialogTitle>选择{slotLabel || '角色'}素材</DialogTitle>
        <DialogDescription>从手机已导入的图库选择。素材包本地保存，浏览不会联网。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void choosePack()} disabled={busy || status === 'reading'}>
          {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />}
          {pack ? '替换素材包' : '导入素材包'}
        </Button>
        {pack && <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => { setClearing(true); setReplacement(null) }}>移除素材包</Button>}
        {status === 'failed' && <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => void readCatalog()}>重试读取</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {status === 'reading' && <p role="status" className="text-sm text-muted-foreground">正在读取本机素材包…</p>}
      {replacement && <div className="space-y-2 rounded-lg border p-3 text-sm">
        <p>新包将替换本机图库。合成台已选参考图和生成记录不会删除。</p>
        <Button type="button" size="sm" className="mr-2 min-h-11" onClick={() => void replacePack()}>确认替换</Button>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setReplacement(null)}>取消</Button>
      </div>}
      {clearing && <div className="space-y-2 rounded-lg border p-3 text-sm">
        <p>移除后需重新导入才能浏览图库，不影响已选参考图或生成记录。</p>
        <Button type="button" variant="destructive" size="sm" className="mr-2 min-h-11" onClick={() => void removePack()}>确认移除</Button>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setClearing(false)}>取消</Button>
      </div>}
      {slot && <AndroidGalleryResults key={slot} pack={pack} slot={slot} ready={status === 'ready'} locked={busy || Boolean(replacement) || clearing} onSelect={onSelect} />}
    </DialogContent>
  </Dialog>
}

function AndroidGalleryResults({ pack, slot, ready, locked, onSelect }: {
  pack: AndroidGalleryPack | null
  slot: ReferenceSlot
  ready: boolean
  locked: boolean
  onSelect: (item: AndroidGalleryItem) => void
}) {
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(PAGE)
  const [tag, setTag] = useState('')
  const tags = androidGalleryFilterTags(pack, slot)
  const activeTag = tags.includes(tag) ? tag : ''
  const matches = searchAndroidGallery(pack, slot, query, activeTag)
  if (!ready) return null

  if (!pack) return <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
    暂无本机图库。先在电脑从现有图库导出手机素材包，再把 JSON 文件传到手机，在这里导入。
  </p>

  return <>
    <div className="relative">
      <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="min-h-11 pl-9" type="search" maxLength={120} placeholder="按名称或标签查找" aria-label="搜索本地素材"
        value={query} onChange={event => { setQuery(event.target.value); setCount(PAGE) }} />
    </div>
    {tags.length > 0 && <div className="flex min-h-11 shrink-0 items-center gap-1.5 overflow-x-auto" aria-label="素材标签">
      {['', ...tags].map(value => <Button key={value} type="button" size="sm" className="min-h-10 shrink-0"
        variant={activeTag === value ? 'default' : 'outline'} aria-pressed={activeTag === value}
        onClick={() => { setTag(value); setCount(PAGE) }}>{value || '全部'}</Button>)}
    </div>}
    <div className="min-h-0 overflow-y-auto">
      {!matches.length && <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{(query.trim() || activeTag) ? '没有匹配的素材，试试其他关键词或标签。' : '当前素材包不含此类素材。'}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {matches.slice(0, count).map((item, index) => <button key={index} type="button" disabled={locked}
          className="min-w-0 overflow-hidden rounded-xl border bg-background text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
          onClick={() => onSelect(item)}>
          <img src={item.dataUrl} alt="" loading="lazy" decoding="async" className="aspect-4/3 w-full bg-muted object-contain" />
          <span className="block truncate px-2 pt-2 text-sm font-medium" title={item.name}>{item.name}</span>
          <span className="block min-h-6 truncate px-2 text-xs text-muted-foreground" title={item.tags.join(' · ')}>{item.tags.join(' · ')}</span>
        </button>)}
      </div>
      {matches.length > count && <Button type="button" variant="outline" className="mt-3 min-h-11 w-full" disabled={locked} onClick={() => setCount(value => value + PAGE)}>显示更多（{count} / {matches.length}）</Button>}
    </div>
  </>
}
