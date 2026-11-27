import test from 'node:test'
import assert from 'node:assert/strict'
import { androidAlbumKey, createAndroidAlbumMarks } from '../src/lib/androidAlbumMarks.ts'

const image = (id, createdAt = 10) => androidAlbumKey({ id, createdAt })
test('album marks are isolated per generation and persist across store recreation', () => {
  let value = null
  const storage = () => ({ getItem: () => value, setItem: (_, v) => { value = v } })
  const marks = createAndroidAlbumMarks(storage)
  let notices = 0
  const close = marks.subscribe(() => ++notices)
  assert.equal(marks.has(image('x')), false)
  marks.mark(image('x'))
  marks.mark(image('x'))
  assert.equal(notices, 1)
  assert.equal(createAndroidAlbumMarks(storage).has(image('x')), true)
  assert.equal(marks.has(image('x', 11)), false)
  assert.equal(marks.has(image('y')), false)
  close()
  marks.mark(image('y'))
  assert.equal(notices, 1)
})
test('damaged or inaccessible storage never fabricates success', () => {
  const missing = createAndroidAlbumMarks(() => { throw new Error('not available') })
  assert.equal(missing.has(image('x')), false)
  missing.mark(undefined)
  missing.mark(image('x'))
  assert.equal(missing.has(image('x')), true)
  const corrupted = createAndroidAlbumMarks(() => ({ getItem: () => '{' }))
  assert.equal(corrupted.has(image('x')), false)
})
