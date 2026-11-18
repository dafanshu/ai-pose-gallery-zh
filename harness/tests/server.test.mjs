import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { BASE, admission, configuration, createHandler, createUpgrade, safeRelative, resolveFile, providerTarget, comfyTarget, isPublicAddress, sameOrigin } from '../server.mjs'
import { apply } from '../index.mjs'
const owner = { admit: () => ({ peer:{ principal:{ kind:'owner' } } }) }
const config = configuration()
const req = (headers={}) => ({ headers, method:'GET' })

test('owner admission fails closed for absent/legacy/throwing service and non-owner peers',()=>{
  assert.equal(admission(undefined,req()),503)
  assert.equal(admission({requestRejection:()=>undefined},req()),503)
  assert.equal(admission({admit:()=>{throw Error()}},req()),503)
  assert.equal(admission({admit:()=>({rejection:401})},req()),401)
  assert.equal(admission({admit:()=>({peer:{principal:{kind:'agent'}}})},req()),403)
  assert.equal(admission(owner,req()),undefined)
})
test('origin fence rejects cross-site and null origins',()=>{
  assert.equal(sameOrigin(req({host:'localhost:3080',origin:'http://evil.test'})),false)
  assert.equal(sameOrigin(req({host:'localhost:3080',origin:'null'})),false)
  assert.equal(sameOrigin(req({'sec-fetch-site':'cross-site'})),false)
  assert.equal(sameOrigin(req({host:'localhost:3080',origin:'http://localhost:3080'})),true)
})
test('configuration disallows broad/insecure provider patterns',()=>{
  for(const origin of ['*','http://api.example.com','https://*.example.com','https://u:p@example.com','https://example.com/path']) assert.throws(()=>configuration({allowedProviderOrigins:[origin]}))
  assert.ok(configuration({allowedProviderOrigins:['https://api.example.com']}).allowedOrigins.has('https://api.example.com'))
})
test('provider paths restrict methods/origins and credentials',()=>{
  assert.equal(providerTarget('https://api.openai.com/v1/images/edits','POST',config).pathname,'/v1/images/edits')
  assert.equal(providerTarget('https://api.openai.com/v1/models','GET',config).pathname,'/v1/models')
  assert.equal(providerTarget('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent','POST',config).hostname,'generativelanguage.googleapis.com')
  for(const [url,method] of [['http://api.openai.com/v1/models','GET'],['https://evil.test/v1/models','GET'],['https://api.openai.com/v1/models?key=x','GET'],['https://u:p@api.openai.com/v1/models','GET'],['https://api.openai.com/v1/files','POST'],['https://api.openai.com/v1/images/edits','DELETE']]) assert.throws(()=>providerTarget(url,method,config))
})
test('public-provider address check blocks local, metadata, mapped IPv6 and reserved networks',()=>{
  for(const address of ['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fd00::1','2001:db8::1']) assert.equal(isPublicAddress(address),false,address)
  assert.equal(isPublicAddress('8.8.8.8'),true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'),true)
})
test('Comfy target cannot be selected by the browser and paths are constrained',()=>{
  assert.equal(comfyTarget(BASE+'/comfy/history/abc-123','GET',config).href,'http://127.0.0.1:8000/history/abc-123')
  assert.equal(comfyTarget(BASE+'/comfy/prompt','POST',config).pathname,'/prompt')
  for(const [p,m] of [['/system_stats','POST'],['/prompt','GET'],['/free','POST'],['/..%2fsecret','GET'],['/upload/image','DELETE']]) assert.throws(()=>comfyTarget(BASE+'/comfy'+p,m,config))
})
test('static path validation rejects traversal, dotfiles, double encoding, separators',()=>{
  for(const value of ['../secret','a/../secret','.env','%2e%2e/secret','data/%252e%252e/secret','a\\b','/absolute','a\0b']) assert.throws(()=>safeRelative(value))
  assert.equal(safeRelative('data/pose-zh.json'),'data/pose-zh.json')
})
test('static resolution confines symlinks and rejects directories',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'pose-path-'))
  try {
    await mkdir(path.join(root,'assets')); await writeFile(path.join(root,'secret.json'),'{}')
    await symlink(path.join(root,'secret.json'),path.join(root,'assets','escape.json'))
    await assert.rejects(resolveFile(path.join(root,'assets'),'escape.json'))
    await assert.rejects(resolveFile(root,'assets'))
    await writeFile(path.join(root,'assets','ok.json'),'{}')
    assert.equal(await resolveFile(path.join(root,'assets'),'ok.json'),path.join(root,'assets','ok.json'))
  } finally { await rm(root,{recursive:true,force:true}) }
})
async function serve(handler) {
  const server=createServer((q,s)=>Promise.resolve(handler(q,s)).catch(e=>{s.statusCode=500;s.end(String(e))}))
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  return {server,url:`http://127.0.0.1:${server.address().port}`, close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
}
test('HTTP admission, build status, CSP runtime and data isolation',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'pose-route-'))
  const app=path.join(root,'app'); await mkdir(app); await mkdir(path.join(root,'data'))
  await writeFile(path.join(app,'index.html'),'<html><head></head><body>Studio</body></html>')
  await writeFile(path.join(root,'data','pose-zh.json'),'[]'); await writeFile(path.join(root,'.env'),'SECRET')
  const conf={...config,assetRoot:root,appRoot:app}
  const local=await serve(createHandler(conf,owner,{comfyWebSocket:true}))
  try {
    const health=await fetch(local.url+BASE+'/health').then(x=>x.json()); assert.equal(health.appBuilt,true);assert.equal(health.webSocket,true);assert.equal(health.compatibilityTarget,'0.2.2-rc.1');assert.equal(health.contractSource,'66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db')
    const page=await fetch(local.url+BASE+'/app/'); assert.equal(page.status,200); assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'self'/); assert.match(await page.text(),/window.__POSE_HARNESS__/)
    const workbench=await fetch(local.url+BASE+'/workbench.mjs')
    assert.equal(workbench.status,200);assert.match(workbench.headers.get('content-type'),/javascript/)
    assert.match(await workbench.text(),/createController/)
    assert.equal((await fetch(local.url+BASE+'/workbench.mjs',{method:'POST'})).status,405)
    assert.equal((await fetch(local.url+BASE+'/workbench.mjs',{headers:{origin:'https://evil.test'}})).status,403)
    assert.equal((await fetch(local.url+BASE+'/assets/data/pose-zh.json')).status,200)
    assert.equal((await fetch(local.url+BASE+'/assets/.env')).status,400)
    assert.equal((await fetch(local.url+BASE+'/health',{headers:{origin:'https://evil.test'}})).status,403)
    assert.equal((await fetch(local.url+BASE+'/app/',{method:'POST'})).status,405)
  }finally {await local.close();await rm(root,{recursive:true,force:true})}
  const unavailable=await serve(createHandler(conf,undefined));try{assert.equal((await fetch(unavailable.url+BASE+'/health')).status,503);assert.equal((await fetch(unavailable.url+BASE+'/workbench.mjs')).status,503)}finally{await unavailable.close()}
})
test('Comfy relay preserves body/type but strips cookies, host credentials and redirects',async()=>{
  const seen=[]
  const upstream=await serve(async(q,s)=>{
    const chunks=[];for await(const c of q) chunks.push(c);seen.push({url:q.url,headers:q.headers,body:Buffer.concat(chunks).toString()})
    if(q.url==='/queue'){s.writeHead(302,{location:'http://evil.test','set-cookie':'stolen=x'});s.end();return}
    s.writeHead(200,{'content-type':'application/json','set-cookie':'not-forwarded=x'});s.end(JSON.stringify({prompt_id:'mock-1'}))
  })
  const local=await serve(createHandler({...config,comfyUrl:new URL(upstream.url)},owner))
  try{
    const response=await fetch(local.url+BASE+'/comfy/prompt',{method:'POST',headers:{'content-type':'application/json',cookie:'host_session=PRIVATE','authorization':'Bearer HOST-CREDENTIAL','x-studio-authorization':'Bearer PROVIDER','x-target-url':'http://evil.test'},body:'{"prompt":{}}'})
    assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal(seen[0].headers.cookie,undefined);assert.equal(seen[0].headers.authorization,'Bearer PROVIDER');assert.equal(seen[0].headers['x-target-url'],undefined);assert.equal(seen[0].body,'{"prompt":{}}')
    assert.equal((await fetch(local.url+BASE+'/comfy/queue')).status,502)
    assert.equal((await fetch(local.url+BASE+'/comfy/prompt',{method:'POST',body:'bad'})).status,415)
  }finally{await local.close();await upstream.close()}
})
test('host entry registers scoped HTTP and WS routes with disposers',()=>{
  const routes=[],upgrades=[],disposers=[]
  const ctx={connection:owner,webServer:{register:r=>{routes.push(r);return()=>routes.pop()},registerUpgrade:r=>{upgrades.push(r);return()=>upgrades.pop()}},effect:f=>{disposers.push(f())}}
  apply(ctx)
  assert.equal(routes[0].path,BASE);assert.equal(upgrades[0].path,BASE+'/comfy/ws')
  disposers.forEach(f=>f());assert.equal(routes.length,0);assert.equal(upgrades.length,0)
})
test('browser bundle registers root main and sidebar surfaces without a conversation view',async()=>{
  let plugin; const React={createElement(){},useState(){},useEffect(){}}
  const listeners = new Map(), disposers = []
  const window = { location: { origin: 'http://localhost' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name), __ModuleLoader__:{load({id,factory}){assert.equal(id,'dsh-ai-pose-studio');plugin=factory(name=>{assert.equal(name,'react');return React})}} }
  vm.runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{window})
  assert.ok(plugin.inject.includes('remote.session'), 'rc.1 enforces injection of the concrete remote namespace')
  assert.ok(plugin.inject.includes('remote'), 'rc.1 also requires the parent remote service')
  const slots = []
  plugin.apply({connection:{generation:{subscribe:()=>()=>{},getSnapshot:()=>({})}},effect: fn => disposers.push(fn()), slots:{inject:(_name,fn)=>fn(),register:(opts,component)=>{slots.push(opts);assert.equal(typeof component,'function');return()=>{}}}})
  assert.deepEqual(slots.map(slot => slot.name), ['main', 'sidebar.panellist'])
  assert.equal(slots[0].key, 'ai-pose-studio')
  assert.equal(slots[1].label(),'角色工作台')
  assert.ok(listeners.has('message'))
  disposers.forEach(dispose => dispose())
  assert.equal(listeners.size, 0)
})
test('websocket tunnel denies missing host admission before contacting upstream',()=>{
  let data='';const socket={end:value=>{data=value},destroy(){throw Error('should end with rejection')}}
  createUpgrade(config,undefined)({url:BASE+'/comfy/ws',method:'GET',headers:{}},socket,Buffer.alloc(0))
  assert.match(data,/503/)
})
test('Comfy websocket tunnel carries live bytes and only websocket headers',async()=>{
  let observed
  const sockets=new Set()
  const upstream=createServer()
  upstream.on('upgrade',(q,s,head)=>{
    observed=q.headers;sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{})
    s.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: mock-accept\r\nSec-WebSocket-Protocol: comfyui\r\n\r\n')
    if(head.length)s.write(head)
    s.on('data',data=>s.write(data))
  })
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening')
  const conf={...config,comfyUrl:new URL(`http://127.0.0.1:${upstream.address().port}`)}
  const tunnel=createUpgrade(conf,owner);const host=createServer();host.on('upgrade',tunnel);host.listen(0,'127.0.0.1');await once(host,'listening')
  let connected
  try{
    const port=host.address().port
    connected=await new Promise((resolve,reject)=>{
      const q=request({hostname:'127.0.0.1',port,path:BASE+'/comfy/ws?clientId=test',headers:{connection:'Upgrade',upgrade:'websocket','sec-websocket-key':'mock-key','sec-websocket-version':'13','sec-websocket-protocol':'comfyui, comfyui-auth.PROVIDER',cookie:'HOST_SECRET=private',authorization:'Bearer HOST_TOKEN',origin:`http://127.0.0.1:${port}`}})
      q.on('upgrade',(r,s)=>resolve(s));q.on('error',reject);q.end()
    })
    const response=once(connected,'data');connected.write('live-progress');assert.equal((await response)[0].toString(),'live-progress')
    assert.equal(observed.cookie,undefined);assert.equal(observed.authorization,undefined);assert.equal(observed.origin,undefined)
    assert.equal(observed['sec-websocket-protocol'],'comfyui, comfyui-auth.PROVIDER')
  }finally{
    connected?.destroy();tunnel.dispose();for(const s of sockets)s.destroy()
    await Promise.all([new Promise(r=>host.close(r)),new Promise(r=>upstream.close(r))])
  }
})
