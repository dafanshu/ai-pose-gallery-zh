import { isHarness, proxyUrl, transportHeaders } from './runtime'

// Reviewed 2026-11-23 against the Chinese Ark image generation tutorial (updated 2026-11-19).
// https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-tutorial
// Reference only: these IDs are not proof of current account visibility or entitlement.
export const OFFICIAL_DOUBAO_IMAGE_MODELS = [
  { value: 'doubao-seedream-5-5-261028', label: 'Seedream 5.5' },
  { value: 'doubao-seedream-5-0-pro-260628', label: 'Seedream 5.0 Pro' },
  { value: 'doubao-seedream-5-0-flash-260915', label: 'Seedream 5.0 Flash' },
  { value: 'doubao-seedream-5-0-260128', label: 'Seedream 5.0 Lite' },
  { value: 'doubao-seedream-5-0-lite-260128', label: 'Seedream 5.0 Lite（官方别名）' },
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' },
] as const
const officialIds = new Set<string>(OFFICIAL_DOUBAO_IMAGE_MODELS.map(model => model.value))

export interface DoubaoImageModel {
  id: string
  retiring: boolean
  evidence: 'metadata' | 'official' | 'name'
}
export interface DoubaoModelList {
  models: DoubaoImageModel[]
  rejectedOfficialIds: string[]
}
export interface ModelOption { value: string; label: string; disabled?: boolean }

function capabilityEvidence(row: Record<string, unknown>, official: boolean): DoubaoImageModel['evidence'] | undefined {
  if (row.status !== undefined && row.status !== 'Published' && row.status !== 'Retiring') return
  if (row.api_supported === false) return
  // A vision/chat model can accept images without producing them.
  if (row.modalities != null && (typeof row.modalities !== 'object' || Array.isArray(row.modalities))) return
  const outputs = (row.modalities as Record<string, unknown> | null | undefined)?.output_modalities
  const tasks = row.task_type
  const domain = row.domain
  const absentDomain = domain === undefined || domain === '' || (official && domain === null)
  // An exact documented ID may fill omitted/empty fields. It must not override
  // a nonempty conflicting field (e.g. text-only output or TextToImage only).
  const missing = (value: unknown) => value === undefined || (official && (value === null || (Array.isArray(value) && value.length === 0)))
  if (!missing(outputs) && (!Array.isArray(outputs) || !outputs.includes('image'))) return
  if (!missing(tasks) && (!Array.isArray(tasks) || !tasks.includes('ImageToImage'))) return
  if (!absentDomain && domain !== 'ImageGeneration') return
  if (official && (missing(outputs) || missing(tasks) || absentDomain)) return 'official'
  if (domain === 'ImageGeneration' || (Array.isArray(outputs) && outputs.includes('image')) || (Array.isArray(tasks) && tasks.includes('ImageToImage'))) return 'metadata'
  if (absentDomain && outputs === undefined && tasks === undefined && /^doubao-seedream-/.test(row.id as string)) return 'name'
}

/** Ark Models API order is newest-first. Do not invent a ranking from model names. */
export function selectDoubaoImageModels(data: unknown[]): DoubaoModelList {
  const seen = new Set<string>(), models: DoubaoImageModel[] = [], rejectedOfficialIds: string[] = []
  for (const value of data) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>, id = row.id
    if (typeof id !== 'string' || id === 'custom' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id) || seen.has(id)) continue
    seen.add(id)
    const official = officialIds.has(id), evidence = capabilityEvidence(row, official)
    if (evidence) models.push({ id, retiring: row.status === 'Retiring', evidence })
    else if (official) rejectedOfficialIds.push(id)
  }
  return { models, rejectedOfficialIds }
}

/** Build disjoint groups; refresh never changes the selected model. */
export function doubaoModelOptions(list: DoubaoModelList | null, defaults: ModelOption[], current: string) {
  const account: ModelOption[] = (list?.models ?? []).map(model => ({ value: model.id, label: model.id + (model.retiring ? ' · 即将下线' : '') + (model.evidence === 'name' ? ' · 名称候选' : model.evidence === 'official' ? ' · 能力参照官方文档' : '') }))
  const seen = new Set(account.map(row => row.value))
  const official: ModelOption[] = []
  for (const model of OFFICIAL_DOUBAO_IMAGE_MODELS) if (!seen.has(model.value)) {
    const disabled = list?.rejectedOfficialIds.includes(model.value) ?? false
    official.push({ value: model.value, label: `${model.label} · ${model.value}${disabled ? ' · 接口显示不匹配' : ''}`, disabled })
    seen.add(model.value)
  }
  const existing: ModelOption[] = []
  if (current && current !== 'custom' && !seen.has(current)) {
    existing.push({ value: current, label: `${current} · 当前配置` })
    seen.add(current)
  }
  for (const option of defaults) if (option.value !== 'custom' && !seen.has(option.value)) {
    existing.push(option)
    seen.add(option.value)
  }
  return { account, official, existing, manual: { value: 'custom', label: '自定义模型 ID / Endpoint（ep-…）' } }
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

export async function fetchDoubaoImageModels(params: { baseUrl: string; apiKey: string; useProxy: boolean; signal?: AbortSignal }): Promise<DoubaoModelList> {
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
  return selectDoubaoImageModels(result.data)
}
