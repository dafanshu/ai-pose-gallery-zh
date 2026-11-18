import test from 'node:test'
import assert from 'node:assert/strict'
import { createController, createKeyVault, emptyState, hostAdapter } from '../workbench.mjs'
const result = value => ({ ok: true, value })
const event = (seq, type, data, surfaceOp = 'append') => ({ type: 'event', event: { seq, type, data, surfaceOp } })
const message = (text, source = {kind:'user'}) => ({id:'message-id', content:[{type:'text',text}],source})
function adapter(records, list = async () => result({items:[{sessionId:'s'}]})) {
  return hostAdapter({sessions:{list:{getSnapshot:()=>({byId:{s:{displayTitle:'S'}}})}},remote:{session:{list,events:async()=>result({records}),prompt:async()=>result({accepted:true})}}})
}
function memoryStore() {
  let state = emptyState()
  return { async update(change) { const next = structuredClone(state); change(next); next.revision++; state=next; return structuredClone(next) } }
}
test('rc.1 user data and assistant data.message differ; compaction replacements are not conversation messages', async () => {
  const host = adapter([
    event(1,'user/message',message('human')),
    event(2,'assistant/message',{message:message('assistant')}),
    event(3,'user/message',message('compacted internal context'),{op:'replace',startSeq:1,endSeq:2}),
  ])
  assert.deepEqual((await host.messages('s')).map(row=>row.text),['human','assistant'])
})
test('a failed live list request is not reported as a successful stale Client list', async () => {
  const host = adapter([],async()=>({ok:false,error:{code:'remote-access/denied'}}))
  await assert.rejects(host.sessions(),/remote-access\/denied/)
})
test('receipt reconciliation requires the exact request identity in a human append event', async () => {
  const host = adapter([
    event(1,'user/message',message('same prompt',{kind:'user',rpcId:'other'})),
    event(2,'user/message',message('same prompt',{kind:'user',rpcId:'request'}),{op:'replace',startSeq:1,endSeq:1}),
  ])
  assert.equal(await host.receipt('s','request'),null)
  const accepted = adapter([event(3,'user/message',message('different rendered text',{kind:'user',rpcId:'request'}))])
  assert.deepEqual(await accepted.receipt('s','request'),{seq:3,messageId:'message-id'})
})
test('plugin disposal while intent write is pending prevents any later Host send', async () => {
  const base=memoryStore(); let release, began
  const started=new Promise(resolve=>{began=resolve})
  let hold=false, calls=0
  const store={async update(change){const next=await base.update(change);if(hold){hold=false;began();await new Promise(resolve=>{release=resolve})}return next}}
  const c=createController(store,{sessions:async()=>[{id:'s'}],send:async()=>{calls++;return result({accepted:true})}},()=>String(Math.random()))
  await c.ready;const id=await c.create('role');await c.link(id,'s',true)
  const preview=c.preview([id],'s',{notes:true});hold=true
  const sent=c.send(preview);await started;c.dispose();release()
  await assert.rejects(sent,/尚未发送/);assert.equal(calls,0)
  const restored=await base.update(()=>{});assert.equal(restored.tasks[0].status,'not_sent')
})
test('preview cannot be forged or mutated after user review', async () => {
  const c=createController(memoryStore(),{sessions:async()=>[{id:'s'}]})
  await c.ready;const id=await c.create('role');await c.link(id,'s',true)
  const preview=c.preview([id],'s',{notes:true})
  assert.throws(()=>{preview.target='different'})
  assert.throws(()=>{preview.ids.push('different')})
  await assert.rejects(c.send({...preview}),/先生成预览/)
})
test('clear and iframe replacement reject delayed key writes; foreign sources cannot read', () => {
  const replies=[], frame={postMessage:data=>replies.push(data)}, other={postMessage(){throw new Error('unexpected reply')}}
  const vault=createKeyVault('https://host.example')
  const packet=(op,epoch,source=frame,origin='https://host.example')=>({source,origin,data:{channel:'pose-studio-memory-v1',op,epoch,keys:{gpt:'synthetic',gemini:'',qwen:'',doubao:'',comfyui:''}}})
  vault.connect(frame);vault.handle(packet('get'));const first=replies.at(-1).epoch
  vault.handle(packet('set',first));vault.handle(packet('get'));assert.equal(replies.at(-1).keys.gpt,'synthetic')
  vault.clear();vault.handle(packet('set',first));vault.handle(packet('get'));assert.deepEqual(replies.at(-1).keys,{})
  const count=replies.length;vault.handle(packet('get',first,other));vault.handle(packet('get',first,frame,'https://evil.example'));assert.equal(replies.length,count)
  vault.connect(other);vault.handle(packet('set',first));vault.dispose();vault.handle(packet('get'));assert.equal(replies.length,count)
})
test('history archive copies only user-selected result fields and never config or workflow', async () => {
  const { projectStudioHistory } = await import('../workbench.mjs')
  const rows=projectStudioHistory([{id:'g',createdAt:1,prompt:'prompt',model:'model',provider:'gpt',recipeSummary:'summary',imageUrl:'data:image/png;base64,aGVsbG8=',apiKey:'not-copied',snapshot:{settings:{secret:'not-copied'},submittedWorkflowJson:'not-copied'}}])
  assert.doesNotMatch(JSON.stringify(rows),/not-copied|apiKey|settings|snapshot/)
  const c=createController(memoryStore(),{sessions:async()=>[{id:'s'}]},undefined,async()=>rows)
  await c.ready;const id=await c.create('role');await c.link(id,'s',true)
  assert.equal(c.getSnapshot().roles[0].archives,undefined)
  await c.archive(id,'g');await c.archive(id,'g')
  assert.equal(c.getSnapshot().roles[0].archives.length,1)
  const preview=c.preview([id],'s',{archives:true})
  assert.match(preview.text,/prompt/);assert.doesNotMatch(preview.text,/data:image|aGVsbG8/)
  assert.throws(()=>projectStudioHistory([{...rows[0],imageUrl:'https://example.com/x?token=secret'}]))
})
test('reconciliation marks acceptance only and no match never triggers a replay', async () => {
  const store=memoryStore();let calls=0,receipt=null
  const host={sessions:async()=>[{id:'s'}],send:async()=>{calls++;throw Error('lost')},receipt:async()=>receipt}
  const c=createController(store,host)
  await c.ready;const id=await c.create('role');await c.link(id,'s',true)
  await c.send(c.preview([id],'s',{notes:true}));const task=c.getSnapshot().tasks[0]
  await assert.rejects(c.reconcile(task.id),/未找到/);assert.equal(calls,1)
  receipt={seq:2,messageId:'m'};await c.reconcile(task.id)
  assert.equal(c.getSnapshot().tasks[0].status,'accepted');assert.equal(calls,1)
})
test('image limits measure decoded bytes and reject malformed base64', async () => {
  const c=createController(memoryStore(),{})
  await c.ready;const id=await c.create('role')
  await c.image(id,'boundary','data:image/png;base64,'+Buffer.alloc(2*1024*1024).toString('base64'))
  assert.throws(()=>c.image(id,'oversize','data:image/png;base64,'+Buffer.alloc(2*1024*1024+1).toString('base64')),/2 MiB/)
  assert.throws(()=>c.image(id,'invalid','data:image/png;base64,A==='),/2 MiB/)
})
