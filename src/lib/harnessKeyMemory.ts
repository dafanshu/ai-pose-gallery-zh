import { isHarness } from './runtime'
import type { ApiConfig } from '@/types/gallery'

let epoch: number | undefined
const pendingEdits: Record<string, string> = {}
const CHANNEL = 'pose-studio-memory-v1'
/** Preserve explicit user edits made before the asynchronous initial handshake arrives. */
export function noteHarnessKeyEdit(provider: string, value: string) {
  if (!isHarness() || window.parent === window || epoch !== undefined) return
  if (['gemini', 'gpt', 'qwen', 'doubao', 'comfyui'].includes(provider) && value.length <= 16384) pendingEdits[provider] = value
}
/** Root-client memory only. This same-origin bridge is not an isolation boundary. */
export function connectHarnessKeyMemory(receive: (keys: Record<string, string>) => void) {
  if (!isHarness() || window.parent === window) return () => {}
  epoch = undefined
  for (const id of Object.keys(pendingEdits)) delete pendingEdits[id]
  const listener = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.channel !== CHANNEL || event.data.op !== 'state') return
    const incoming = event.data.epoch
    // A repeated get reply is a snapshot, not a new clear. It must not undo edits
    // made since the first reply (including StrictMode's duplicate handshake).
    if (!Number.isSafeInteger(incoming) || incoming < 0 || (epoch !== undefined && incoming <= epoch)) return
    const keys: Record<string, string> = {}
    for (const id of ['gemini', 'gpt', 'qwen', 'doubao', 'comfyui']) {
      const value = event.data.keys?.[id] ?? ''
      if (typeof value !== 'string' || value.length > 16384) return
      keys[id] = value
    }
    if (epoch === undefined && event.data.cleared !== true) Object.assign(keys, pendingEdits)
    for (const id of Object.keys(pendingEdits)) delete pendingEdits[id]
    epoch = incoming
    receive(keys)
  }
  window.addEventListener('message', listener)
  window.parent.postMessage({ channel: CHANNEL, op: 'get' }, window.location.origin)
  return () => {
    window.removeEventListener('message', listener)
    epoch = undefined
    for (const id of Object.keys(pendingEdits)) delete pendingEdits[id]
  }
}
export function rememberHarnessKeys(config: ApiConfig) {
  if (!isHarness() || window.parent === window || epoch === undefined) return
  const keys = Object.fromEntries(Object.entries(config.providers).map(([id, value]) => [id, value.apiKey]))
  window.parent.postMessage({ channel: CHANNEL, op: 'set', keys, epoch }, window.location.origin)
}
