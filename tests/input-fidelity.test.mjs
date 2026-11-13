import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateCharacterImage } from '../src/services/aiGenerator.ts'

const image = 'data:image/png;base64,iVBORw0KGgo='
const recipe = { portrait: null, costume: null, pose: null, extraImages: [{ id: 'reference', name: 'Reference', url: image }] }
const modes = ['images_edits_json', 'images_edits', 'responses']

function configFor(endpointMode, inputFidelity, useProxy = false) {
  return {
    activeProvider: 'gpt',
    imagePassMode: 'url',
    sendStitchedSheet: false,
    useProxy,
    providers: { gpt: { baseUrl: 'https://example.invalid/v1', apiKey: 'test-only', model: 'custom', customModel: 'test-model' } },
    gptParams: { endpointMode, size: '1024x1536', quality: 'high', inputFidelity, background: 'auto', outputFormat: 'png', moderation: 'auto' },
  }
}

async function captureRequest(t, config) {
  const requests = []
  const mock = t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, ...init })
    return Response.json(config.gptParams.endpointMode === 'responses'
      ? { output: [{ type: 'image_generation_call', result: 'generated' }] }
      : { data: [{ b64_json: 'generated' }] })
  })
  try {
    const result = await generateCharacterImage({ recipe, prompt: 'Test prompt', config })
    assert.equal(result.imageUrl, 'data:image/png;base64,generated')
    assert.equal(result.modelUsed, 'test-model')
    assert.equal(requests.length, 1)
    return requests[0]
  } finally {
    mock.mock.restore()
  }
}

function requestFields(request, endpointMode) {
  if (endpointMode === 'images_edits') return Object.fromEntries(request.body)
  const payload = JSON.parse(request.body)
  return endpointMode === 'responses' ? payload.tools[0] : payload
}

for (const mode of modes) {
  for (const useProxy of [false, true]) {
    for (const value of ['omit', 'high', 'low', undefined, null, '', 'unknown']) {
      test(`${mode}: ${String(value)} (${useProxy ? 'proxy' : 'direct'})`, async (t) => {
        // Exercise the same JSON round-trip as saved/imported settings.
        const config = JSON.parse(JSON.stringify(configFor(mode, value, useProxy)))
        const request = await captureRequest(t, config)
        const fields = requestFields(request, mode)
        const expected = value === 'high' || value === 'low' ? value : undefined
        assert.equal(Object.hasOwn(fields, 'input_fidelity'), expected !== undefined)
        assert.equal(fields.input_fidelity, expected)
        assert.equal(fields.quality, 'high')
        assert.equal(fields.size, '1024x1536')
        assert.equal(fields.output_format, 'png')
        const target = `https://example.invalid/v1/${mode === 'responses' ? 'responses' : 'images/edits'}`
        assert.equal(request.url, useProxy ? '/api/proxy' : target)
        assert.equal(new Headers(request.headers).get('Authorization'), 'Bearer test-only')
        if (useProxy) assert.equal(new Headers(request.headers).get('x-target-url'), target)
        if (mode === 'images_edits') {
          assert.ok(request.body.get('image[]') instanceof Blob)
          assert.equal(new Headers(request.headers).has('Content-Type'), false)
        }
      })
    }
  }

  test(`${mode}: saved high → compatibility → low → compatibility`, async (t) => {
    let config = configFor(mode, 'high')
    for (const value of ['high', 'omit', 'low', 'omit']) {
      config = JSON.parse(JSON.stringify({ ...config, gptParams: { ...config.gptParams, inputFidelity: value } }))
      const fields = requestFields(await captureRequest(t, config), mode)
      assert.equal(Object.hasOwn(fields, 'input_fidelity'), value !== 'omit')
      assert.equal(fields.input_fidelity, value === 'omit' ? undefined : value)
    }
  })
}

test('chat completions remains unchanged and never sends input_fidelity', async (t) => {
  for (const value of ['omit', 'high', 'low']) {
    const request = await captureRequest(t, configFor('chat', value))
    const payload = JSON.parse(request.body)
    assert.equal(Object.hasOwn(payload, 'input_fidelity'), false)
    assert.equal(request.url, 'https://example.invalid/v1/chat/completions')
    assert.deepEqual(payload.modalities, ['text', 'image'])
  }
})
