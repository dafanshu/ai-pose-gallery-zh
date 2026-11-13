export const AUTOMATIC_GPT_IMAGE_MODEL = 'auto-latest'

export const AUTOMATIC_GPT_IMAGE_MODEL_HINT = '自动模式仅适用于 Images 编辑接口；每次生成前查询当前 Base URL 的模型列表，从应用维护的官方目录中选择。本应用同代优先 Sunburst，其次 Flare。列表收录不代表调用已验证可用；未知模型、查询失败或其他协议请手动选择。已有设置不会被覆盖。'

// Official Images API catalogue, reviewed 2026-11-13:
// https://developers.openai.com/api/reference/resources/images/methods/edit
// The API list is unordered and has no capability/version ranking metadata.
// App policy: prefer Sunburst for detailed editing, then Flare for fast iteration.
// https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst.md
// https://developers.openai.com/api/docs/models/gpt-image-2.6-flare.md
// New official IDs must be reviewed here rather than guessed from names/created.
export const KNOWN_OPENAI_IMAGE_MODELS = [
  'gpt-image-2.6-sunburst',
  'gpt-image-2.6-flare',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2',
  'gpt-image-1.5',
] as const

export function selectLatestKnownOpenAIImageModel(data: unknown[], now = Date.now()): string | undefined {
  const available = new Set<string>()
  for (const value of data) {
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') continue
    if ('shutdown_date' in value && value.shutdown_date != null) {
      const shutdown = typeof value.shutdown_date === 'number'
        ? value.shutdown_date * 1000
        : typeof value.shutdown_date === 'string' ? Date.parse(value.shutdown_date) : NaN
      // Unknown or elapsed shutdown dates are not safe automatic choices.
      if (!Number.isFinite(shutdown) || shutdown <= now) continue
    }
    available.add(value.id)
  }
  return KNOWN_OPENAI_IMAGE_MODELS.find((id) => available.has(id))
}

export async function resolveLatestOpenAIImageModel(params: {
  baseUrl: string
  apiKey: string
  useProxy: boolean
  signal?: AbortSignal
}): Promise<string> {
  const { baseUrl, apiKey, useProxy, signal } = params
  const help = '请检查当前 Base URL、API Key、跨域/代理配置，或在“模型 ID”中手动选择。'
  let target: URL
  try {
    target = new URL(baseUrl)
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('invalid base URL')
    let path = target.pathname.replace(/\/+$/, '')
    if (!path.endsWith('/v1')) path += '/v1'
    target.pathname = `${path}/models`
  } catch {
    throw new Error(`[GPT] 自动选择失败：Base URL 必须为不含查询参数或账号信息的 HTTP(S) 接口根地址。${help}`)
  }

  const headers = new Headers({ Authorization: `Bearer ${apiKey}` })
  if (useProxy) headers.set('x-target-url', target.href)
  let response: Response
  try {
    response = await fetch(useProxy ? '/api/proxy' : target.href, {
      method: 'GET',
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch {
    signal?.throwIfAborted()
    throw new Error(`[GPT] 无法读取当前接口的模型列表（网络、跨域、重定向或超时）。${help}`)
  }
  signal?.throwIfAborted()
  if (!response.ok) {
    throw new Error(`[GPT] 读取模型列表失败（HTTP ${response.status}）。${useProxy ? '生产代理仅允许白名单域名的 /v1/models。' : ''}${help}`)
  }
  let result: unknown
  try {
    result = await response.json()
  } catch {
    signal?.throwIfAborted()
    throw new Error(`[GPT] 模型列表读取失败或不是有效 JSON。${help}`)
  }
  signal?.throwIfAborted()
  if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data)) {
    throw new Error(`[GPT] 当前接口未返回标准模型列表 data 数组。${help}`)
  }
  const selected = selectLatestKnownOpenAIImageModel(result.data)
  if (!selected) {
    throw new Error('[GPT] 当前接口列表中没有可自动选择的已知 OpenAI 生图模型；不会根据第三方模型名称猜测能力。请在“模型 ID”中手动选择或填写服务商支持的模型。')
  }
  return selected
}
