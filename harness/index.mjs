import { assertHostContract } from './compatibility.mjs'
import { configuration, createHandler, createUpgrade, BASE } from './server.mjs'

export const name = 'dsh-ai-pose-studio'
export const inject = ['webServer', 'connection']

/** Only consumes documented host services; has no install hooks or startup network calls. */
export function apply(ctx, raw = {}) {
  const capabilities = assertHostContract(ctx)
  const config = configuration(raw)
  const webSocket = capabilities.comfyWebSocket
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: BASE,
    handler: createHandler(config, ctx.connection, { comfyWebSocket:webSocket }),
  }), 'ai-pose-studio: authenticated workbench')
  if (webSocket) ctx.effect(() => {
    const handler = createUpgrade(config,ctx.connection)
    const unregister = ctx.webServer.registerUpgrade({path: BASE + '/comfy/ws', handler})
    return () => { unregister(); handler.dispose() }
  }, 'ai-pose-studio: authenticated ComfyUI progress')
}
