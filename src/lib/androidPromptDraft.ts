/** Keep Android keystrokes out of the shared Studio context. */
export function createAndroidPromptDraft() {
  let value: string | null = null
  const listeners = new Set<() => void>()
  return {
    read: () => value,
    set(next: string | null) {
      if (Object.is(value, next)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
