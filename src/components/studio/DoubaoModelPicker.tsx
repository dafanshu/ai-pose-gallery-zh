import { isDoubaoSingleImageModel } from '@/services/aiGenerator'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { doubaoModelOptions, fetchDoubaoImageModels } from '@/lib/doubaoImageModels'
import type { DoubaoImageModel, ModelOption } from '@/lib/doubaoImageModels'

/** Results are transient and scoped to this connection/key; only an explicit selection changes config. */
export function DoubaoModelPicker({ baseUrl, apiKey, useProxy, model, customModel, defaults, onSelect }: {
  baseUrl: string; apiKey: string; useProxy: boolean; model: string; customModel: string; defaults: ModelOption[]; onSelect: (model: string) => void
}) {
  const connection = useMemo(() => ({ baseUrl, apiKey, useProxy, token: Symbol('doubao-model-connection') }), [baseUrl, apiKey, useProxy])
  const scope = connection.token
  type View = { models: DoubaoImageModel[]; refreshed: boolean; busy: boolean; notice: string; error: string }
  const empty: View = { models: [], refreshed: false, busy: false, notice: '', error: '' }
  const [result, setResult] = useState<{ scope: typeof scope; view: View } | null>(null)
  // Old-connection results are hidden immediately, including before effect cleanup runs.
  const view = result?.scope === scope ? result.view : empty
  const { models, refreshed, busy, notice, error } = view
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort(); request.current = null }, [scope])
  function update(patch: Partial<View>) {
    setResult(previous => ({ scope, view: { ...(previous?.scope === scope ? previous.view : empty), ...patch } }))
  }
  async function refresh() {
    request.current?.abort()
    const current = new AbortController()
    request.current = current
    const valid = () => !current.signal.aborted && request.current === current
    update({ busy: true, notice: '', error: '' })
    try {
      const rows = await fetchDoubaoImageModels({ baseUrl: connection.baseUrl, apiKey: connection.apiKey, useProxy: connection.useProxy, signal: current.signal })
      if (!valid()) return
      update({ models: rows, refreshed: true, notice: `已刷新 ${rows.length} 个生图候选（${new Date().toLocaleTimeString()}），按接口顺序显示；当前模型未改变。` })
    } catch (cause) {
      if (valid()) {
        // Keep the previous successful list, but label it stale instead of claiming refresh success.
        update({ error: cause instanceof Error ? cause.message : '模型刷新失败；当前模型保持不变。', notice: '刷新未成功。若已有候选，仍是上次列表，不代表当前可用。' })
      }
    } finally { if (valid()) { request.current = null; update({ busy: false }) } }
  }
  const options = doubaoModelOptions(models, defaults, model, refreshed)
  return <div className="space-y-2">
    <Select value={model} onValueChange={onSelect}>
      <SelectTrigger className="w-full font-mono text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value} className="font-mono text-xs">{option.label}</SelectItem>)}</SelectContent>
    </Select>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy || !apiKey.trim()} onClick={() => void refresh()}>{busy ? '正在刷新模型…' : '刷新可用生图模型'}</Button>
      {busy && <Button type="button" variant="ghost" size="sm" onClick={() => { request.current?.abort(); request.current = null; update({ busy: false, notice: '已取消刷新，当前模型保持不变。' }) }}>取消刷新</Button>}
    </div>
    <p className="text-xs text-muted-foreground">使用当前地址和已输入/解锁的方舟 API Key 查询模型列表，不提交生图、不自动切换模型。列表可见不保证账号调用权限或所有合成参数兼容；仅有名称的候选需向接口提供方确认。自建 ep-… 推理接入点请选“自定义”填写。</p>
    {isDoubaoSingleImageModel(model === 'custom' ? customModel.trim() : model) && <p className="text-xs text-muted-foreground">当前模型仅支持单图，参考图最多 10 张；请在合成参数中选择 disabled（单张）。其中 Seedream 5.5 推荐 2K，不支持 4K。</p>}
    {model === 'custom' && <p className="text-xs text-muted-foreground">自定义 ep-… 的底层模型无法仅凭 ID 判断，请核对接入点对应模型及参数。</p>}
    {!apiKey.trim() && <p className="text-xs text-muted-foreground">请先输入或解锁 API Key。无需填写 AK/SK。</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
