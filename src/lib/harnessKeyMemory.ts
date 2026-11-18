import { isHarness } from './runtime'
import type { ApiConfig } from '@/types/gallery'

const CHANNEL = 'pose-studio-memory-v1'
/** Root-client memory only. This same-origin bridge is not an isolation boundary. */
export function connectHarnessKeyMemory(receive: (keys: Record<string, string>) => void) {
  if (!isHarness() || window.parent === window) return () => {}
  const listener = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.channel !== CHANNEL || event.data.op !== 'state') return
    const keys: Record<string, string> = {}
    for (const id of ['gemini', 'gpt', 'qwen', 'doubao', 'comfyui']) {
      const value = event.data.keys?.[id] ?? ''
      if (typeof value !== 'string' || value.length > 16384) return
      keys[id] = value
    }
    receive(keys)
  }
  window.addEventListener('message', listener)
  window.parent.postMessage({ channel: CHANNEL, op: 'get' }, window.location.origin)
  return () => window.removeEventListener('message', listener)
}
export function rememberHarnessKeys(config: ApiConfig) {
  if (!isHarness() || window.parent === window) return
  const keys = Object.fromEntries(Object.entries(config.providers).map(([id, value]) => [id, value.apiKey]))
  window.parent.postMessage({ channel: CHANNEL, op: 'set', keys }, window.location.origin)
}
