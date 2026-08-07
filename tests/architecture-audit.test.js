import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { analyzeRepository, evaluatePolicy } from '../scripts/architecture-audit-lib.mjs'

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mast-architecture-audit-'))
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return root
}

test('builds importers, exports and line counts for production modules', () => {
  const root = fixture({
    'site/engine/a.js': "import { b } from './b.js'\nexport const a = b + 1\n",
    'site/engine/b.js': 'export const b = 1\n',
    'tests/a.test.js': 'export {}\n',
  })
  const report = analyzeRepository(root)
  assert.equal(report.productionModuleCount, 2)
  assert.deepEqual(
    report.modules.find((item) => item.path === 'site/engine/b.js').importers,
    ['site/engine/a.js'],
  )
  assert.deepEqual(report.modules.find((item) => item.path === 'site/engine/a.js').exports, ['a'])
  assert.equal(report.cycles.length, 0)
})

test('negative fixture detects a circular dependency', () => {
  const root = fixture({
    'site/engine/a.js': "import './b.js'\nexport const a = 1\n",
    'site/engine/b.js': "import './a.js'\nexport const b = 2\n",
  })
  const report = analyzeRepository(root)
  const violations = evaluatePolicy(report, { allowedCycles: [] })
  assert.equal(report.cycles.length, 1)
  assert.ok(violations.some((item) => item.type === 'cycle'))
})

test('negative fixture detects browser coupling in engineering core', () => {
  const root = fixture({
    'site/engine/a.js': 'export function read() { return window.location.href + localStorage.length }\n',
  })
  const violations = evaluatePolicy(analyzeRepository(root), { environmentExceptions: [] })
  assert.ok(violations.some((item) => item.type === 'environment' && item.detail === 'window'))
  assert.ok(violations.some((item) => item.type === 'environment' && item.detail === 'localStorage'))
})

test('Node process access is detected but domain process fields and parameters are not', () => {
  const root = fixture({
    'site/engine/domain.js': "export const weld = { process: 'electrode' }\nexport function choose(process) { return process }\n",
    'site/engine/node-coupled.js': 'export const mode = process.env.NODE_ENV\n',
  })
  const report = analyzeRepository(root)
  const domain = report.modules.find((item) => item.path === 'site/engine/domain.js')
  const nodeCoupled = report.modules.find((item) => item.path === 'site/engine/node-coupled.js')
  assert.ok(!domain.environment.globals.includes('process'))
  assert.ok(nodeCoupled.environment.globals.includes('process'))
  assert.ok(evaluatePolicy(report, {}).some((item) => (
    item.type === 'environment'
    && item.path === 'site/engine/node-coupled.js'
    && item.detail === 'process'
  )))
})

test('explicit exact-path baseline exception suppresses only documented coupling', () => {
  const root = fixture({
    'site/engine/a.js': 'export function read() { return localStorage.length + window.devicePixelRatio }\n',
  })
  const violations = evaluatePolicy(analyzeRepository(root), {
    environmentExceptions: [{
      path: 'site/engine/a.js',
      global: 'localStorage',
      reason: 'migration',
      ownerIssue: '#55',
    }],
  })
  assert.ok(!violations.some((item) => item.detail === 'localStorage'))
  assert.ok(violations.some((item) => item.detail === 'window'))
})
