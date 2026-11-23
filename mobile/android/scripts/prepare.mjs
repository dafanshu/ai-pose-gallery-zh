import { createHash } from 'node:crypto'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const project = join(root, 'android')
const cli = join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor')
function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Capacitor ${args.join(' ')} failed (${result.status ?? result.error?.code ?? 'unknown'})`)
}
if (!existsSync(cli)) throw new Error('Run npm ci in mobile/android first.')
if (!existsSync(join(root, 'www', 'index.html'))) throw new Error('Build the Android frontend into mobile/android/www before preparing the native project.')
if (!existsSync(project)) run('add', 'android')
const wrapper = join(project, 'gradle', 'wrapper', 'gradle-wrapper.jar')
if (!existsSync(wrapper)) throw new Error('Generated Android project is incomplete. Move the ignored android directory aside and retry.')
const sha = createHash('sha256').update(readFileSync(wrapper)).digest('hex')
// https://gradle.org/release-checksums/ (Gradle 8.14.3 Wrapper JAR)
if (sha !== '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172') throw new Error('Unexpected Gradle Wrapper checksum. Do not run the generated wrapper.')
cpSync(join(root, 'native'), project, { recursive: true })
run('sync', 'android')
console.log('Role Studio Android project ready. Use the Gradle wrapper in mobile/android/android.')
