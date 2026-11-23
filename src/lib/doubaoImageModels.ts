import { isHarness, proxyUrl, transportHeaders } from './runtime'

export interface DoubaoImageModel {
  id: string
  retiring: boolean
  nameOnly: boolean
}
export interface ModelOption { value: string; label: string }

/** Ark Models API order is newest-first. Do not invent a ranking from model names. */
export function selectDoubaoImageModels(data: unknown[]): DoubaoImageModel[] {
  const seen = new Set<string>(), result: DoubaoImageModel[] = []
  for (const value of data) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>, id = row.id
    if (typeof id !== 'string' || id === 'custom' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id) || seen.has(id)) continue
    if (row.status !== undefined && row.status !== 'Published' && row.status !== 'Retiring') continue
    if (row.api_supported === false) continue
    // A vision/chat model can accept images without producing them.
    const modalities = row.modalities && typeof row.modalities === 'object' ? row.modalities as Record<string, unknown> : undefined
    const outputs = modalities?.output_modalities
    const tasks = row.task_type
    if (outputs !== undefined && (!Array.isArray(outputs) || !outputs.includes('image'))) continue
    // This studio sends reference images, not just a text-only prompt.
    if (tasks !== undefined && (!Array.isArray(tasks) || !tasks.includes('ImageToImage'))) continue
    if (row.domain !== undefined && row.domain !== '' && row.domain !== 'ImageGeneration') continue
    const metadata = row.domain === 'ImageGeneration' || (Array.isArray(outputs) && outputs.includes('image')) || (Array.isArray(tasks) && tasks.includes('ImageToImage'))
    const sparse = (row.domain === undefined || row.domain === '') && outputs === undefined && tasks === undefined
    if (!metadata && !(sparse && /^doubao-seedream-/.test(id))) continue
    seen.add(id)
    result.push({ id, retiring: row.status === 'Retiring', nameOnly: !metadata })
  }
  return result
}

/** Keep current/default/manual entries. A refresh is never a model-selection action. */
export function doubaoModelOptions(discovered: DoubaoImageModel[], defaults: ModelOption[], current: string, refreshed: boolean): ModelOption[] {
  const result: ModelOption[] = discovered.map(model => ({ value: model.id, label: model.id + (model.retiring ? ' · 即将下线' : '') + (model.nameOnly ? ' · 名称候选，需确认兼容' : ' · 列表可见') }))
  const seen = new Set(result.map(row => row.value))
  if (current && current !== 'custom' && !seen.has(current)) {
    result.push({ value: current, label: current + (refreshed ? ' · 当前配置，未在最新列表确认' : ' · 当前配置') })
    seen.add(current)
  }
  for (const option of defaults) if (option.value !== 'custom' && !seen.has(option.value)) {
    result.push({ value: option.value, label: option.label + (refreshed ? ' · 内置参考，未在最新列表确认' : ' · 内置参考') })
    seen.add(option.value)
  }
  result.push({ value: 'custom', label: '自定义模型 ID / Endpoint（ep-…）' })
  return result
}

export function doubaoModelsUrl(baseUrl: string): string {
  try {
    const target = new URL(baseUrl.trim())
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('invalid')
    let path = target.pathname.replace(/\/+$/, '').replace(/\/images\/generations$/, '')
    if (!path.endsWith('/api/v3') && !path.endsWith('/v1')) path += '/api/v3'
    target.pathname = path + '/models'
    return target.href
  } catch {
    throw new Error('[Doubao] Base URL 须为不含账号、查询参数或片段的 HTTP(S) 接口根地址。官方可填 https://ark.cn-beijing.volces.com 或其 /api/v3 地址。')
  }
}

export async function fetchDoubaoImageModels(params: { baseUrl: string; apiKey: string; useProxy: boolean; signal?: AbortSignal }): Promise<DoubaoImageModel[]> {
  const { apiKey, signal } = params
  if (!apiKey.trim()) throw new Error('[Doubao] 请先输入或解锁方舟 API Key，再手动刷新模型。')
  signal?.throwIfAborted()
  const target = doubaoModelsUrl(params.baseUrl), useProxy = isHarness() || params.useProxy
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` })
  if (useProxy) headers.set('x-target-url', target)
  const help = '当前模型保持不变；可继续使用已配置模型或手填 Endpoint ID。'
  let response: Response
  try {
    response = await fetch(useProxy ? proxyUrl() : target, {
      method: 'GET', headers: transportHeaders(headers), credentials: isHarness() && useProxy ? 'same-origin' : 'omit',
      redirect: 'error', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch {
    signal?.throwIfAborted()
    throw new Error(`[Doubao] 模型刷新失败（网络、跨域、重定向或 15 秒超时）。请检查接口地址和代理配置。${help}`)
  }
  signal?.throwIfAborted()
  if (!response.ok) {
    const reason = [401, 403].includes(response.status) ? '请检查 API Key、账号模型权限或 Harness 代理白名单。'
      : [404, 405].includes(response.status) ? '当前接口不支持模型列表，或 Base URL / 代理路径不匹配。'
        : response.status === 429 ? '请求受限，请稍后手动重试。' : '请检查服务状态后手动重试。'
    // Never render an upstream body: it can echo credentials, HTML, or internal details.
    throw new Error(`[Doubao] 模型刷新失败（HTTP ${response.status}）。${reason}${help}`)
  }
  let result: unknown
  try { result = await response.json() } catch {
    signal?.throwIfAborted()
    throw new Error(`[Doubao] 模型列表不是有效 JSON。${help}`)
  }
  signal?.throwIfAborted()
  if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data)) throw new Error(`[Doubao] 模型列表缺少标准 data 数组。${help}`)
  const models = selectDoubaoImageModels(result.data)
  if (!models.length) throw new Error(`[Doubao] 当前列表没有可识别的参考图生图候选。只接受图像生成能力或稀疏列表中的 Seedream 名称，不把视觉聊天模型当作生图模型。${help}`)
  return models
}
