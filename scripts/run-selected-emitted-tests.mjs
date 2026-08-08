import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const emittedRoot = path.join(root, '.build')
const selectedTests = process.argv.slice(2)

if (selectedTests.length === 0) {
  throw new Error('At least one emitted-runtime test path is required')
}

execFileSync(process.execPath, ['scripts/build-test-runtime.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

execFileSync(process.execPath, ['--test', ...selectedTests], {
  cwd: emittedRoot,
  stdio: 'inherit',
})
