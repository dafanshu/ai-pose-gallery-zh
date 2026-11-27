import test from 'node:test'
import assert from 'node:assert/strict'
import { captionIndex } from '../src/lib/androidCaptionSource.ts'

test('caption catalog includes only local still images, preserves prompt and order, and carries no original or credential', () => {
  const a = {id:'a',createdAt:8,imageUrl:'data:image/png;base64,iVBORw0=',recipeSummary:'旗袍',prompt:'actual',
    snapshot:{recipe:{costume:{服装名称:'素旗袍'}},settings:{stylePreset:'国风'}}}
  const b = {...a,id:'b',createdAt:17,imageUrl:'https://example.invalid/private'}
  const c = {...a,id:'c',createdAt:9}
  const result = captionIndex([a,b,c])
  assert.deepEqual(result.map(r=>r.id),['a','c'])
  assert.equal(result[0].prompt,'actual')
  assert.equal(result[0].costume,'素旗袍')
  assert.equal(result[0].version,'8')
  assert.equal(JSON.stringify(result).includes('data:image'),false)
  assert.equal('snapshot' in result[0],false)
})
