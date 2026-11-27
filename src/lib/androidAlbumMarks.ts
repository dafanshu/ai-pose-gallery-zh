const STORAGE_KEY = 'android-personal:album-save-marks:v1'
const MAX_MARKS = 256
type MarkStorage = Pick<Storage, 'getItem' | 'setItem'>

export function androidAlbumKey(item?: { id: string; createdAt: number }): string | undefined {
  if (!item || !item.id || !Number.isFinite(item.createdAt)) return undefined
  return JSON.stringify([item.id, item.createdAt])
}

export function createAndroidAlbumMarks(storage: () => MarkStorage) {
  let saved: Set<string> | undefined
  const listeners = new Set<() => void>()
  function load() {
    if (!saved) {
      saved = new Set()
      try {
        const raw: unknown = JSON.parse(storage().getItem(STORAGE_KEY) ?? '[]')
        if (Array.isArray(raw)) for (const key of raw.slice(-MAX_MARKS)) {
          if (typeof key === 'string' && key.length <= 512) saved.add(key)
        }
      } catch { /* Storage unavailable; continue marking in this session. */ }
    }
    return saved
  }
  return {
    has: (key?: string) => Boolean(key && load().has(key)),
    mark(key?: string) {
      if (!key || key.length > 512) return
      const marks = load()
      const wasSaved = marks.delete(key)
      marks.add(key)
      if (marks.size > MAX_MARKS) marks.delete(marks.values().next().value!)
      try { storage().setItem(STORAGE_KEY, JSON.stringify([...marks])) } catch { /* In-session status is still accurate. */ }
      if (!wasSaved) for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const androidAlbumMarks = createAndroidAlbumMarks(() => window.localStorage)
