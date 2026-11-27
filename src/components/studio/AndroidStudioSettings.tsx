import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { LoaderCircleIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { Field, Section } from '@/components/common/FormSection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AndroidBackupPanel } from '@/components/studio/AndroidBackupPanel'
import { ANDROID_PROVIDERS, androidStudio, type AndroidProvider } from '@/lib/androidStudio'
import { useStudio } from '@/store/studioStore'
import { toast } from '@/lib/notifications'

type KeyStatus = 'configured' | 'unconfigured' | 'error'

function KeyIndicator({ name, status }: { name: string; status?: KeyStatus }) {
  const label = status === 'error' ? '状态读取失败' : status === undefined ? '读取中…' : status === 'configured' ? '已配置' : '未配置'
  return <Badge role="status" variant={status === 'error' ? 'destructive' : 'outline'} aria-label={`${name}：${label}`}>
    <span aria-hidden="true" className={status === 'error' ? 'size-2.5 shrink-0 rounded-full bg-amber-500' : status === 'configured' ? 'size-2.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400' : 'size-2.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500'} />
    {label}
  </Badge>
}

function ProviderSettings({ provider, model, active, status, updateStatus, onBusyChange }: {
  provider: (typeof ANDROID_PROVIDERS)[number]
  model: string
  active: boolean
  onBusyChange: (busy: boolean) => void
  status?: KeyStatus
  updateStatus: (provider: AndroidProvider, status: KeyStatus) => void
}) {
  const keyInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const pending = useRef(false)
  const statusVersion = useRef(0)
  const [savedWorkspaceId, setSavedWorkspaceId] = useState('')
  const [workspaceDraft, setWorkspaceDraft] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const configured = status === 'configured'
  const statusError = status === 'error'
  const refreshStatus = useCallback(async () => {
    const version = ++statusVersion.current
    try {
      const result = await androidStudio.keyStatus({ provider: provider.id })
      if (mounted.current && statusVersion.current === version) {
        updateStatus(provider.id, result.configured ? 'configured' : 'unconfigured')
        const workspaceId = provider.id === 'qwen' && result.workspaceId ? result.workspaceId : ''
        setSavedWorkspaceId(workspaceId)
        setWorkspaceDraft(current => current ?? workspaceId)
      }
    } catch { if (mounted.current && statusVersion.current === version) updateStatus(provider.id, 'error') }
  }, [provider.id, updateStatus])
  useEffect(() => {
    mounted.current = true
    // oxlint-disable-next-line react/set-state-in-effect -- status is read asynchronously from native secure storage
    void refreshStatus()
    const input = keyInput.current
    return () => { mounted.current = false; if (input) input.value = '' }
  }, [refreshStatus])

  const pasteKey = async () => {
    const input = keyInput.current
    if (!input || busy || pasting) return
    const previous = input.value
    setPasting(true)
    try {
      const { key } = await androidStudio.pasteKeyFromClipboard()
      if (mounted.current && keyInput.current === input && input.value === previous) input.value = key
    } catch { if (mounted.current) toast.error('剪贴板中没有可粘贴的 API Key') }
    finally { if (mounted.current) setPasting(false) }
  }

  const saveKey = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current || pasting) return
    let key = keyInput.current?.value.trim() || ''
    if (!key) { toast.error(`请先输入 ${provider.name} API Key`); return }
    const workspaceId = provider.id === 'qwen' ? (workspaceDraft ?? '').trim() : undefined
    if (workspaceId !== undefined && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(workspaceId)) {
      toast.error('请输入有效的百炼 Workspace ID，只能使用小写字母、数字和连字符')
      return
    }
    pending.current = true
    statusVersion.current++
    setBusy(true)
    onBusyChange(true)
    try {
      await androidStudio.saveKey({ provider: provider.id, key, ...(workspaceId === undefined ? {} : { workspaceId }) })
      if (keyInput.current) keyInput.current.value = ''
      if (mounted.current) {
        updateStatus(provider.id, 'configured')
        setSavedWorkspaceId(workspaceId || '')
        setWorkspaceDraft(workspaceId || '')
        setConfirmClear(false)
        toast.success('API Key 已保存到本机安全存储')
      }
    } catch { if (mounted.current) toast.error('API Key 保存失败，请重试') }
    finally { key = ''; pending.current = false; if (mounted.current) { setBusy(false); onBusyChange(false) } }
  }
  const clearKey = async () => {
    if (pending.current || pasting) return
    pending.current = true
    statusVersion.current++
    setBusy(true)
    onBusyChange(true)
    try {
      await androidStudio.clearKey({ provider: provider.id })
      if (keyInput.current) keyInput.current.value = ''
      if (mounted.current) {
        updateStatus(provider.id, 'unconfigured')
        setSavedWorkspaceId('')
        setWorkspaceDraft('')
        setConfirmClear(false)
        toast.success('已清除本机 API Key')
      }
    } catch { if (mounted.current) toast.error('API Key 清除失败，请重试') }
    finally { pending.current = false; if (mounted.current) { setBusy(false); onBusyChange(false) } }
  }

  const keyLabel = `${provider.name} API Key`
  return <Section title={provider.name} className="@lg/section:grid-cols-1" actions={<>
    {active && <Badge variant="secondary">当前使用</Badge>}
    <KeyIndicator name={provider.name} status={status} />
  </>}>
      {!statusError && configured && <dl className="grid gap-1 rounded-lg bg-background p-3 text-xs">
        <div className="grid grid-cols-[auto_1fr] gap-2"><dt className="text-muted-foreground">密钥</dt><dd>已保存到本机（未验证连接）</dd></div>
        {provider.id === 'qwen' && savedWorkspaceId && <div className="grid grid-cols-[auto_1fr] gap-2"><dt className="text-muted-foreground">Workspace ID</dt><dd className="min-w-0 break-all">{savedWorkspaceId}</dd></div>}
        <div className="grid grid-cols-[auto_1fr] gap-2"><dt className="text-muted-foreground">接口</dt><dd className="min-w-0 break-all">{savedWorkspaceId ? provider.endpoint.replace('{WorkspaceId}', savedWorkspaceId) : provider.endpoint}</dd></div>
        <div className="grid grid-cols-[auto_1fr] gap-2"><dt className="text-muted-foreground">模型</dt><dd className="min-w-0 break-all">{model}</dd></div>
      </dl>}
      {statusError && <Button type="button" variant="outline" disabled={busy} onClick={() => void refreshStatus()}>重试读取状态</Button>}
      <form onSubmit={event => void saveKey(event)} className="space-y-3" autoComplete="off">
        {provider.id === 'qwen' && <Field label="Workspace ID" htmlFor="android-qwen-workspace" hint="填写阿里云百炼中国内地（北京）工作空间 ID。">
          <Input id="android-qwen-workspace" name="android-qwen-workspace" placeholder="例如 ws-xxx" value={workspaceDraft ?? ''} onChange={event => setWorkspaceDraft(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy || (workspaceDraft === null && !statusError)} maxLength={63} className="min-h-11 font-mono" />
        </Field>}
        <Field label={configured ? '替换 API Key' : keyLabel} htmlFor={`android-key-${provider.id}`} hint="可长按输入框粘贴；输入内容默认遮住，不显示已保存的密钥。">
          <div className="flex gap-2"><Input ref={keyInput} id={`android-key-${provider.id}`} type="text" inputMode="text" maxLength={1024} aria-label={keyLabel} placeholder="输入或粘贴 API Key" autoCorrect="off" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} className="min-h-11 font-mono [-webkit-text-security:disc]" />
          <Button type="button" variant="outline" disabled={busy || pasting} onClick={() => void pasteKey()} className="min-h-11 shrink-0">粘贴</Button></div>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || pasting || (provider.id === 'qwen' && workspaceDraft === null && !statusError)} className="min-h-11">{busy && <LoaderCircleIcon className="size-4 animate-spin" />}保存密钥</Button>
          <Button type="button" variant="outline" disabled={busy || pasting || status === undefined || status === 'unconfigured'} onClick={() => setConfirmClear(true)} className="min-h-11">清除密钥</Button>
        </div>
      </form>
      {confirmClear && <div role="alert" className="space-y-3 rounded-lg border p-3 text-sm">
        <p>只清除 {provider.name} 的密钥，不影响其他厂商或已有图片。</p>
        <div className="flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => void clearKey()}>确认清除</Button><Button variant="outline" disabled={busy} onClick={() => setConfirmClear(false)}>取消</Button></div>
      </div>}
    </Section>
}

