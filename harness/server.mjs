import { HARNESS_TARGET, HARNESS_SOURCE } from './compatibility.mjs'
/** Node-only host transport. No model prompts, API keys or responses are persisted. */
import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns'
import { realpath, readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE = '/api/ai-pose-studio'
export const DEFAULT_ORIGINS = [
  'https://api.openai.com', 'https://generativelanguage.googleapis.com',
  'https://dashscope.aliyuncs.com', 'https://ark.cn-beijing.volces.com',
]
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8', '.csv':'text/csv; charset=utf-8' }
const ASSET_PREFIXES = ['data/', 'img/', 'thumbs/']
const BODY_LIMIT = 32 * 1024 * 1024
const RESPONSE_LIMIT = 80 * 1024 * 1024
const getHeader = (req, name) => typeof req.headers[name] === 'string' ? req.headers[name] : ''

export function configuration(raw = {}) {
  const allowedOrigins = new Set(DEFAULT_ORIGINS)
  if (raw.allowedProviderOrigins !== undefined && !Array.isArray(raw.allowedProviderOrigins)) throw new Error('allowedProviderOrigins must be an array')
  for (const value of raw.allowedProviderOrigins || []) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) throw new Error('Provider origin must be an exact HTTPS origin')
    allowedOrigins.add(url.origin)
  }
  const comfyUrl = new URL(raw.comfyUrl || 'http://127.0.0.1:8000')
  if (!['http:', 'https:'].includes(comfyUrl.protocol) || comfyUrl.username || comfyUrl.password || comfyUrl.search || comfyUrl.hash) throw new Error('Invalid fixed ComfyUI URL')
  return {
    assetRoot: path.resolve(raw.assetRoot || fileURLToPath(new URL('../', import.meta.url))),
    appRoot: path.resolve(fileURLToPath(new URL('./app/', import.meta.url))),
    allowedOrigins, comfyUrl,
    timeoutMs: Math.min(900000, Math.max(1000, Number(raw.timeoutMs) || 600000)),
    maxConcurrent: Math.min(16, Math.max(1, Math.trunc(Number(raw.maxConcurrent) || 4))),
  }
}

export function reject(res, status, message) {
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...([408,413].includes(status) ? {connection:'close'} : {}) })
  res.end(JSON.stringify({ error: { message } }))
}

/** Require the actual host's admitted owner, never just an authenticated non-owner API peer. */
export function admission(connection, req) {
  try {
    if (typeof connection?.admit !== 'function') return 503
    const result = connection.admit(req)
    if (result && 'rejection' in result) return result.rejection === 401 ? 401 : 403
    return result?.peer?.principal?.kind === 'owner' ? undefined : 403
  } catch { return 503 }
}

export function sameOrigin(req) {
  if (getHeader(req, 'sec-fetch-site') === 'cross-site') return false
  const origin = getHeader(req, 'origin')
  if (!origin) return true // authenticated native/API owner; browser POST normally supplies Origin
  try { return new URL(origin).host === getHeader(req, 'host') && ['http:', 'https:'].includes(new URL(origin).protocol) } catch { return false }
}

export function safeRelative(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid path')
  const decoded = decodeURIComponent(raw)
  if (!decoded || decoded.includes('\\') || decoded.includes('\0') || decoded.includes('%') || decoded.startsWith('/') || decoded.split('/').some(x => x === '..' || x === '.' || x.startsWith('.'))) throw new Error('Invalid path')
  return decoded
}

export async function resolveFile(root, relative) {
  const clean = safeRelative(relative)
  const [base, candidate] = await Promise.all([realpath(root), realpath(path.join(root, clean))])
  const rel = path.relative(base, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path outside configured root')
  if (!(await stat(candidate)).isFile()) throw new Error('Not a file')
  return candidate
}

/** Public-provider DNS is checked at connect time to block rebinding and private-network relays. */
export function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    const [a,b] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)))
  }
  if (family === 6) {
    const value = address.toLowerCase()
    // Global unicast only, excluding documentation; IPv4-mapped/transition/local ranges rejected.
    return /^[23][0-9a-f]{0,3}:/.test(value) && !value.startsWith('2001:db8:') && !value.startsWith('2002:') && !value.startsWith('2001:0:')
  }
  return false
}

