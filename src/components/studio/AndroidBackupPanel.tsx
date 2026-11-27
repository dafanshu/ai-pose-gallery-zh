import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { androidBackupPreferences, readAndroidBackup, serializeAndroidBackup, writeAndroidBackup, type AndroidBackup } from '@/lib/androidBackup'
import { androidStudio } from '@/lib/androidStudio'
import { toast } from '@/lib/notifications'
import { useStudio } from '@/store/studioStore'

export function AndroidBackupPanel() {
  const { recipe, bodyPresets, androidPrompt, apiConfig, poseDepthMode, history, activeTask, isGenerating, hydrated, importAndroidBackup } = useStudio()
  const [pending, setPending] = useState<AndroidBackup | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const disabled = busy || !hydrated || isGenerating || Boolean(activeTask)
  const run = async (operation: () => Promise<void>) => {
    if (disabled || running.current) return
    running.current = true
    setBusy(true)
    try { await operation() }
    catch (error) {
      // Never show raw file contents or JSON exception details.
      toast.error(error instanceof Error ? error.message : '备份操作失败，未修改 App 数据')
    } finally { running.current = false; setBusy(false) }
  }
  return <div className="space-y-3 text-sm">
    <p className="text-muted-foreground">把当前配方、提示词、参考图、生成图、历史与生成偏好保存为 App 外的文件。不包含 API Key、厂商连接配置或完整素材包。</p>
    <p className="text-muted-foreground">备份包含实际图片，请放在自己信任的位置。每个完整备份最多 50 MiB。</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={disabled || Boolean(pending)} onClick={() => void run(async () => {
        const bytes = serializeAndroidBackup({ recipe, bodyPresets, history, customPrompt: androidPrompt.read(), poseDepthMode, preferences: androidBackupPreferences(apiConfig) })
        if (await writeAndroidBackup(androidStudio, bytes)) toast.success('备份文件已保存')
      })}>导出备份</Button>
      <Button type="button" variant="outline" disabled={disabled || Boolean(pending)} onClick={() => void run(async () => {
        setPending(await readAndroidBackup(androidStudio))
      })}>从文件还原</Button>
    </div>
    {busy && <p role="status">正在处理备份…</p>}
    {pending && <div role="alert" className="space-y-3 rounded-lg border p-3">
      <p>将替换本机当前配方、提示词、生成偏好及 {history.length} 条历史（若备份含形体预设，也会一并还原），导入 {pending.history.length} 条记录。密钥和素材包保持不变。</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" disabled={disabled} onClick={() => void run(async () => {
          await importAndroidBackup(pending)
          setPending(null)
          toast.success('备份已还原，未发起生图')
        })}>确认替换并还原</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => setPending(null)}>取消</Button>
      </div>
    </div>}
  </div>
}
