import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { credentialStorage } from '@/lib/credentialStorage'
import { harnessKeyEpoch } from '@/lib/harnessKeyMemory'
import type { ImageProviderId } from '@/types/gallery'

const storage = credentialStorage()
/** This component is keyed by provider/endpoint so an in-flight unlock cannot target a new destination. */
export function EncryptedKeyPanel({ provider, endpoint, apiKey, setKey }: {
  provider: ImageProviderId; endpoint: string; apiKey: string; setKey: (value: string) => void
}) {
  const [saved, setSaved] = useState<boolean | null>(null)
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const lifecycle = useRef(0)
  useEffect(() => {
    const current=++lifecycle.current
    storage.configured(provider).then(value=>{if(current===lifecycle.current)setSaved(value)}).catch(()=>{if(current===lifecycle.current)setNotice('无法读取加密存储状态；请检查存储权限')})
    return () => { lifecycle.current = current + 1 }
  },[provider])
  async function run(action: 'save' | 'unlock' | 'delete') {
    if (busy) return
    if (action==='save' && password!==confirmation) { setNotice('两次解锁口令不一致'); return }
    const current=lifecycle.current, epoch=harnessKeyEpoch(), passphrase=password
    setPassword(''); setConfirmation(''); setBusy(true); setNotice('')
    try {
      if(action==='save') {
        await storage.save(provider,endpoint,apiKey,passphrase)
        if(current===lifecycle.current) { setSaved(true); setNotice('已加密保存。重启后需输入解锁口令；忘记口令无法恢复。') }
      } else if(action==='unlock') {
        const secret=await storage.unlock(provider,endpoint,passphrase)
        if(current!==lifecycle.current) return
        if(epoch!==harnessKeyEpoch()) throw new Error('密钥状态已改变，请重新解锁')
        setKey(secret); setNotice('已解锁到当前窗口内存')
      } else {
        await storage.remove(provider)
        if(current===lifecycle.current) { setSaved(false); setConfirmDelete(false); setKey(''); setNotice('已删除此供应商的加密记录，并清空当前内存密钥') }
      }
    } catch(error) {
      if(current===lifecycle.current) setNotice(error instanceof Error ? error.message : '加密存储操作失败')
    } finally { if(current===lifecycle.current)setBusy(false) }
  }
  return <details className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">加密保存 API Key（重启后口令解锁）</summary>
    <p className="my-2 text-muted-foreground">仅在本宿主页面的浏览器存储中保存密文，不保存解锁口令。重启或重装插件后恢复，需要宿主地址及浏览器数据保持不变；清除应用数据、更换地址或用户配置可能丢失。不自动同步，当前备份不含此记录。请使用独立长口令并妥善保管。</p>
    <p role="status">{saved===null?'存储状态待确认':saved?'此供应商已有加密记录':'此供应商尚未加密保存'} · {apiKey?'当前内存已配置':'当前内存未配置'}</p>
    <div className="my-2 grid gap-2">
      <Input type="password" autoComplete="off" aria-label="加密保存解锁口令" placeholder="解锁口令（至少 12 字符）" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} />
      <Input type="password" autoComplete="off" aria-label="保存时再次输入解锁口令" placeholder="保存时再次输入口令；仅解锁无需填写" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} />
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy || saved===null || !apiKey} onClick={()=>void run('save')}>{saved?'覆盖加密保存当前 Key':'加密保存当前 Key'}</Button>
      <Button type="button" variant="outline" disabled={busy || !saved} onClick={()=>void run('unlock')}>解锁已保存 Key</Button>
      <Button type="button" variant="outline" disabled={busy || !apiKey} onClick={()=>{setKey('');setNotice('已清空当前内存密钥；加密记录保留')}}>清空当前内存 Key</Button>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label><input type="checkbox" checked={confirmDelete} disabled={busy || !saved} onChange={e=>setConfirmDelete(e.target.checked)} /> 确认删除此供应商的加密记录</label>
      <Button type="button" variant="outline" disabled={busy || !saved || !confirmDelete} onClick={()=>void run('delete')}>删除加密记录</Button>
    </div>
    {notice && <p role="status" className="mt-2">{notice}</p>}
  </details>
}
