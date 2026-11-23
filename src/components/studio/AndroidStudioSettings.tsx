import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { KeyRoundIcon, LoaderCircleIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { Field, Section } from '@/components/common/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StudioBackupPanel } from '@/components/studio/StudioBackupPanel'
import { androidStudio } from '@/lib/androidStudio'
import { toast } from '@/lib/notifications'

export function AndroidStudioSettings() {
  const keyInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const pending = useRef(false)
  const statusVersion = useRef(0)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [statusError, setStatusError] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const refreshStatus = async () => {
    const version = ++statusVersion.current
    try {
      const status = await androidStudio.keyStatus()
      if (mounted.current && statusVersion.current === version) { setConfigured(status.configured); setStatusError(false) }
    } catch { if (mounted.current && statusVersion.current === version) setStatusError(true) }
  }
  useEffect(() => {
    mounted.current = true
    // oxlint-disable-next-line react/set-state-in-effect -- status is read asynchronously from native secure storage
    void refreshStatus()
    const input = keyInput.current
    return () => { mounted.current = false; if (input) input.value = '' }
  }, [])

  const saveKey = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current) return
    let key = keyInput.current?.value.trim() || ''
    if (!key) { toast.error('请先输入 OpenAI API Key'); return }
    pending.current = true
    statusVersion.current++
    setBusy(true)
    try {
      await androidStudio.saveKey({ key })
      if (keyInput.current) keyInput.current.value = ''
      if (mounted.current) { setConfigured(true); setStatusError(false); toast.success('API Key 已保存到本机安全存储') }
    } catch { if (mounted.current) toast.error('API Key 保存失败，请重试') }
    finally { key = ''; pending.current = false; if (mounted.current) setBusy(false) }
  }
  const clearKey = async () => {
    if (pending.current) return
    pending.current = true
    statusVersion.current++
    setBusy(true)
    try {
      await androidStudio.clearKey()
      if (keyInput.current) keyInput.current.value = ''
      if (mounted.current) { setConfigured(false); setStatusError(false); setConfirmClear(false); toast.success('已清除本机 API Key') }
    } catch { if (mounted.current) toast.error('API Key 清除失败，请重试') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }

  return <>
    <PageHeader title="OpenAI 设置" actions={<Button variant="outline" size="sm" asChild><Link to="/studio">返回合成台</Link></Button>} />
    <Section title="本机 API Key" className="@lg/section:grid-cols-1">
      <p role="status" className="flex items-center gap-2 text-sm"><KeyRoundIcon className="size-4" />{statusError ? '暂时无法读取密钥状态' : configured === null ? '正在读取密钥状态…' : configured ? '已配置 OpenAI API Key' : '尚未配置 API Key'}</p>
      {statusError && <Button type="button" variant="outline" disabled={busy} onClick={() => void refreshStatus()}>重试读取状态</Button>}
      <p className="text-xs leading-relaxed text-muted-foreground">密钥只交给本机原生安全存储，不写入网页配置或备份。生成请求仅发送到 OpenAI 官方接口。保存不验证余额或模型权限。</p>
      <form onSubmit={event => void saveKey(event)} className="space-y-3" autoComplete="off">
        <Field label={configured ? '替换 API Key' : 'OpenAI API Key'}>
          <Input ref={keyInput} type="password" name="openai-key" aria-label="OpenAI API Key" placeholder="输入 API Key" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} className="min-h-11 font-mono" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy} className="min-h-11">{busy && <LoaderCircleIcon className="size-4 animate-spin" />}保存密钥</Button>
          <Button type="button" variant="outline" disabled={busy || configured === false} onClick={() => setConfirmClear(true)} className="min-h-11">清除密钥</Button>
        </div>
      </form>
      {confirmClear && <div role="alert" className="space-y-3 rounded-lg border p-3 text-sm">
        <p>清除后需重新输入 API Key 才能生成，已有图片与备份不会删除。</p>
        <div className="flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => void clearKey()}>确认清除</Button><Button variant="outline" disabled={busy} onClick={() => setConfirmClear(false)}>取消</Button></div>
      </div>}
    </Section>
    <StudioBackupPanel importOnly />
  </>
}
