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

test('builds importers, exports and line counts across packages and web adapter', () => {
  const root = fixture({
    'packages/domain/index.js': "export { b } from './src/b.js'\n",
    'packages/domain/src/b.js': 'export const b = 1\n',
    'packages/application/index.js': "export { a } from './src/a.js'\n",
    'packages/application/src/a.js': "import { b } from '../../domain/index.js'\nexport const a = b + 1\n",
    'apps/web/app.js': "import { a } from '../../packages/application/index.js'\nconsole.log(a)\n",
    'tests/a.test.js': 'export {}\n',
  })
  const report = analyzeRepository(root)
  assert.equal(report.productionModuleCount, 5)
  assert.deepEqual(
    report.modules.find((item) => item.path === 'packages/domain/index.js').importers,
    ['packages/application/src/a.js'],
  )
  assert.deepEqual(report.modules.find((item) => item.path === 'packages/application/src/a.js').exports, ['a'])
  assert.equal(report.cycles.length, 0)
  assert.deepEqual(evaluatePolicy(report, {}), [])
})

test('negative fixture detects a circular dependency', () => {
  const root = fixture({
    'packages/engineering/src/a.js': "import './b.js'\nexport const a = 1\n",
    'packages/engineering/src/b.js': "import './a.js'\nexport const b = 2\n",
  })
  const report = analyzeRepository(root)
  const violations = evaluatePolicy(report, { allowedCycles: [] })
  assert.equal(report.cycles.length, 1)
  assert.ok(violations.some((item) => item.type === 'cycle'))
})

test('negative fixture detects browser coupling in any headless package', () => {
  const root = fixture({
    'packages/design/src/a.js': 'export function read() { return window.location.href + localStorage.length }\n',
  })
  const violations = evaluatePolicy(analyzeRepository(root), { environmentExceptions: [] })
  assert.ok(violations.some((item) => item.type === 'environment' && item.detail === 'window'))
  assert.ok(violations.some((item) => item.type === 'environment' && item.detail === 'localStorage'))
})

test('Node process access is detected but domain process fields and parameters are not', () => {
  const root = fixture({
    'packages/domain/src/domain.js': "export const weld = { process: 'electrode' }\nexport function choose(process) { return process }\n",
    'packages/domain/src/node-coupled.js': 'export const mode = process.env.NODE_ENV\n',
  })
  const report = analyzeRepository(root)
  const domain = report.modules.find((item) => item.path === 'packages/domain/src/domain.js')
  const nodeCoupled = report.modules.find((item) => item.path === 'packages/domain/src/node-coupled.js')
  assert.ok(!domain.environment.globals.includes('process'))
  assert.ok(nodeCoupled.environment.globals.includes('process'))
  assert.ok(evaluatePolicy(report, {}).some((item) => (
    item.type === 'environment'
    && item.path === 'packages/domain/src/node-coupled.js'
    && item.detail === 'process'
  )))
})

test('negative fixture blocks lower-layer import from an upper package', () => {
  const root = fixture({
    'packages/application/index.js': 'export const run = 1\n',
    'packages/domain/src/bad.js': "import { run } from '../../application/index.js'\nexport const bad = run\n",
  })
  const violations = evaluatePolicy(analyzeRepository(root), {})
  assert.ok(violations.some((item) => item.type === 'dependency-direction'))
})

test('negative fixture blocks packages importing apps/web', () => {
  const root = fixture({
    'apps/web/helper.js': 'export const ui = 1\n',
    'packages/application/src/bad.js': "import { ui } from '../../../apps/web/helper.js'\nexport const bad = ui\n",
  })
  const violations = evaluatePolicy(analyzeRepository(root), {})
  assert.ok(violations.some((item) => item.type === 'package-to-web'))
})

test('negative fixture blocks cross-package deep imports while public index is accepted', () => {
  const deep = fixture({
    'packages/domain/index.js': "export * from './src/catalog.js'\n",
    'packages/domain/src/catalog.js': 'export const value = 1\n',
    'packages/application/src/bad.js': "import { value } from '../../domain/src/catalog.js'\nexport const bad = value\n",
  })
  assert.ok(evaluatePolicy(analyzeRepository(deep), {}).some((item) => item.type === 'deep-import'))

  const publicOnly = fixture({
    'packages/domain/index.js': "export * from './src/catalog.js'\n",
    'packages/domain/src/catalog.js': 'export const value = 1\n',
    'packages/application/src/good.js': "import { value } from '../../domain/index.js'\nexport const good = value\n",
  })
  assert.ok(!evaluatePolicy(analyzeRepository(publicOnly), {}).some((item) => item.type === 'deep-import'))
})

test('explicit exact-path exception remains narrow even though v2 baseline uses none', () => {
  const root = fixture({
    'packages/design/src/a.js': 'export function read() { return localStorage.length + window.devicePixelRatio }\n',
  })
  const violations = evaluatePolicy(analyzeRepository(root), {
    environmentExceptions: [{
      path: 'packages/design/src/a.js',
      global: 'localStorage',
      reason: 'temporary migration',
      ownerIssue: '#999',
    }],
  })
  assert.ok(!violations.some((item) => item.detail === 'localStorage'))
  assert.ok(violations.some((item) => item.detail === 'window'))
})
