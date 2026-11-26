import assert from 'node:assert/strict'
import test from 'node:test'
import { createAndroidPromptDraft } from '../src/lib/androidPromptDraft.ts'

test('typing updates the immediate prompt snapshot and only notifies its subscribers', () => {
  const draft = createAndroidPromptDraft()
  const independent = createAndroidPromptDraft()
  const updates = []
  const unsubscribe = draft.subscribe(() => updates.push(draft.read()))
  draft.set('中文 ab')
  draft.set('中文 a')
  draft.set('中文 a')
  draft.set('')
  assert.equal(draft.read(), '', 'empty custom text is different from automatic prompt')
  assert.equal(independent.read(), null)
  draft.set(null)
  assert.deepEqual(updates, ['中文 ab', '中文 a', '', null])
  unsubscribe()
  draft.set('restored')
  assert.equal(draft.read(), 'restored')
  assert.equal(updates.length, 4)
})
