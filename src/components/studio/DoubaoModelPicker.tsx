import { isDoubaoSingleImageModel } from '@/services/aiGenerator'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { doubaoModelOptions, fetchDoubaoImageModels } from '@/lib/doubaoImageModels'
import type { DoubaoModelList, ModelOption } from '@/lib/doubaoImageModels'

/** Results are transient and scoped to this connection/key; only an explicit selection changes config. */
export function DoubaoModelPicker({ baseUrl, apiKey, useProxy, model, customModel, defaults, onSelect }: {
  baseUrl: string; apiKey: string; useProxy: boolean; model: string; customModel: string; defaults: ModelOption[]; onSelect: (model: string) => void
}) {
  const connection = useMemo(() => ({ baseUrl, apiKey, useProxy, token: Symbol('doubao-model-connection') }), [baseUrl, apiKey, useProxy])
  const scope = connection.token
  type View = { list: DoubaoModelList | null; busy: boolean; notice: string; error: string }
  const empty: View = { list: null, busy: false, notice: '', error: '' }
  const [result, setResult] = useState<{ scope: typeof scope; view: View } | null>(null)
  // Old-connection results are hidden immediately, including before effect cleanup runs.
  const view = result?.scope === scope ? result.view : empty
  const { list, busy, notice, error } = view
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
      const discovered = await fetchDoubaoImageModels({ baseUrl: connection.baseUrl, apiKey: connection.apiKey, useProxy: connection.useProxy, signal: current.signal })
      if (!valid()) return
      update({ list: discovered, notice: discovered.models.length
        ? `本次查询返回 ${discovered.models.length} 个生图候选（${new Date().toLocaleTimeString()}）；当前模型未改变。`
        : '查询成功，但当前接口未返回匹配的生图候选。仍可查看官方文档收录或手动填写；当前模型未改变。' })
    } catch (cause) {
      if (valid()) {
        // Keep the previous successful list, but label it stale instead of claiming refresh success.
        update({ error: cause instanceof Error ? cause.message : '模型刷新失败；当前模型保持不变。', notice: '刷新未成功。若已有候选，仍是上次列表，不代表当前可用。' })
      }
    } finally { if (valid()) { request.current = null; update({ busy: false }) } }
  }
  const options = doubaoModelOptions(list, defaults, model)
  const optionItems = (items: ModelOption[]) => items.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="font-mono text-xs">{option.label}</SelectItem>)
  return <div className="space-y-2">
    <Select value={model} onValueChange={onSelect}>
      <SelectTrigger className="w-full font-mono text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.account.length > 0 && <SelectGroup><SelectLabel>最近一次查询：当前接口返回</SelectLabel>{optionItems(options.account)}</SelectGroup>}
        {options.official.length > 0 && <SelectGroup><SelectLabel>方舟官方文档收录 · 未确认当前连接可用</SelectLabel>{optionItems(options.official)}</SelectGroup>}
        <SelectGroup><SelectLabel>原配置与手动填写</SelectLabel>{optionItems([...options.existing, options.manual])}</SelectGroup>
      </SelectContent>
    </Select>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy || !apiKey.trim()} onClick={() => void refresh()}>{busy ? '正在刷新模型…' : '刷新可用生图模型'}</Button>
      {busy && <Button type="button" variant="ghost" size="sm" onClick={() => { request.current?.abort(); request.current = null; update({ busy: false, notice: '已取消刷新，当前模型保持不变。' }) }}>取消刷新</Button>}
    </div>
    <p className="text-xs text-muted-foreground">刷新只查询当前连接的模型列表，不提交生图、不自动切换。接口返回不等于已开通生成权限；官方文档选项按标准方舟 API 整理，不随刷新更新，也不代表当前账号或兼容接口已支持。自建 ep-… 请选择“自定义”填写。</p>
    {isDoubaoSingleImageModel(model === 'custom' ? customModel.trim() : model) && <p className="text-xs text-muted-foreground">当前模型仅支持单图，参考图最多 10 张；请在合成参数中选择 disabled（单张），推荐 2K，不支持 4K。</p>}
    {model === 'custom' && <p className="text-xs text-muted-foreground">自定义 ep-… 的底层模型无法仅凭 ID 判断，请核对接入点对应模型及参数。</p>}
    {!apiKey.trim() && <p className="text-xs text-muted-foreground">请先输入或解锁 API Key。无需填写 AK/SK。</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
