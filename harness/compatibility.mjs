/** Reviewed target, not a claim that the installed Host has been probed end-to-end. */
export const HARNESS_TARGET = '0.2.2-rc.1'
export const HARNESS_SOURCE = '66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db'
export const HARNESS_TAG = 'dsh-v0.2.2-rc.1'

/** Fail before registering surfaces if the target's security/service contracts are unavailable. */
export function assertHostContract(ctx) {
  if (typeof ctx?.effect !== 'function' || typeof ctx?.webServer?.register !== 'function') {
    throw new Error(`Role studio targets Harness ${HARNESS_TARGET} web profile: webServer.register and Context.effect are required`)
  }
  if (typeof ctx?.connection?.admit !== 'function') {
    throw new Error(`Role studio targets Harness ${HARNESS_TARGET}: connection.admit owner admission is required; authentication is never disabled`)
  }
  return { comfyWebSocket: typeof ctx.webServer.registerUpgrade === 'function' }
}
