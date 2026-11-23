import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_API_CONFIG } from '../src/store/apiConfig.ts'
import { generateCharacterImage } from '../src/services/aiGenerator.ts'

const latest = 'doubao-seedream-5-5-261028'
const reference = { id: 'ref', name: 'Ref', url: 'data:image/png;base64,aGVsbG8=' }
const recipe = { portrait: null, costume: null, pose: null, extraImages: [reference] }
function configFor(model) {
  const config = structuredClone(DEFAULT_API_CONFIG)
  config.activeProvider = 'doubao'
  config.providers.doubao.apiKey = 'fixture-only'
  config.providers.doubao.model = model
  config.useProxy = false
  config.sendStitchedSheet = false
  return config
}

test('Ark single-image families omit sequential field; legacy group generation retains it', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] })
  })
  const single = [latest, 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915']
  for (const model of [...single, 'doubao-seedream-4-5-251128']) {
    const config = configFor(model)
    const before = structuredClone(config)
    const result = await generateCharacterImage({ recipe, prompt: 'fixture', config })
    assert.equal(result.modelUsed, model)
    assert.deepEqual(config, before)
    const request = calls.at(-1)
    assert.equal(request.url, 'https://ark.cn-beijing.volces.com/api/v3/images/generations')
    assert.equal(request.body.model, model)
    assert.equal(request.body.image.length, 1)
    assert.equal(request.body.sequential_image_generation, single.includes(model) ? undefined : 'disabled')
  }
})

test('Ark 5.5 rejects unsupported group mode, 4K and excess references before fetching', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected request') })
  const config = configFor(latest)
  config.doubaoParams.sequentialImageGeneration = 'auto'
  await assert.rejects(generateCharacterImage({ recipe, prompt: 'fixture', config }), /不支持组图/)
  config.doubaoParams.sequentialImageGeneration = 'disabled'
  for (const model of [latest, 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915']) {
    const config = configFor(model)
    config.doubaoParams.size = '4K'
    await assert.rejects(generateCharacterImage({ recipe, prompt: 'fixture', config }), /不支持 4K/)
  }
  config.doubaoParams.size = '2K'
  config.sendStitchedSheet = true
  await assert.rejects(generateCharacterImage({ recipe: { ...recipe, extraImages: Array(10).fill(reference) }, prompt: 'fixture', config }), /最多支持 10 张参考图/)
  assert.equal(fetch.mock.callCount(), 0)
})
