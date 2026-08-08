import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.basename(testRoot) === '.build' ? path.dirname(testRoot) : testRoot
const packagesRoot = path.join(root, 'packages')

function collectFiles(directory, predicate) {
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, predicate))
      continue
    }
    if (predicate(entry.name)) files.push(absolute)
  }
  return files.sort()
}

test('canonical packages contain TypeScript source only', () => {
  const javaScriptSources = collectFiles(packagesRoot, (name) => /\.(?:js|mjs|cjs)$/.test(name))
    .map((file) => path.relative(root, file))
  assert.deepEqual(
    javaScriptSources,
    [],
    'packages/ must not retain JavaScript implementations or compatibility wrappers after #62',
  )
})

test('core emit cannot fall back to JavaScript source', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.build.json'), 'utf8'))
  assert.equal(config.compilerOptions?.allowJs, undefined)
  assert.deepEqual(config.include, ['packages/**/*.ts'])
})

test('removed flat parameter transition API cannot return to production packages', () => {
  const forbidden = /\b(?:DEFAULT_PARAMETERS|resolveCalculationParameters)\b/
  const offenders = collectFiles(packagesRoot, (name) => /\.ts$/.test(name))
    .filter((file) => forbidden.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
  assert.deepEqual(
    offenders,
    [],
    'flat parameter transition API must remain physically absent from production TypeScript',
  )
})
