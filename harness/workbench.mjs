/** Global, browser-local role records; never store provider configuration here. */
export const DATABASE = 'ai-pose-harness-global-v1'
export const emptyState = () => ({ version: 1, revision: 0, roles: [], tasks: [] })
const limitText = (value, max = 20000) => {
  if (typeof value !== 'string' || value.length > max) throw new Error('文本为空或超过长度限制')
  return value
}
export function referenceUrl(value) {
  const u = new URL(value)
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('参考地址仅支持不含凭据、查询参数和片段的 HTTP(S) 链接')
  return u.href
}
function validImage(data, maxBytes) {
  if (typeof data !== 'string' || data.length > Math.ceil(maxBytes / 3) * 4 + 40) return false
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data)
  if (!match || !match[1]) return false
  const encoded = match[1]
  if (encoded.length % 4 !== 0) return false
  return encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0) <= maxBytes
}
export function browserStore(indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('state')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error('无法打开角色资料库'))
  })
  return {
    async update(change) {
      const db = await open()
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state')
          let next, failure
          const request = store.get('global')
          request.onsuccess = () => {
            try {
              next = request.result || emptyState()
              if (next.version !== 1 || !Array.isArray(next.roles) || !Array.isArray(next.tasks)) throw new Error('角色资料版本不支持；保留原数据')
              change(next)
              next.revision++
              store.put(next, 'global')
            } catch (error) { failure = error; tx.abort() }
          }
          tx.oncomplete = () => resolve(next)
          tx.onerror = tx.onabort = () => reject(failure || new Error('角色资料保存失败；未执行后续操作'))
        })
      } finally { db.close() }
    },
  }
}

/** Only gateway calls with an explicit target Session reach the Host. */
export function hostAdapter(ctx) {
  const unpack = result => {
    if (!result?.ok) throw new Error(result?.error?.code || '宿主请求失败')
    return result.value
  }
  return {
    async sessions() {
      // ClientSessions.refresh() can swallow a denied refresh and retain old rows.
      // Inspect this call's authoritative RemoteResult instead.
      const result = unpack(await ctx.remote.session.list({}))
      const labels = ctx.sessions.list.getSnapshot().byId
      return result.items.filter(row => row.origin !== 'subagent').map(row => ({
        id: row.sessionId, title: labels[row.sessionId]?.displayTitle || row.sessionId,
      }))
    },
    async messages(sessionId) {
      const page = unpack(await ctx.remote.session.events({ address: { kind: 'session', sessionId }, maxMessages: 50 }))
      return page.records.flatMap(record => {
        const event = record.event
        if (!event || event.surfaceOp !== 'append' || !['user/message', 'assistant/message'].includes(event.type)) return []
        const message = event.type === 'user/message' ? event.data : event.data?.message
        if (!Array.isArray(message?.content) || !Number.isSafeInteger(event.seq)) throw new Error('宿主消息格式不兼容')
        const text = message.content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n')
        return text ? [{ sessionId, seq: event.seq, messageId: message.id || '', kind: event.type, text: text.slice(0, 20000), truncated: text.length > 20000 }] : []
      })
    },
    async receipt(sessionId, requestId) {
      const page = unpack(await ctx.remote.session.events({ address: { kind: 'session', sessionId }, maxMessages: 50 }))
      const found = page.records.find(({ event }) => event?.type === 'user/message' && event.surfaceOp === 'append' && event.data?.source?.kind === 'user' && event.data.source.rpcId === requestId)
      return found ? { seq: found.event.seq, messageId: found.event.data.id } : null
    },
    async send(sessionId, text, requestId) {
      return ctx.remote.session.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] })
    },
  }
}