export function AndroidStudioSettings() {
  const { apiConfig } = useStudio()
  const [providerId, setProviderId] = useState<AndroidProvider>(() =>
    ANDROID_PROVIDERS.find(provider => provider.id === apiConfig.activeProvider)?.id ?? ANDROID_PROVIDERS[0].id,
  )
  const [busy, setBusy] = useState(false)
  const [statuses, setStatuses] = useState<Partial<Record<AndroidProvider, KeyStatus>>>({})
  const updateStatus = useCallback((provider: AndroidProvider, status: KeyStatus) => {
    setStatuses(current => ({ ...current, [provider]: status }))
  }, [])
  useEffect(() => {
    let active = true
    for (const { id } of ANDROID_PROVIDERS) {
      void androidStudio.keyStatus({ provider: id }).then(
        result => { if (active) setStatuses(current => current[id] === undefined ? { ...current, [id]: result.configured ? 'configured' : 'unconfigured' } : current) },
        () => { if (active) setStatuses(current => current[id] === undefined ? { ...current, [id]: 'error' } : current) },
      )
    }
    return () => { active = false }
  }, [])

  const provider = ANDROID_PROVIDERS.find(option => option.id === providerId) ?? ANDROID_PROVIDERS[0]
  const selected = apiConfig.providers[provider.id].model
  const model = provider.models.find(option => option.value === selected) ?? provider.models[0]
  return <>
    <PageHeader title="厂商连接设置" description="密钥按厂商分别保存在本机安全存储，不写入备份。已配置仅表示密钥已保存，不代表接口、余额或模型权限已验证。" actions={<Button variant="outline" size="sm" asChild><Link to="/studio">返回合成台</Link></Button>} />
    <div role="group" aria-label="选择要配置的厂商" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ANDROID_PROVIDERS.map(option => <Button key={option.id} type="button" variant={option.id === providerId ? 'default' : 'outline'} aria-pressed={option.id === providerId} disabled={busy} onClick={() => setProviderId(option.id)} className="h-auto min-h-12 min-w-0 flex-wrap gap-x-2 gap-y-1 whitespace-normal py-2">
        <span>{option.name}</span>
        <KeyIndicator name={option.name} status={statuses[option.id]} />
      </Button>)}
    </div>
    <ProviderSettings key={provider.id} provider={provider} model={model.value} active={apiConfig.activeProvider === provider.id} status={statuses[provider.id]} updateStatus={updateStatus} onBusyChange={setBusy} />
    <div className="rounded-lg border p-3">
      <Button variant="outline" onClick={() => {
        const plugin = (window as Window & { Capacitor?: { Plugins?: { PersonalUpdate?: { open(): Promise<void> } } } }).Capacitor?.Plugins?.PersonalUpdate
        if (!plugin) { toast.error('检查更新需要支持此功能的安卓版'); return }
        void plugin.open().catch(() => toast.error('无法打开应用更新'))
      }}>检查更新</Button>
    </div>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">导出与还原备份</summary><div className="pt-3"><AndroidBackupPanel /></div></details>
  </>
}
