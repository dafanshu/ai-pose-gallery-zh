import { useRef, useState } from 'react'
import { useStudio } from '@/store/studioStore'
import { Button } from '@/components/ui/button'
import { MAX_BACKUP_BYTES, parseStudioBackup, serializeStudioBackup } from '@/lib/studioBackup'
import { toast } from '@/lib/notifications'
import { harnessRuntime, isHarness } from '@/lib/runtime'

export function StudioBackupPanel() {
  const { recipe, history, importBackup, isGenerating, activeTask, hydrated } = useStudio()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<ReturnType<typeof parseStudioBackup> | null>(null)
  const [busy, setBusy] = useState(false)
  const disabled = busy || !hydrated || isGenerating || Boolean(activeTask)
  const exportBackup = () => {
    try {
      const blob = new Blob([serializeStudioBackup(recipe, history)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = 'pose-atlas-backup-v1.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { toast.error(error instanceof Error ? error.message : '备份导出失败') }
  }
  return <section className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">配方与历史备份</h2>
    <p className="text-sm text-muted-foreground">导出或导入当前浏览器的配方、参考图片与历史记录（最多 50 MB）。不包含 API Key、服务商设置或未完成任务。导入会替换当前配方和历史，请先导出备份。旧站数据需在旧站打开此版本并手动导出，不会跨站读取。</p>
    {isHarness() && <p className="text-sm text-muted-foreground">Harness 使用独立存储。API Key 仅在当前页面内存中保留，刷新后需重新输入；所有服务商请求经 Harness 代理，参考图以 Base64 发送。ComfyUI 连接地址由 Harness 管理，{harnessRuntime()?.comfyWebSocket ? '任务进度使用 WebSocket，连接不可用时自动切换 HTTP 轮询。' : '此 Harness 版本的任务进度使用 HTTP 轮询。'}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled} onClick={exportBackup}>导出备份</Button>
      <Button variant="outline" disabled={disabled} onClick={() => input.current?.click()}>选择备份文件</Button>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; setPending(null)
        if (!file) return
        setBusy(true)
        try {
          if (file.size > MAX_BACKUP_BYTES) throw new Error('备份不能超过 50 MB')
          setPending(parseStudioBackup(await file.text()))
        } catch (error) { toast.error(error instanceof Error ? error.message : '无法读取备份') }
        finally { setBusy(false) }
      }} />
    </div>
    {pending && <div className="space-y-2" role="alert">
      <p>将替换当前配方及 {history.length} 条记录，导入 {pending.history.length} 条历史记录。是否继续？</p>
      <Button disabled={disabled} onClick={async () => {
        setBusy(true)
        try { await importBackup(pending.recipe, pending.history); setPending(null); toast.success('备份已导入') }
        catch (error) { toast.error(error instanceof Error ? error.message : '导入失败') }
        finally { setBusy(false) }
      }}>确认替换并导入</Button>{' '}
      <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>取消</Button>
    </div>}
  </section>
}