/** Owns send promises across panel unmount. Reload never replays a pending send. */
export function createController(store, host, uuid = () => crypto.randomUUID(), readHistory = async () => []) {
  let state = emptyState(), disposed = false
  const listeners = new Set(), active = new Set(), pending = new Set(), previews = new WeakSet()
  const publish = next => { if (disposed) return; state = next; for (const fn of listeners) { try { fn() } catch { console.warn('角色工作台状态订阅失败') } } }
  const update = async change => {
    if (disposed) throw new Error('角色工作台已停用')
    const next = await store.update(change)
    publish(next)
    return next
  }
  const roleOf = (s, id) => {
    const role = s.roles.find(item => item.id === id)
    if (!role) throw new Error('角色不存在')
    return role
  }
  const api = {
    getSnapshot: () => state,
    taskStatus: task => task.status === 'sending' && !pending.has(task.id) ? 'unknown' : task.status,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    ready: null,
    refresh: () => update(() => {}),
    async create(name) {
      name = limitText(name, 100).trim()
      if (!name) throw new Error('请输入角色名称')
      const id = uuid()
      await update(s => s.roles.push({ id, name, notes: '', references: [], sources: [], sessions: [] }))
      return id
    },
    save(id, notes) {
      const original = roleOf(state, id).notes
      return update(s => {
        const role = roleOf(s, id)
        if (role.notes !== original) throw new Error('角色资料已由另一窗口修改，请刷新后编辑')
        role.notes = limitText(notes)
      })
    },
    image(id, label, data) {
      if (!validImage(data, 2 * 1024 * 1024)) throw new Error('只支持不超过 2 MiB 的 PNG/JPEG/WebP 图片')
      return update(s => roleOf(s, id).references.push({ id: uuid(), label: limitText(label, 100), url: data, local: true }))
    },
    reference(id, label, url) {
      const ref = { id: uuid(), label: limitText(label, 100), url: referenceUrl(url) }
      return update(s => { roleOf(s, id).references.push(ref) })
    },
    async link(id, sessionId, linked) {
      if (linked && !(await host.sessions()).some(row => row.id === sessionId)) throw new Error('目标会话不可用')
      return update(s => {
        const role = roleOf(s, id)
        role.sessions = role.sessions.filter(value => value !== sessionId)
        if (linked) role.sessions.push(sessionId)
      })
    },
    async messages(id, sessionId) {
      if (!roleOf(state, id).sessions.includes(sessionId)) throw new Error('请先关联会话')
      return host.messages(sessionId)
    },
    async adopt(id, sessionId, seq) {
      // Re-read through the Session gateway at the moment of adoption; no stale preview authority.
      const selected = (await api.messages(id, sessionId)).find(row => row.seq === seq)
      if (!selected) throw new Error('该消息已不在最近记录中，请刷新')
      return update(s => {
        const role = roleOf(s, id)
        if (!role.sessions.includes(sessionId)) throw new Error('会话已解除关联')
        if (!role.sources.some(row => row.sessionId === sessionId && row.seq === seq)) role.sources.push({ ...selected, adoptedAt: Date.now() })
      })
    },
    preview(ids, target, fields) {
      if (!ids.length || !target) throw new Error('请选择角色和一个目标会话')
      const roles = ids.map(id => roleOf(state, id))
      if (roles.some(role => !role.sessions.includes(target))) throw new Error('每个所选角色都须关联目标会话')
      const text = '[角色工作台 · 用户手动分享资料]\n' + roles.map(role => {
        const lines = [role.name]
        if (fields.notes) lines.push(role.notes)
        if (fields.references) lines.push(...role.references.map(ref => ref.local ? `${ref.label}: [本地图片，仅分享名称；未发送图片内容]` : `${ref.label}: ${ref.url}`))
        if (fields.archives) lines.push(...(role.archives || []).map(item => `[用户归档的本地生成记录 ${item.id}；图片内容未发送]\n${item.prompt}`))
        if (fields.sources) lines.push(...role.sources.map(src => `[用户收录；会话 ${src.sessionId}，事件 ${src.seq}]\n${src.text}`))
        return lines.filter(Boolean).join('\n')
      }).join('\n\n')
      limitText(text, 50000)
      const preview = Object.freeze({ ids: Object.freeze([...ids]), target, text, revision: state.revision })
      previews.add(preview)
      return preview
    },
    async send(preview) {
      if (!previews.has(preview)) throw new Error('请先生成预览')
      if (disposed || active.has(preview)) throw new Error('发送已在处理中')
      active.add(preview)
      const id = uuid()
      pending.add(id)
      try {
        await update(s => {
          if (s.revision !== preview.revision) throw new Error('资料已变化，请重新预览')
          for (const roleId of preview.ids) if (!roleOf(s, roleId).sessions.includes(preview.target)) throw new Error('会话已解除关联')
          s.tasks.push({ id, roleIds: preview.ids, sessionId: preview.target, text: preview.text, status: 'sending', createdAt: Date.now() })
        })
        if (disposed) {
          // The intent committed before disposal. Record that no Host call occurred.
          await store.update(s => { s.tasks.find(row => row.id === id).status = 'not_sent' })
          throw new Error('插件已停用，尚未发送')
        }
        let status = 'unknown'
        try {
          const result = await host.send(preview.target, preview.text, id)
          // Transport failures can arrive in the error branch; none imply safe retry.
          if (result?.ok && result.value?.accepted === true) status = 'accepted'
          else if (result?.error?.code === 'remote-access/denied') status = 'rejected'
        } catch { /* Admission may have committed; preserve unknown and never retry automatically. */ }
        try {
          await update(s => { const task = s.tasks.find(row => row.id === id); task.status = status })
        } catch {
          throw new Error('发送已尝试，但回执未能保存。请核对目标会话，勿重复发送。')
        }
        return status
      } finally { active.delete(preview); pending.delete(id) }
    },
    localHistory: () => readHistory(),
    async archive(id, historyId) {
      const result = (await readHistory()).find(row => row.id === historyId)
      if (!result) throw new Error('历史结果已不可用，请重新读取')
      return update(s => {
        const role = roleOf(s, id)
        role.archives ??= []
        if (!role.archives.some(row => row.id === historyId)) role.archives.push({ ...result, archivedAt: Date.now(), source: 'studio-history' })
      })
    },
    async reconcile(id) {
      if (disposed) throw new Error('角色工作台已停用')
      const task = state.tasks.find(row => row.id === id)
      if (!task || pending.has(id)) throw new Error('请等待当前发送结束后再核对')
      const evidence = await host.receipt(task.sessionId, task.id)
      if (!evidence) throw new Error('最近消息中未找到此请求；保留原状态，请到会话核对，勿自动重发')
      return update(s => {
        const current = s.tasks.find(row => row.id === id)
        if (!['unknown', 'sending', 'accepted'].includes(current.status)) return
        current.status = 'accepted'; current.receipt = { ...evidence, checkedAt: Date.now() }
      })
    },
    complete(id) { return update(s => {
      const task = s.tasks.find(row => row.id === id)
      if (!task || task.status !== 'accepted') throw new Error('仅可手动确认已接受任务完成')
      task.status = 'completed_by_user'; task.completedAt = Date.now()
    }) },
    dispose() { disposed = true; listeners.clear() },
  }
  api.ready = update(() => {})
  return api
}