function publicLookup(hostname, options, callback) {
  lookup(hostname, { all:true, verbatim:true }, (err, entries) => {
    if (err) return callback(err)
    if (!entries.length || entries.some(x => !isPublicAddress(x.address))) return callback(new Error('Provider DNS is not public'))
    if (options?.all) callback(null, entries)
    else callback(null, entries[0].address, entries[0].family)
  })
}

export function providerTarget(raw, method, config) {
  const target = new URL(raw)
  if (target.protocol !== 'https:' || target.username || target.password || target.hash || !config.allowedOrigins.has(target.origin)) throw new Error('Provider origin not allowed; add an exact HTTPS origin in the host plugin configuration')
  if (isIP(target.hostname.replace(/^\[|\]$/g,'')) && !isPublicAddress(target.hostname.replace(/^\[|\]$/g,''))) throw new Error('Private provider address rejected')
  if (method === 'GET') {
    if (!target.pathname.endsWith('/v1/models') || target.search) throw new Error('GET is only for model discovery')
  } else if (method === 'POST') {
    if (!/(?:\/images\/(?:edits|generations)|\/responses|\/chat\/completions|\/models\/[^/]+:generateContent|\/services\/aigc\/multimodal-generation\/generation)$/.test(target.pathname)) throw new Error('Unsupported generation endpoint')
  } else throw new Error('Unsupported method')
  return target
}

export function comfyTarget(rawPath, method, config) {
  const u = new URL(rawPath, 'http://internal.invalid')
  if (/%2f|%5c|%2e/i.test(rawPath) || u.pathname.includes('\\')) throw new Error('Invalid ComfyUI path')
  const rel = u.pathname.slice((BASE + '/comfy').length)
  const reads = /^(?:\/system_stats|\/object_info(?:\/[^/]+)?|\/queue|\/history(?:\/[A-Za-z0-9_-]+)?|\/view)$/
  const writes = /^(?:\/prompt|\/upload\/image|\/queue|\/interrupt)$/
  if (!(method === 'GET' ? reads : method === 'POST' ? writes : /$a/).test(rel)) throw new Error('Unsupported ComfyUI operation')
  const target = new URL(config.comfyUrl.href)
  target.pathname = `${target.pathname.replace(/\/$/, '')}${rel}`
  target.search = u.search
  return target
}

async function readBody(req) {
  const declared = Number(getHeader(req, 'content-length'))
  if (declared > BODY_LIMIT) throw Object.assign(new Error('Request body exceeds 32 MiB'), { status:413 })
  const chunks = []; let size = 0
  return await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted) }
    const fail = error => { cleanup(); req.pause(); reject(error) }
    const data = chunk => {
      size += chunk.length
      if (size > BODY_LIMIT) return fail(Object.assign(new Error('Request body exceeds 32 MiB'), {status:413}))
      chunks.push(chunk)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    const aborted = () => fail(Object.assign(new Error('Upload aborted'), {status:400}))
    const timer = setTimeout(() => fail(Object.assign(new Error('Upload exceeded 30 seconds'), {status:408})), 30000)
    req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', aborted)
  })
}

