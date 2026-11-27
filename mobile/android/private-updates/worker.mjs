const MAX_VERSION = 2_100_000_000
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

async function authorized(request, expected) {
  const bearer = request.headers.get('Authorization')
  if (!bearer || !/^Bearer [a-f0-9]{64}$/.test(bearer) || !/^[a-f0-9]{64}$/.test(expected ?? '')) return false
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer.slice(7))))
  let different = 0
  for (let i = 0; i < bytes.length; i++) different |= bytes[i] ^ Number.parseInt(expected.slice(2 * i, 2 * i + 2), 16)
  return different === 0
}

export default {
  async fetch(request, env) {
    if (!(await authorized(request, env.UPDATE_READER_SHA256))) return new Response(null, { status: 401, headers })
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } })
    const url = new URL(request.url)
    if (url.search) return new Response(null, { status: 404, headers })
    try {
      if (url.pathname === '/v1/latest.json') {
        // Inverted version in the key: smaller key = newer version. Do not rely on list ordering.
        let first, cursor
        for (let page = 0; ; page++) {
          if (page >= 100) throw new Error('manifest listing limit')
          const result = await env.UPDATES.list({ prefix: 'manifests/', limit: 1000, cursor })
          for (const item of result.objects) {
            if (/^manifests\/[0-9]{10}\.json$/.test(item.key) && (!first || item.key < first.key)) first = item
          }
          if (!result.truncated) break
          if (!result.cursor || result.cursor === cursor) throw new Error('invalid manifest cursor')
          cursor = result.cursor
        }
        const object = first && await env.UPDATES.get(first.key)
        if (!object) return new Response(null, { status: 404, headers })
        return new Response(object.body, { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } })
      }
      const match = /^\/v1\/apk\/([1-9][0-9]{0,9})\/([a-f0-9]{64})$/.exec(url.pathname)
      if (!match || Number(match[1]) > MAX_VERSION) return new Response(null, { status: 404, headers })
      const object = await env.UPDATES.get(`apks/${match[1]}/${match[2]}.apk`)
      if (!object) return new Response(null, { status: 404, headers })
      return new Response(object.body, { headers: { ...headers,
        'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': String(object.size),
      } })
    } catch {
      return new Response(null, { status: 503, headers })
    }
  },
}
