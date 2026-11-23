import { isAndroidStudio } from './androidTarget'

/** Injected by the local Harness server before the studio module runs. */
export interface PoseHarnessRuntime {
  basePath: string
  assetBase: string
  proxyUrl: string
  comfyBase: string
  storageNamespace: string
  comfyWebSocket?: boolean
}
declare global { interface Window { __POSE_HARNESS__?: PoseHarnessRuntime } }
export function harnessRuntime(): PoseHarnessRuntime | undefined {
  return typeof window === 'undefined' ? undefined : window.__POSE_HARNESS__
}
export const isHarness = () => Boolean(harnessRuntime())
export const storageKey = (key: string) => isAndroidStudio() ? `android-personal:${key}` : harnessRuntime() ? `${harnessRuntime()!.storageNamespace}:${key}` : key
export const proxyUrl = () => harnessRuntime()?.proxyUrl || '/api/proxy'
export function assetUrl(src: string): string {
  const runtime = harnessRuntime()
  if (!runtime || !/^(?:\/)?(?:data|img|thumbs)\//.test(src)) return src
  return `${runtime.assetBase.replace(/\/+$/, '')}/${src.replace(/^\/+/, '')}`
}
/** Credential fields are never serialized into Harness state or portable backups. */
export function withoutSecrets<T>(value: T): T {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const hadCredentials = Boolean(url.username || url.password)
      url.username = ''; url.password = ''
      let changed = hadCredentials
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:key|api[_-]?key|authorization|password|access[_-]?token|refresh[_-]?token|token|secret)$/i.test(key)) { url.searchParams.delete(key); changed = true }
      }
      if (changed) { url.hash = ''; return url.href as T }
    } catch { /* not a URL */ }
  }
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try { return JSON.stringify(withoutSecrets(JSON.parse(value))) as T } catch { /* ordinary text */ }
  }
  if (Array.isArray(value)) return value.map(withoutSecrets) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(?:api[_-]?key|authorization|password|access[_-]?token|refresh[_-]?token|secret|__proto__|constructor|prototype)$/i.test(key)
  ).map(([key, item]) => [key, withoutSecrets(item)])) as T
}
export const persistedValue = <T,>(value: T): T => (isHarness() || isAndroidStudio()) ? withoutSecrets(value) : value

/** Keep provider credentials distinct from the host's own admission Authorization. */
export function transportHeaders(input?: HeadersInit): Headers {
  const headers = new Headers(input)
  if (!isHarness()) return headers
  for (const [source, destination] of [['authorization', 'x-studio-authorization'], ['x-goog-api-key', 'x-studio-goog-api-key']]) {
    const value = headers.get(source)
    headers.delete(source)
    headers.delete(destination)
    if (value) headers.set(destination, value)
  }
  return headers
}

