// Run after the approved frontend build. Copies notices, not data or credentials.
import { createRequire } from 'node:module'
import { readFile, readdir, realpath, mkdir, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const destination=path.join(root,'harness/app/licenses')
await mkdir(destination,{recursive:true})
const app=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'))
const queue=Object.keys(app.dependencies || {}).map(name=>({name,from:root,required:true}))
const seen=new Set(), notices=[]
while(queue.length){
  const {name,from,required}=queue.shift()
  let directory
  try {
    // Resolve package directories using Node's own search locations, including pnpm symlinks.
    const require=createRequire(path.join(from,'package.json'))
    const locations=require.resolve.paths(name) || []
    for(const location of locations){try { directory=await realpath(path.join(location,name)); break }catch{}}
    if(!directory) throw Error('not installed')
  }catch{if(required) throw Error('Missing build dependency: '+name);else continue}
  if(seen.has(directory))continue;seen.add(directory)
  const manifest=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'))
  const files=(await readdir(directory)).filter(file=>/^(?:LICEN[CS]E|COPYING|NOTICE|OFL)(?:\..*)?$/i.test(file))
  const folder=(manifest.name+'@'+manifest.version).replace(/[^a-zA-Z0-9._@-]/g,'_')
  await mkdir(path.join(destination,folder),{recursive:true})
  for(const file of files) await copyFile(path.join(directory,file),path.join(destination,folder,file))
  notices.push({name:manifest.name,version:manifest.version,license:manifest.license || 'SEE PACKAGE',files:files.map(file=>folder+'/'+file)})
  for(const child of Object.keys({...manifest.dependencies,...manifest.peerDependencies})) queue.push({name:child,from:directory,required:false})
}
await writeFile(path.join(destination,'index.json'),JSON.stringify(notices,null,2)+'\n')
console.log('Preserved notices for '+notices.length+' installed packages. Review entries without license files before redistribution.')
