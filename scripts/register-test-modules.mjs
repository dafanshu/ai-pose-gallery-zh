// Run the source-level request tests on Node.js 24+ without third-party packages.
import { existsSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const sourceRoot = new URL('../src/', import.meta.url)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const url = new URL(specifier.slice(2), sourceRoot)
      if (!existsSync(url) && existsSync(`${url.pathname}.ts`)) url.pathname += '.ts'
      return nextResolve(url.href, context)
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL)
      if (!existsSync(url) && existsSync(`${url.pathname}.ts`)) return nextResolve(`${url.href}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    // Vite permits JSON imports without an import attribute.
    if (url.startsWith(sourceRoot.href) && url.endsWith('.json')) {
      const json = JSON.parse(readFileSync(new URL(url), 'utf8'))
      return { format: 'module', source: `export default ${JSON.stringify(json)}`, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
