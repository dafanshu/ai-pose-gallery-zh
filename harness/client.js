/* Host React is used only for this small shell. The full React 19 app has its own document. */
window.__ModuleLoader__.load({
  id: 'dsh-ai-pose-studio',
  factory: (require) => {
    const React = require('react')
    const APP = '/api/ai-pose-studio/app/'
    let vault
    const connectFrame = node => vault?.connect(node?.contentWindow || null)
    const clearKeys = () => vault?.clear()
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
      return React.createElement('section', { style:{height:'100%',minHeight:0,display:'flex',flexDirection:'column',width:'100%',minWidth:0} },
        React.createElement('details', { style: { padding: '4px 16px', flexShrink: 0 } },
          React.createElement('summary', { style: { cursor: 'pointer', fontSize: 12 } }, '密钥与任务说明'),
          React.createElement('p', { style: { margin: '8px 0' } }, '运行中的密钥暂存于窗口内存，刷新、断线或停用插件后清除。可在 API 配置中显式加密保存，重启后用口令解锁；下方按钮只清空内存，不删除加密记录。云端生图尚不保证跨左侧页面卸载继续跟踪。'),
          React.createElement('button', { type: 'button', onClick: clearKeys }, '清除本窗口的供应商密钥')),
        missing.length ? React.createElement('p', { role:'alert', style:{padding:8,margin:0} }, '缺少 ' + missing.length + ' 个图库数据文件。请在主机配置 assetRoot 指向完整图库仓库；上传图片仍可使用。') : null,
        React.createElement('iframe', { ref: connectFrame, title:'角色合成工作台', src:APP, style:{border:0,flex:1,width:'100%',minHeight:0}, referrerPolicy:'no-referrer', allow:'clipboard-write' }))
    }
    return {
      name:'dsh-ai-pose-studio-client', inject:['slots', 'sessions', 'remote', 'remote.session', 'connection'],
      apply(ctx) {
        let disposed = false, controller
        const module = import('/api/ai-pose-studio/workbench.mjs').then(api => {
          if (disposed) throw new Error('角色工作台已停用')
          vault = api.createKeyVault(window.location.origin)
          const host = api.hostAdapter(ctx)
          controller = api.createController(api.browserStore(window.indexedDB), host, undefined, () => api.readStudioHistory(window.indexedDB))
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
        const onMessage = event => vault?.handle(event)
        ctx.effect(() => {
          window.addEventListener('message', onMessage)
          const release = ctx.connection.generation.subscribe(() => {
            if (ctx.connection.generation.getSnapshot() === undefined) vault?.clear()
          })
          return () => { disposed = true; controller?.dispose(); vault?.dispose(); release(); window.removeEventListener('message', onMessage) }
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
