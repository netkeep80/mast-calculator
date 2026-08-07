import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const output = path.join(root, '.build')

execFileSync(process.execPath, ['scripts/build-core.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

const excluded = new Set([
  '.git',
  '.build',
  '_site',
  'node_modules',
  'packages',
])

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue
  const source = path.join(root, entry.name)
  const destination = path.join(output, entry.name)
  if (entry.isDirectory()) fs.cpSync(source, destination, { recursive: true })
  else if (entry.isFile()) fs.copyFileSync(source, destination)
}

if (!fs.existsSync(path.join(output, 'tests'))) throw new Error('Test runtime mirror is missing tests/')
if (!fs.existsSync(path.join(output, 'apps', 'web'))) throw new Error('Test runtime mirror is missing apps/web')
if (!fs.existsSync(path.join(output, 'packages', 'application', 'index.js'))) {
  throw new Error('Test runtime mirror is missing emitted application entrypoint')
}

console.log('Emitted test runtime ready: .build (compiled packages + mirrored adapters/tests/config)')
