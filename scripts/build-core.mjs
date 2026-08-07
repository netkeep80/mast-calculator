import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const output = path.join(root, '.build')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

fs.rmSync(output, { recursive: true, force: true })
execFileSync(npx, [
  '--yes',
  '--package', 'typescript@7.0.2',
  'tsc',
  '-p', 'tsconfig.build.json',
], {
  cwd: root,
  stdio: 'inherit',
})

const packageOutput = path.join(output, 'packages')
if (!fs.existsSync(packageOutput)) throw new Error('TypeScript build did not emit .build/packages')
console.log(`Core TypeScript emit ready: ${path.relative(root, packageOutput)}`)