/** No cookie, host token, forwarding headers, Location or Set-Cookie crosses this relay. */
export async function relay(req, res, target, config, local = false) {
  if (req.method === 'POST' && !/^(application\/json|multipart\/form-data)(?:;|$)/i.test(getHeader(req, 'content-type'))) return reject(res, 415, 'Expected JSON or multipart form data')
  const body = req.method === 'POST' ? await readBody(req) : undefined
  const headers = {}
  for (const key of ['content-type', 'x-dashscope-async']) {
    const value = getHeader(req, key); if (value) headers[key] = value
  }
  for (const [incoming,outgoing] of [['x-studio-authorization','authorization'], ['x-studio-goog-api-key','x-goog-api-key']]) {
    const value = getHeader(req,incoming); if (value) headers[outgoing] = value
  }
  if (body) headers['content-length'] = String(body.length)
  const transport = target.protocol === 'https:' ? https : http
  await new Promise((resolve) => {
    let settled = false; let timer
    const done = () => { if (!settled) { settled = true; clearTimeout(timer); res.off('close', onClose); resolve() } }
    const upstream = transport.request(target, { method:req.method, headers, ...(local ? {} : { lookup:publicLookup }) }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.destroy(); reject(res, 502, 'Upstream redirects are blocked'); done(); return }
      res.writeHead(response.statusCode || 502, { 'content-type':response.headers['content-type'] || 'application/json', 'cache-control':'no-store', 'x-content-type-options':'nosniff' })
      let received = 0
      response.on('data', chunk => {
        received += chunk.length
        if (received > RESPONSE_LIMIT) { response.destroy(); upstream.destroy(); res.destroy(); done(); return }
        if (!res.write(chunk)) { response.pause(); res.once('drain', () => response.resume()) }
      })
      response.on('end', () => { res.end(); done() })
      response.on('error', () => { res.destroy(); done() })
    })
    const onClose = () => { upstream.destroy(); done() }
    res.on('close', onClose)
    upstream.on('error', () => { reject(res, 502, 'Upstream request failed; verify the endpoint, credentials and service'); done() })
    timer = setTimeout(() => { upstream.destroy(); reject(res, 504, 'Upstream request timed out'); done() }, config.timeoutMs)
    upstream.end(body)
  })
}

async function staticFile(req, res, root, relative, runtime) {
  if (!['GET','HEAD'].includes(req.method)) return reject(res, 405, 'Read-only resource')
  let file
  try { file = await resolveFile(root, relative) } catch { return reject(res, 404, 'File not found; configure assetRoot to the existing full gallery checkout') }
  const type = MIME[path.extname(file)]
  if (!type) return reject(res, 403, 'File type not served')
  let bytes = await readFile(file)
  const headers = { 'content-type':type, 'cache-control':'private, no-cache', 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer', 'x-frame-options':'SAMEORIGIN' }
  if (runtime) {
    const nonce = randomBytes(18).toString('base64')
    const data = JSON.stringify(runtime).replace(/</g,'\\u003c')
    bytes = Buffer.from(bytes.toString('utf8').replace(/<head>/i, `<head><script nonce="${nonce}">window.__POSE_HARNESS__=${data};</script>`))
    headers['content-security-policy'] = `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'none'; object-src 'none'`
  }
  headers['content-length'] = String(bytes.length)
  res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : bytes)
}

export function createHandler(config, connection, capabilities = {}) {
  let active = 0
  return async (req,res) => {
    const denied = admission(connection, req)
    if (denied !== undefined) return reject(res, denied, denied === 503 ? `Requires Harness ${HARNESS_TARGET} owner admission; unsupported hosts fail closed` : 'Host admission required')
    if (!sameOrigin(req)) return reject(res, 403, 'Cross-origin request rejected')
    let url
    try { url = new URL(req.url, 'http://internal.invalid') } catch { return reject(res,400,'Invalid URL') }
    const route = url.pathname
    const runtime = { basePath:BASE, assetBase:BASE+'/assets', proxyUrl:BASE+'/proxy', comfyBase:BASE+'/comfy', storageNamespace:'ai-pose-harness-v1', comfyWebSocket:capabilities.comfyWebSocket === true }
    if (route === BASE + '/health') {
      if (req.method !== 'GET') return reject(res,405,'Read only')
      const appBuilt = await stat(path.join(config.appRoot,'index.html')).then(s=>s.isFile()).catch(()=>false)
      const catalogs = await Promise.all(['pose-zh.json','portrait-zh.json','costume-zh.json','costume-anime-zh.json','costume-gia-anime-zh.json','costume-shisei-zh.json'].map(async name=>({ name, present:await stat(path.join(config.assetRoot,'data',name)).then(s=>s.isFile()).catch(()=>false) })))
      res.writeHead(200, { 'content-type':'application/json', 'cache-control':'no-store' }); res.end(JSON.stringify({ version:1, compatibilityTarget:HARNESS_TARGET, contractSource:HARNESS_SOURCE, appBuilt, catalogs, webSocket:runtime.comfyWebSocket, keys:'browser-memory-only', data:'browser-local-per-Harness-origin' })); return
    }
    if (route === BASE + '/app' || route === BASE + '/app/') return staticFile(req,res,config.appRoot,'index.html',runtime)
    if (route.startsWith(BASE + '/app/')) return staticFile(req,res,config.appRoot,route.slice((BASE+'/app/').length))
    if (route.startsWith(BASE + '/assets/')) {
      let rel
      try { rel = safeRelative(route.slice((BASE+'/assets/').length)) } catch { return reject(res,400,'Invalid asset path') }
      if (!ASSET_PREFIXES.some(p=>rel.startsWith(p))) return reject(res,403,'Only gallery data and image directories are served')
      if (!/\.(?:json|csv|png|jpe?g|webp|gif)$/i.test(rel)) return reject(res,403,'Unsupported gallery asset')
      return staticFile(req,res,config.assetRoot,rel)
    }
    if (route !== BASE+'/proxy' && !route.startsWith(BASE+'/comfy/')) return reject(res,404,'Unknown studio route')
    if (active >= config.maxConcurrent) return reject(res,429,'Too many concurrent studio requests')
    active++
    try {
      const local = route.startsWith(BASE+'/comfy/')
      const target = local ? comfyTarget(req.url,req.method,config) : providerTarget(getHeader(req,'x-target-url'),req.method,config)
      await relay(req,res,target,config,local)
    } catch (error) { reject(res,error.status || 400,error.status ? error.message : 'Invalid or disallowed upstream request') }
    finally { active-- }
  }
}

