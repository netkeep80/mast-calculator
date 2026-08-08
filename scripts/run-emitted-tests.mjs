import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const emittedRoot = path.join(root, '.build')

execFileSync(process.execPath, ['scripts/build-test-runtime.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

execFileSync(process.execPath, ['--test'], {
  cwd: emittedRoot,
  stdio: 'inherit',
})
