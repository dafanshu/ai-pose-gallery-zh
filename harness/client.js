/* Host React is used only for this small shell. The full React 19 app has its own document. */
window.__ModuleLoader__.load({
  id: 'dsh-ai-pose-studio',
  factory: (require) => {
    const React = require('react')
    const APP = '/api/ai-pose-studio/app/'
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
        missing.length ? React.createElement('p', { role:'alert', style:{padding:8,margin:0} }, '缺少 ' + missing.length + ' 个图库数据文件。请在主机配置 assetRoot 指向完整图库仓库；上传图片仍可使用。') : null,
        React.createElement('iframe', { title:'角色合成工作台', src:APP, style:{border:0,flex:1,width:'100%',minHeight:500}, referrerPolicy:'no-referrer', allow:'clipboard-write' }))
    }
    return {
      name:'dsh-ai-pose-studio-client', inject:['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name:'conversation.view', id:'ai-pose-studio', order:25,
          label:() => '角色工作台', inject:() => ({}),
        }, Workbench))
      },
    }
  },
})