/** Fixed-origin websocket tunnel preserves live ComfyUI progress without exposing a general proxy. */
export function createUpgrade(config, connection) {
  const sockets = new Set()
  const handler = (req, socket, head) => {
    const denied = admission(connection,req)
    if (denied !== undefined || !sameOrigin(req)) { socket.end(`HTTP/1.1 ${denied || 403} Forbidden\r\nConnection: close\r\n\r\n`); return }
    sockets.add(socket); socket.once('close',()=>sockets.delete(socket))
    const incoming = new URL(req.url,'http://internal.invalid')
    if (req.method !== 'GET' || getHeader(req,'upgrade').toLowerCase() !== 'websocket' || [...incoming.searchParams.keys()].some(k=>k!=='clientId')) { socket.destroy(); return }
    const target = new URL(config.comfyUrl.href)
    target.pathname = target.pathname.replace(/\/$/,'')+'/ws'; target.search = incoming.search
    const headers = { connection:'Upgrade', upgrade:'websocket' }
    for (const key of ['sec-websocket-key','sec-websocket-version','sec-websocket-protocol']) if (getHeader(req,key)) headers[key]=getHeader(req,key)
    const upstream = (target.protocol==='https:' ? https : http).request(target,{headers})
    const timeout = setTimeout(()=>{ upstream.destroy(); socket.destroy() },15000)
    upstream.on('upgrade',(response,remote,extra)=>{
      clearTimeout(timeout)
      const lines = ['HTTP/1.1 101 Switching Protocols']
      for (const key of ['connection','upgrade','sec-websocket-accept','sec-websocket-protocol']) if (typeof response.headers[key]==='string') lines.push(`${key}: ${response.headers[key]}`)
      socket.write(lines.join('\r\n')+'\r\n\r\n')
      if (head.length) remote.write(head)
      if (extra.length) socket.write(extra)
      remote.on('error',()=>socket.destroy()); socket.on('error',()=>remote.destroy())
      remote.on('close',()=>socket.destroy()); socket.on('close',()=>remote.destroy())
      socket.pipe(remote); remote.pipe(socket)
    })
    upstream.on('response', response=>{ response.resume(); socket.destroy(); clearTimeout(timeout) })
    upstream.on('error',()=>{ socket.destroy(); clearTimeout(timeout) })
    socket.on('close',()=>{ upstream.destroy(); clearTimeout(timeout) })
    upstream.end()
  }
  handler.dispose = () => { for (const socket of sockets) socket.destroy(); sockets.clear() }
  return handler
}
