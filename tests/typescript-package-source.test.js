import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.basename(testRoot) === '.build' ? path.dirname(testRoot) : testRoot
const packagesRoot = path.join(root, 'packages')

function collectJavaScriptSources(directory) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptSources(absolute))
      continue
    }
    if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path.relative(root, absolute))
  }
  return files.sort()
}

test('canonical packages contain TypeScript source only', () => {
  assert.deepEqual(
    collectJavaScriptSources(packagesRoot),
    [],
    'packages/ must not retain JavaScript implementations or compatibility wrappers after #62',
  )
})

test('core emit cannot fall back to JavaScript source', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.build.json'), 'utf8'))
  assert.equal(config.compilerOptions?.allowJs, undefined)
  assert.deepEqual(config.include, ['packages/**/*.ts'])
})
