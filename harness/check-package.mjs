import { readFile, stat } from 'node:fs/promises'
const root = new URL('./', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json',root),'utf8'))
if (manifest.engines?.dsh !== '0.2.2-rc.1') throw new Error('Package must declare the reviewed Harness 0.2.2-rc.1 target')
const required = ['index.mjs','compatibility.mjs','server.mjs','client.js','workbench.mjs','cordis.patch.yml','LICENSE','README.md','GLOBAL-WORKBENCH.md','THIRD_PARTY_NOTICES.md','app/index.html','app/licenses/index.json']
const missing = []
for (const file of required) if (!(await stat(new URL(file,root)).then(s=>s.isFile()).catch(()=>false))) missing.push(file)
if (missing.length) { console.error('Package is not ready. Missing: '+missing.join(', ')); process.exitCode = 1 }
else {
  const html=await readFile(new URL('app/index.html',root),'utf8')
  if (!html.includes('/api/ai-pose-studio/app/')) { console.error('Incorrect Harness asset base'); process.exitCode=1 }
  else console.log('Package files present. This is not a Harness runtime or provider integration test.')
}
