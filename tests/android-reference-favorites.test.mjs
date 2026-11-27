import assert from 'node:assert/strict'
import test from 'node:test'
import { addReferenceFavorite, favoriteImage, favoriteLabel, referenceFavorite, referenceFavoritesKey, restoreExtraFavorite } from '../src/lib/androidReferenceFavorites.ts'
import { uploadedReferences } from '../src/lib/recipeImages.ts'

const photo = 'data:image/png;base64,YQ=='
const recipe = uploadedReferences('我的素材', photo, 1, 1, 1)

test('reference favorites keep slots separate, accept only offline images and avoid duplicate photos', () => {
  const portrait = referenceFavorite('portrait',recipe)
  const costume = referenceFavorite('costume',recipe)
  assert.notEqual(referenceFavoritesKey('portrait'),referenceFavoritesKey('costume'))
  assert.equal(referenceFavorite('portrait',{...recipe,portrait:null}),null)
  const existing = addReferenceFavorite([],portrait)
  assert.deepEqual(existing,[portrait])
  assert.equal(addReferenceFavorite(existing,{...portrait,item:{...portrait.item,id:'repeat'}}),existing)
  assert.equal(addReferenceFavorite(existing,{...portrait,item:{...portrait.item,原图:'https://example.com/private.png'}}),existing)
  assert.deepEqual(addReferenceFavorite([],costume),[costume])
})

test('pose favorites retain the selected angle and independent views', () => {
  const source = referenceFavorite('pose',{...recipe,pose:{...recipe.pose,角度:'侧面'}})
  const alternate = {...source,item:{...source.item,角度:'正面'}}
  const entries = addReferenceFavorite([source],alternate)
  assert.equal(entries.length,2)
  assert.equal(favoriteLabel(source),'我的素材 · 侧面')
  assert.equal(favoriteImage(source),photo)
})

test('supplemental favorite variants preserve crop and rules without taking another image’s body override', () => {
  const item = {id:'draft', name:'侧光', url:photo, cropUrl:'data:image/png;base64,Yg==',
    useFeatures:'暖侧光', excludeFeatures:'服饰', bodyOverrides:['legThickness','hipWidth']}
  const entry = {slot:'extra',item}
  const existing = addReferenceFavorite([],entry)
  assert.equal(favoriteImage(entry),item.cropUrl)
  assert.equal(addReferenceFavorite(existing,{...entry,item:{...item,id:'newDraft'}}),existing)
  assert.equal(addReferenceFavorite(existing,{...entry,item:{...item,useFeatures:'冷侧光'}}).length,2)
  assert.equal(addReferenceFavorite(existing,{...entry,item:{...item,url:'https://example.com/private.png'}}),existing)
  const restored = restoreExtraFavorite(item,[{id:'other', name:'另一张', url:photo, bodyOverrides:['legThickness']}])
  const {id,...metadata} = item
  assert.deepEqual(restored,{image:{...metadata,bodyOverrides:['hipWidth']},keptExistingBodySource:true})
  assert.deepEqual(restoreExtraFavorite(item,[]),{image:metadata,keptExistingBodySource:false})
})