/** Original React studio remains separate; this panel holds only host-owned actions. */
export function createPanel(React, controller, host, Studio) {
  const h = React.createElement
  const button = (label, action, disabled = false) => h('button', { type: 'button', onClick: action, disabled, style: { padding: '6px 10px', border: '1px solid #8886', borderRadius: 6, margin: 3 } }, label)
  const status = { not_sent: '插件停用前尚未发送', sending: '发送中；重启后请核对会话，不要重复发送', accepted: '发送已接受，尚未确认任务完成', rejected: '权限拒绝，未发送', unknown: '结果未知，请到目标会话核对；不会自动重试', completed_by_user: '用户已确认完成' }
  return function Panel() {
    const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot)
    const [tab, setTab] = React.useState('studio'), [selected, setSelected] = React.useState('')
    const [name, setName] = React.useState(''), [notes, setNotes] = React.useState('')
    const [label, setLabel] = React.useState(''), [url, setUrl] = React.useState(''), [image, setImage] = React.useState(null)
    const [sessions, setSessions] = React.useState([]), [target, setTarget] = React.useState('')
    const [chosen, setChosen] = React.useState([]), [messages, setMessages] = React.useState([])
    const [fields, setFields] = React.useState({ notes: true, references: false, sources: false, archives: false })
    const [preview, setPreview] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
    const [localHistory, setLocalHistory] = React.useState([])
    const [readNotice, setReadNotice] = React.useState('')
    const role = state.roles.find(row => row.id === selected)
    const run = async fn => { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message || '操作失败') } finally { setBusy(false) } }
    React.useEffect(() => { run(() => controller.ready) }, [])
    React.useEffect(() => { setNotes(role?.notes || '') }, [selected, role?.notes])
    React.useEffect(() => { setMessages([]); setPreview(null); setImage(null) }, [selected])
    const input = (value, setter, placeholder) => h('input', { value, onChange: e => setter(e.target.value), placeholder, 'aria-label': placeholder, style: { padding: 7, margin: 3, border: '1px solid #8886', borderRadius: 5, maxWidth: '100%' } })
    const check = (checked, change, text) => h('label', { style: { display: 'inline-block', margin: 6 } }, h('input', { type: 'checkbox', checked, onChange: change }), ' ', text)
    return h('section', { style: { height: '100%', width: '100%', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      h('header', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '8px 16px', flexShrink: 0, borderBottom: '1px solid #8884' } },
        h('h2', { style: { margin: 0, fontSize: 18 } }, '角色工作台'),
        button(tab === 'studio' ? '跨会话协作' : '返回合成台', () => setTab(tab === 'studio' ? 'roles' : 'studio'))),
      // Keep the studio mounted while visiting collaboration, preserving its iframe and requests.
      h('div', { hidden: tab !== 'studio', style: { display: tab === 'studio' ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' } }, h(Studio)),
      h('div', { hidden: tab !== 'roles', style: { display: tab === 'roles' ? 'block' : 'none', flex: 1, minHeight: 0, overflow: 'auto', padding: 16 } },
        h('p', null, '角色资料属于本浏览器的全局工作台。关联不转移所有权；解除关联不会删除角色或会话。'),
        error ? h('p', { role: 'alert', style: { color: '#d9534f' } }, error) : null,
        readNotice ? h('p', { role: 'status' }, readNotice) : null,
        input(name, setName, '新角色名称'), button('创建角色', () => run(async () => { setSelected(await controller.create(name)); setName('') }), busy),
        button('刷新资料', () => run(() => controller.refresh()), busy),
        h('div', null, ...state.roles.map(row => h('span', { key: row.id },
          button(row.name + (row.id === selected ? ' ✓' : ''), () => setSelected(row.id), busy),
          check(chosen.includes(row.id), () => { setChosen(chosen.includes(row.id) ? chosen.filter(id => id !== row.id) : [...chosen, row.id]); setPreview(null) }, '加入汇集')))),
        role ? h('section', null,
          h('h3', null, role.name),
          h('textarea', { 'aria-label': '角色资料', value: notes, onChange: e => setNotes(e.target.value), rows: 5, style: { display: 'block', width: '100%', boxSizing: 'border-box', border: '1px solid #8886', padding: 8 } }),
          button('保存资料', () => run(() => controller.save(selected, notes)), busy),
          h('h4', null, '参考图与素材链接'),
          h('p', null, '只保存引用，不抓取或打包素材；分享时可选择链接，不会自动发送图片。'),
          input(label, setLabel, '参考名称'), input(url, setUrl, '参考图片或素材 URL'),
          button('添加引用', () => run(async () => { await controller.reference(selected, label, url); setUrl(''); setLabel('') }), busy),
          h('label', null, '上传自有参考图 ', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', disabled: busy, onChange: event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            run(async () => {
              if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('只支持不超过 2 MiB 的 PNG/JPEG/WebP 图片')
              const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) })
              await controller.image(selected, file.name.slice(0, 100), data)
            })
          } })),
          h('ul', null, ...role.references.map(ref => h('li', { key: ref.id }, ref.label, ' — ', ref.local ? '本地参考图' : ref.url, button('预览图片', () => setImage(ref))))),
          image ? h('div', null, button('关闭图片预览', () => setImage(null)), h('img', { src: image.url, alt: image.label, referrerPolicy: 'no-referrer', style: { maxWidth: '100%', maxHeight: 420 } })) : null,
          h('h4', null, '原合成台生成历史'),
          h('p', null, '仅在点击后读取最近 50 条本地历史；归档所选结果，不导入供应商配置或工作流。图片不会自动发送到会话。'),
          button('读取本地生成历史', () => run(async () => { setReadNotice(''); setLocalHistory([]); const rows = await controller.localHistory(); setLocalHistory(rows); setReadNotice(`已读取 ${rows.length} 条本地生成历史`) }), busy),
          ...localHistory.map(item => h('details', { key: 'history:' + item.id }, h('summary', null, `${item.model} · ${new Date(item.createdAt).toLocaleString()}`),
            h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, item.prompt),
            button('将此结果归档到当前角色', () => run(() => controller.archive(selected, item.id)), busy))),
          ...(role.archives || []).map(item => h('details', { key: 'archive:' + item.id }, h('summary', null, `已归档 · ${item.model} · ${item.id}`),
            h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, item.prompt),
            button('预览归档图片', () => setImage({ url: item.imageUrl, label: item.recipeSummary })))),
          h('h4', null, '关联会话'), button('读取可见会话列表', () => run(async () => { setReadNotice(''); setSessions([]); const rows = await host.sessions(); setSessions(rows); setReadNotice(`已读取 ${rows.length} 个可见会话`) }), busy),
          ...sessions.map(row => h('div', { key: row.id },
            check(role.sessions.includes(row.id), () => run(() => controller.link(selected, row.id, !role.sessions.includes(row.id))), row.title),
            button('读取最近文字消息', () => run(async () => { setMessages([]); setMessages(await controller.messages(selected, row.id)) }), busy || !role.sessions.includes(row.id)))),
          ...role.sessions.filter(id => !sessions.some(row => row.id === id)).map(id => h('div', { key: id }, id, button('解除关联', () => run(() => controller.link(selected, id, false)), busy))),
          h('p', null, '读取仅查看最近 50 条消息范围内的文字；附件与完整历史暂不导入。每次读取和发送均由宿主核验目标会话权限。'),
          ...messages.map(message => h('article', { key: 'message:' + message.sessionId + ':' + message.seq, style: { border: '1px solid #8885', padding: 10, margin: 6 } },
            h('small', null, `${message.kind} · ${message.sessionId} · #${message.seq}${message.truncated ? ' · 仅显示前 20000 字符' : ''}`), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, message.text),
            button('收录此消息到角色', () => run(() => controller.adopt(selected, message.sessionId, message.seq)), busy))),
          h('h4', null, '已收录资料'), ...role.sources.map(src => h('details', { key: 'source:' + src.sessionId + ':' + src.seq }, h('summary', null, `来源 ${src.sessionId} · #${src.seq}`), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, src.text))),
        ) : h('p', null, '创建或选择一个角色开始。'),
        h('h3', null, '汇集预览与手动发送'),
        h('select', { 'aria-label': '目标会话', value: target, onChange: e => { setTarget(e.target.value); setPreview(null) } }, h('option', { value: '' }, '选择一个目标会话'), ...sessions.map(row => h('option', { key: row.id, value: row.id }, row.title))),
        ...[['notes', '角色资料'], ['references', '素材链接'], ['sources', '已收录消息'], ['archives', '已归档生成提示词']].map(([key, text]) => check(fields[key], () => { setFields({ ...fields, [key]: !fields[key] }); setPreview(null) }, text)),
        button('生成预览', () => run(async () => setPreview(controller.preview(chosen, target, fields))), busy),
        preview ? h('div', null, h('p', null, `唯一发送目标：${preview.target}`), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, preview.text), button('确认向此会话发送', () => run(async () => { const result = await controller.send(preview); setPreview(null); if (result !== 'accepted') setError(status[result]) }), busy)) : null,
        h('h3', null, '发送与任务记录'),
        h('p', null, '发送被接受不代表生成完成。切换左侧页面不会取消正在等待的发送；宿主重启后请手动核对未知结果。'),
        ...state.tasks.slice().reverse().map(task => h('article', { key: task.id, style: { padding: 8, borderBottom: '1px solid #8885' } },
          h('p', null, `${task.sessionId} · ${status[controller.taskStatus(task)]} · 请求 ${task.id}`),
          h('details', null, h('summary', null, '查看发送内容'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, task.text)),
          ['unknown', 'sending'].includes(controller.taskStatus(task)) ? button('只读核对发送回执', () => run(() => controller.reconcile(task.id)), busy) : null,
          task.status === 'accepted' ? button('我已检查结果，标记完成', () => run(() => controller.complete(task.id)), busy) : null)),
      ))
  }
}

