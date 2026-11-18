import test from 'node:test'
import assert from 'node:assert/strict'
import { createController, hostAdapter, emptyState, referenceUrl } from '../workbench.mjs'

function fixture(send = async () => ({ ok: true, value: { accepted: true } })) {
  let state = emptyState(), serial = 0
  const store = { async update(change) { const next = structuredClone(state); change(next); next.revision++; state = next; return structuredClone(state) } }
  const calls = []
  const host = {
    sessions: async () => [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    messages: async sessionId => [{ sessionId, seq: 7, messageId: 'm', kind: 'assistant/message', text: '角色结果' }],
    send: async (...args) => { calls.push(args); return send(...args) },
  }
  const controller = createController(store, host, () => `id-${++serial}`)
  return { controller, host, store, calls, state: () => state }
}
async function linked(f) {
  await f.controller.ready
  const id = await f.controller.create('测试角色')
  await f.controller.save(id, '固定资料')
  await f.controller.link(id, 'a', true)
  await f.controller.link(id, 'b', true)
  return id
}
test('explicit preview sends only chosen material to one linked session; acceptance is not completion', async () => {
  const f = fixture(), id = await linked(f)
  await f.controller.reference(id, '素材', 'https://example.com/image.png')
  await f.controller.adopt(id, 'b', 7)
  const preview = f.controller.preview([id], 'a', { notes: true })
  assert.match(preview.text, /固定资料/)
  assert.doesNotMatch(preview.text, /example.com|角色结果/)
  assert.equal(f.calls.length, 0)
  assert.equal(await f.controller.send(preview), 'accepted')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][0], 'a')
  assert.equal(f.state().tasks[0].status, 'accepted')
  await f.controller.complete(f.state().tasks[0].id)
  assert.equal(f.state().tasks[0].status, 'completed_by_user')
})
test('unlink retains role, collected source and task, but invalidates preview', async () => {
  const f = fixture(), id = await linked(f)
  await f.controller.adopt(id, 'a', 7)
  const preview = f.controller.preview([id], 'a', { sources: true })
  await f.controller.link(id, 'a', false)
  await assert.rejects(f.controller.send(preview), /重新预览/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.state().roles.length, 1)
  assert.equal(f.state().roles[0].sources[0].sessionId, 'a')
  assert.equal(f.state().roles[0].sources[0].seq, 7)
  assert.deepEqual(f.state().roles[0].sessions, ['b'])
})
test('collection rechecks host permission after preview and never imports stale denied text', async () => {
  const f = fixture(), id = await linked(f)
  assert.equal((await f.controller.messages(id, 'a')).length, 1)
  f.host.messages = async () => { throw new Error('remote-access/denied') }
  await assert.rejects(f.controller.adopt(id, 'a', 7), /denied/)
  assert.equal(f.state().roles[0].sources.length, 0)
})
test('duplicate clicks and panel unsubscribe do not duplicate or abort pending send', async () => {
  let settle, started
  const waiting = new Promise(resolve => { settle = resolve })
  const began = new Promise(resolve => { started = resolve })
  const f = fixture(() => { started(); return waiting }), id = await linked(f)
  const unsubscribe = f.controller.subscribe(() => {})
  const preview = f.controller.preview([id], 'a', { notes: true })
  const pending = f.controller.send(preview)
  await began
  unsubscribe()
  await assert.rejects(f.controller.send(preview), /处理中/)
  settle({ ok: true, value: { accepted: true } })
  assert.equal(await pending, 'accepted')
  assert.equal(f.calls.length, 1)
  assert.equal(f.state().tasks[0].status, 'accepted')
  await assert.rejects(f.controller.send(preview), /重新预览/)
})
test('lost transport receipt remains unknown and reload never auto-replays it', async () => {
  const f = fixture(async () => { throw new Error('connection reset') }), id = await linked(f)
  assert.equal(await f.controller.send(f.controller.preview([id], 'a', { notes: true })), 'unknown')
  const restored = createController(f.store, f.host)
  await restored.ready
  assert.equal(restored.getSnapshot().tasks[0].status, 'unknown')
  assert.equal(f.calls.length, 1)
  await assert.rejects(restored.complete(f.state().tasks[0].id))
})
test('host permission denial is distinct from transport ambiguity', async () => {
  const f = fixture(async () => ({ ok: false, error: { code: 'remote-access/denied' } })), id = await linked(f)
  assert.equal(await f.controller.send(f.controller.preview([id], 'a', { notes: true })), 'rejected')
})
test('failed durable intent write prevents sending', async () => {
  const f = fixture(), id = await linked(f)
  const preview = f.controller.preview([id], 'a', { notes: true })
  f.store.update = async () => { throw new Error('quota') }
  await assert.rejects(f.controller.send(preview), /quota/)
  assert.equal(f.calls.length, 0)
})
test('multiple roles require the same explicitly linked destination', async () => {
  const f = fixture(), first = await linked(f), second = await f.controller.create('第二角色')
  assert.throws(() => f.controller.preview([first, second], 'a', {}), /关联/)
  assert.throws(() => f.controller.preview([], 'a', {}), /选择/)
  assert.equal(f.calls.length, 0)
})
test('references reject credential URLs and executable protocols', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://u:p@example.com/a', 'https://example.com/a?key=x', 'https://example.com/a#token']) assert.throws(() => referenceUrl(url))
})
test('adapter uses fixed rc.1 passive history and queue APIs with explicit session resources', async () => {
  const calls = []
  const adapter = hostAdapter({ sessions: { refresh: async () => {}, list: { getSnapshot: () => ({ phase: 'ready', ids: ['a','child'], byId: { a: { id:'a',displayTitle:'A' }, child: {id:'child',origin:'subagent'} } }) } }, remote: { session: {
    list: async () => ({ok:true,value:{items:[{sessionId:'a'},{sessionId:'child',origin:'subagent'}]}}),
    events: async request => { calls.push(request); return { ok: true, value: { records: [{ type: 'event', event: { type: 'assistant/message', surfaceOp: 'append', seq: 3, data: { message: { id: 'm', content: [{ type: 'text', text: 'hello' }, {type: 'image', data: 'never expose'}] } } } }] } } },
    prompt: async request => { calls.push(request); return {ok:true,value:{accepted:true}} },
  } } })
  assert.deepEqual(await adapter.sessions(), [{id:'a',title:'A'}])
  assert.equal((await adapter.messages('a'))[0].text, 'hello')
  assert.deepEqual(calls[0], { address: { kind:'session',sessionId:'a' }, maxMessages:50 })
  await adapter.send('a','preview','request-id')
  assert.deepEqual(calls[1], {sessionId:'a',requestId:'request-id',mode:'queue',content:[{type:'text',text:'preview'}]})
})
test('local reference images are stored globally but preview never redistributes their bytes', async () => {
  const f = fixture(), id = await linked(f)
  const image = 'data:image/png;base64,aGVsbG8='
  await f.controller.image(id, '自有参考图', image)
  assert.equal(f.state().roles[0].references[0].url, image)
  const preview = f.controller.preview([id], 'a', { references: true })
  assert.match(preview.text, /自有参考图/)
  assert.doesNotMatch(preview.text, /data:image|aGVsbG8/)
  assert.throws(() => f.controller.image(id, 'svg', 'data:image/svg+xml;base64,aGVsbG8='))
})
test('saving notes detects another window edit rather than replacing it silently', async () => {
  const f = fixture(), id = await linked(f)
  await f.store.update(s => { s.roles[0].notes = '另一窗口的编辑' })
  await assert.rejects(f.controller.save(id, '旧草稿'), /另一窗口/)
  assert.equal(f.state().roles[0].notes, '另一窗口的编辑')
})
test('unlinked and inaccessible sessions cannot be silently imported or linked', async () => {
  const f = fixture(), id = await linked(f)
  await assert.rejects(f.controller.link(id, 'missing', true), /不可用/)
  await assert.rejects(f.controller.messages(id, 'missing'), /先关联/)
})
test('a persisted sending intent without this client operation is displayed as unknown', async () => {
  const f = fixture()
  await f.controller.ready
  await f.store.update(s => s.tasks.push({ id:'interrupted',status:'sending' }))
  await f.controller.refresh()
  assert.equal(f.controller.taskStatus(f.state().tasks[0]), 'unknown')
  assert.equal(f.calls.length, 0)
})
test('receipt persistence failure tells the user to reconcile and does not replay', async () => {
  const f = fixture(async () => {
    f.store.update = async () => { throw new Error('quota') }
    return { ok: true, value: { accepted: true } }
  }), id = await linked(f)
  await assert.rejects(f.controller.send(f.controller.preview([id], 'a', {notes:true})), /勿重复发送/)
  assert.equal(f.calls.length, 1)
  assert.equal(f.controller.taskStatus(f.state().tasks[0]), 'unknown')
})
test('message previews and collected sources have distinct sibling keys', async () => {
  const { createPanel } = await import('../workbench.mjs')
  const f = fixture(), id = await linked(f)
  await f.controller.adopt(id, 'a', 7)
  let hook = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useSyncExternalStore: (_subscribe, get) => get(),
    useEffect: () => {},
    useState(initial) {
      const index = hook++
      return [index === 1 ? id : index === 10 ? [{sessionId:'a',seq:7,text:'result'}] : initial, () => {}]
    },
  }
  const tree = createPanel(React, f.controller, f.host, () => null)()
  let checked = 0
  function visit(node) {
    if (!node || typeof node !== 'object') return
    const keyed = node.children?.filter(child => child?.props?.key).map(child => child.props.key) || []
    assert.equal(new Set(keyed).size, keyed.length)
    checked += keyed.length
    node.children?.forEach(visit)
  }
  visit(tree)
  assert.ok(checked >= 3)
})
test('studio opens by default and stays mounted when entering and leaving collaboration', async () => {
  const { createPanel } = await import('../workbench.mjs')
  const f = fixture(); await f.controller.ready
  const hooks = []; let cursor = 0
  const React = {
    createElement: (type, props, ...children) => ({type, props, children}),
    useSyncExternalStore: (_subscribe, get) => get(), useEffect() {},
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value }] },
  }
  const Studio = () => null, Panel = createPanel(React, f.controller, f.host, Studio)
  const render = () => { cursor = 0; return Panel() }
  let tree = render()
  assert.equal(tree.children[1].props.hidden, false)
  assert.equal(tree.children[1].children[0].type, Studio)
  assert.equal(tree.children[2].props.hidden, true)
  assert.equal(tree.children[0].children[1].children[0], '跨会话协作')
  tree.children[0].children[1].props.onClick(); tree = render()
  assert.equal(tree.children[1].props.hidden, true)
  assert.equal(tree.children[1].children[0].type, Studio)
  assert.equal(tree.children[2].props.hidden, false)
  assert.equal(tree.children[0].children[1].children[0], '返回合成台')
  tree.children[0].children[1].props.onClick(); tree = render()
  assert.equal(tree.children[1].props.hidden, false)
  assert.equal(tree.children[1].children[0].type, Studio)
})
