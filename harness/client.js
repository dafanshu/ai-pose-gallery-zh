/* Host React is used only for this small shell. The full React 19 app has its own document. */
window.__ModuleLoader__.load({
  id: 'dsh-ai-pose-studio',
  factory: (require) => {
    const React = require('react')
    const APP = '/api/ai-pose-studio/app/'
    let frameWindow = null
    let keys = {}
    const connectFrame = node => { frameWindow = node?.contentWindow || null }
    const clearKeys = () => {
      keys = {}
      frameWindow?.postMessage({ channel: 'pose-studio-memory-v1', op: 'state', keys }, window.location.origin)
    }
    function Workbench() {
      const [status, setStatus] = React.useState('loading')
      const [health, setHealth] = React.useState(null)
      React.useEffect(() => {
        const controller = new AbortController()
        fetch('/api/ai-pose-studio/health', { credentials:'same-origin', signal:controller.signal, cache:'no-store' })
          .then(async response => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const data = await response.json()
            setHealth(data); setStatus(data.appBuilt ? 'ready' : 'unbuilt')
          })
          .catch(error => { if (error.name !== 'AbortError') setStatus('error') })
        return () => controller.abort()
      }, [])
      if (status !== 'ready') return React.createElement('div', { style:{padding:24} },
        React.createElement('h2', null, '角色合成工作台'),
        React.createElement('p', null, status === 'loading' ? '正在检查工作台…' : status === 'unbuilt' ? '工作台尚未构建。请先在图库仓库运行 build:harness，再加载插件。' : '无法连接工作台。请检查 Harness 版本、登录状态和主机插件是否启用。'),
        React.createElement('p', null, '需要 Harness 0.2.2-rc.1 的 web profile。完整构建与安装说明见插件 README。'))
      const missing = health.catalogs.filter(item => !item.present)
      return React.createElement('section', { style:{height:'100%',minHeight:500,display:'flex',flexDirection:'column',width:'100%'} },
        React.createElement('p', { role: 'status', style: { padding: 8, margin: 0 } }, '密钥仅暂存于当前 Harness 窗口内存，切换面板可恢复；刷新宿主或停用插件后清除。云端生图尚不保证跨面板卸载继续跟踪。'),
        React.createElement('button', { type: 'button', onClick: clearKeys }, '清除本窗口的供应商密钥'),
        missing.length ? React.createElement('p', { role:'alert', style:{padding:8,margin:0} }, '缺少 ' + missing.length + ' 个图库数据文件。请在主机配置 assetRoot 指向完整图库仓库；上传图片仍可使用。') : null,
        React.createElement('iframe', { ref: connectFrame, title:'角色合成工作台', src:APP, style:{border:0,flex:1,width:'100%',minHeight:500}, referrerPolicy:'no-referrer', allow:'clipboard-write' }))
    }
    return {
      name:'dsh-ai-pose-studio-client', inject:['slots', 'sessions', 'remote'],
      apply(ctx) {
        let disposed = false, controller
        const module = import('/api/ai-pose-studio/workbench.mjs').then(api => {
          if (disposed) throw new Error('角色工作台已停用')
          const host = api.hostAdapter(ctx)
          controller = api.createController(api.browserStore(window.indexedDB), host)
          // Keep startup rejection observed even before the panel is first selected.
          controller.ready.catch(() => {})
          return api.createPanel(React, controller, host, Workbench)
        })
        module.catch(() => {})
        function GlobalWorkbench() {
          const [Panel, setPanel] = React.useState(null)
          const [error, setError] = React.useState('')
          React.useEffect(() => {
            let mounted = true
            module.then(panel => { if (mounted) setPanel(() => panel) }).catch(() => { if (mounted) setError('无法加载全局工作台，请检查插件服务与登录状态。') })
            return () => { mounted = false }
          }, [])
          return Panel ? React.createElement(Panel) : React.createElement('p', { role: 'status' }, error || '正在加载角色工作台…')
        }
        // The iframe can only retain its own provider keys in root-client memory.
        // No session, RPC, configuration-file or credential-service method is bridged.
        const onMessage = event => {
          if (event.origin !== window.location.origin || !frameWindow || event.source !== frameWindow) return
          const message = event.data
          if (message?.channel !== 'pose-studio-memory-v1') return
          if (message.op === 'get') frameWindow.postMessage({ channel: message.channel, op: 'state', keys }, window.location.origin)
          if (message.op === 'set' && message.keys && typeof message.keys === 'object') {
            const next = {}
            for (const id of ['gemini', 'gpt', 'qwen', 'doubao', 'comfyui']) {
              const value = message.keys[id]
              if (typeof value !== 'string' || value.length > 16384) return
              next[id] = value
            }
            keys = next
          }
        }
        ctx.effect(() => {
          window.addEventListener('message', onMessage)
          return () => { disposed = true; controller?.dispose(); keys = {}; frameWindow = null; window.removeEventListener('message', onMessage) }
        }, 'ai-pose-studio: global controller and memory credentials')
        ctx.slots.inject('main', () => ctx.slots.register({
          name:'main', key:'ai-pose-studio', inject:() => ({}),
        }, GlobalWorkbench))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name:'sidebar.panellist', id:'ai-pose-studio', order:25,
          label:() => '角色工作台',
        }, () => React.createElement('span', { 'aria-hidden': true }, '◈')))
      },
    }
  },
})