/** Memory-only vault; epochs prevent delayed iframe messages from undoing a clear. */
export function createKeyVault(origin) {
  let frame = null, epoch = 0, keys = {}, disposed = false
  const reply = () => frame?.postMessage({ channel: 'pose-studio-memory-v1', op: 'state', keys, epoch }, origin)
  return {
    connect(next) { frame = next; epoch++ },
    clear() { keys = {}; epoch++; if (!disposed) reply() },
    handle(event) {
      if (disposed || !frame || event.source !== frame || event.origin !== origin) return
      const message = event.data
      if (message?.channel !== 'pose-studio-memory-v1') return
      if (message.op === 'get') { reply(); return }
      if (message.op !== 'set' || message.epoch !== epoch || !message.keys || typeof message.keys !== 'object') return
      const next = {}
      for (const id of ['gemini', 'gpt', 'qwen', 'doubao', 'comfyui']) {
        const value = message.keys[id]
        if (typeof value !== 'string' || value.length > 16384) return
        next[id] = value
      }
      keys = next
    },
    dispose() { disposed = true; keys = {}; frame = null; epoch++ },
  }
}

/** Whitelist only the selected generation's public result; never copy config or workflows. */
export function projectStudioHistory(rows) {
  if (rows === undefined) return []
  if (!Array.isArray(rows)) throw new Error('原合成台历史格式不兼容')
  return rows.slice(0, 50).map(row => {
    const id = limitText(row.id, 200), prompt = limitText(row.prompt), model = limitText(row.model, 200)
    const provider = limitText(row.provider, 100), recipeSummary = limitText(row.recipeSummary, 2000)
    if (!Number.isFinite(row.createdAt)) throw new Error('原合成台历史时间无效')
    const imageUrl = row.imageUrl
    if (typeof imageUrl !== 'string') throw new Error('原合成台结果地址无效')
    if (imageUrl.startsWith('data:')) {
      if (!validImage(imageUrl, 8 * 1024 * 1024)) throw new Error('历史图片格式不支持或超过 8 MiB 归档限制')
    } else referenceUrl(imageUrl)
    return { id, createdAt: row.createdAt, prompt, model, provider, recipeSummary, imageUrl }
  })
}
export async function readStudioHistory(indexedDB) {
  const db = await new Promise((resolve, reject) => {
    let absent = false
    const req = indexedDB.open('ai-pose-harness-v1:pose_atlas_studio_db')
    req.onupgradeneeded = () => { absent = true; req.transaction.abort() }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => absent ? resolve(null) : reject(new Error('原合成台历史读取失败'))
  })
  if (!db) return []
  try {
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv_store', 'readonly')
      const req = tx.objectStore('kv_store').get('ai-pose-harness-v1:pose_atlas_history_v3')
      tx.oncomplete = () => resolve(req.result)
      tx.onabort = tx.onerror = () => reject(new Error('原合成台历史读取失败'))
    })
    return projectStudioHistory(rows)
  } finally { db.close() }
}
