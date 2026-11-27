import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const edges = [
  ['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下'],
] as const
const opposites = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const
type Edge = (typeof edges)[number][0]
type Margins = Record<Edge, number>
const full: Margins = { left: 0, right: 0, top: 0, bottom: 0 }

export function AndroidExtraCrop({ url, onSave, onClose }: { url: string; onSave: (url: string) => void; onClose: () => void }) {
  const [margins, setMargins] = useState(full)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tightened = Object.values(margins).some(Boolean)

  async function save() {
    if (busy || !tightened) return
    setBusy(true)
    setError('')
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const x = Math.floor(margins.left / 100 * image.naturalWidth)
      const y = Math.floor(margins.top / 100 * image.naturalHeight)
      const width = Math.ceil((100 - margins.right) / 100 * image.naturalWidth) - x
      const height = Math.ceil((100 - margins.bottom) / 100 * image.naturalHeight) - y
      if (width < 1 || height < 1) throw new Error()
      const scale = Math.min(1, 1024 / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error()
      ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height)
      onSave(canvas.toDataURL('image/png'))
    } catch {
      setError('裁剪失败，请换一张本机图片再试。')
      setBusy(false)
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>选取附图局部</DialogTitle>
        <DialogDescription>调整四边，把要借用的纹样、材质或配饰留在亮框内。只发送框内像素，不发送框外内容。</DialogDescription>
      </DialogHeader>
      <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg">
        <img src={url} alt="附加图裁剪预览" className="block max-h-[42dvh] max-w-full w-auto object-contain" />
        <div aria-hidden className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_999px_rgb(0_0_0/0.55)]"
          style={{ left: `${margins.left}%`, right: `${margins.right}%`, top: `${margins.top}%`, bottom: `${margins.bottom}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {edges.map(([edge, label]) => <label key={edge} className="grid gap-1 text-xs">
          {label}边裁去 {margins[edge]}%
          <input type="range" min={0} max={95 - margins[opposites[edge]]} step={1} value={margins[edge]} disabled={busy}
            onChange={event => { const value = event.currentTarget.valueAsNumber; setMargins(current => ({ ...current, [edge]: value })) }} />
        </label>)}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
        <Button onClick={() => void save()} disabled={busy || !tightened}>{busy ? '正在裁剪…' : '使用框内局部'}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
