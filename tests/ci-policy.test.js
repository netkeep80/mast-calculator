import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowDir = path.join(root, '.github', 'workflows')
const workflowFiles = fs.readdirSync(workflowDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort()
const workflows = new Map(workflowFiles.map((name) => [name, fs.readFileSync(path.join(workflowDir, name), 'utf8')]))

function jobBlocks(workflow) {
  const jobsIndex = workflow.indexOf('\njobs:')
  assert.notEqual(jobsIndex, -1, 'workflow должен содержать jobs')
  const lines = workflow.slice(jobsIndex + '\njobs:'.length).split(/\r?\n/)
  const jobs = []
  let current = null
  for (const line of lines) {
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*$/)
    if (match) {
      if (current) jobs.push(current)
      current = { name: match[1], block: '' }
      continue
    }
    if (current) current.block += `${line}\n`
  }
  if (current) jobs.push(current)
  return jobs
}

test('CI/CD workflows используют least-privilege contents: read по умолчанию', () => {
  for (const [name, workflow] of workflows) {
    assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/, `${name}: нет contents: read`)
  }
})

test('все jobs с runner имеют явный timeout-minutes', () => {
  for (const [filename, workflow] of workflows) {
    for (const job of jobBlocks(workflow)) {
      if (!/runs-on:/.test(job.block)) continue
      assert.match(job.block, /timeout-minutes:\s*\d+/, `${filename}/${job.name}: отсутствует timeout`)
    }
  }
})

test('используются современные версии базовых GitHub Actions без Node 20 warning', () => {
  const all = [...workflows.values()].join('\n')
  assert.doesNotMatch(all, /actions\/checkout@v[1-5](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/setup-node@v[1-5](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/configure-pages@v[1-5](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/upload-pages-artifact@v[1-4](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/deploy-pages@v[1-4](?:\s|$)/)
  assert.match(all, /actions\/checkout@v6/)
  assert.match(all, /actions\/setup-node@v6/)
})

test('все Node jobs используют Node.js 24.x', () => {
  for (const [name, workflow] of workflows) {
    if (/actions\/setup-node/.test(workflow)) {
      assert.match(workflow, /node-version:\s*['"]24\.x['"]/, `${name}: требуется Node 24.x`)
      assert.doesNotMatch(workflow, /node-version:\s*22/)
    }
  }
})

test('PR CI содержит fresh-merge simulation и три ОС', () => {
  const ci = workflows.get('ci.yml')
  assert.ok(ci)
  assert.match(ci, /scripts\/simulate-fresh-merge\.sh/)
  assert.match(ci, /ubuntu-latest, macos-latest, windows-latest/)
  assert.match(ci, /fail-fast:\s*false/)
})

test('полный regression suite имеет одного владельца, а OS matrix проверяет canonical equivalence', () => {
  const ci = workflows.get('ci.yml')
  const architecture = workflows.get('architecture.yml')
  assert.ok(ci)
  assert.ok(architecture)
  assert.equal((ci.match(/run:\s*npm test\s*$/gm) ?? []).length, 1, 'ci.yml должен запускать полный npm test ровно один раз')
  assert.doesNotMatch(architecture, /run:\s*npm test\s*$/m, 'architecture.yml не должен дублировать полный engineering suite')
  assert.match(ci, /platform-equivalence:/)
  assert.match(ci, /name:\s*Canonical equivalence \(\$\{\{ matrix\.os \}\}\)/)
  assert.match(ci, /npm run test:platform/)
})

test('PR CI имеет отдельный gate сравнения трёх независимых FEM путей', () => {
  const ci = workflows.get('ci.yml')
  assert.ok(ci)
  assert.match(ci, /triple-fem:/)
  assert.match(ci, /name:\s*Triple FEM equivalence/)
  assert.match(ci, /npm run test:triple/)
})

test('PR CI имеет отдельный gate физического конфигуратора соединительного узла', () => {
  const ci = workflows.get('ci.yml')
  assert.ok(ci)
  assert.match(ci, /joint-configurator:/)
  assert.match(ci, /name:\s*Joint configurator/)
  assert.match(ci, /npm run test:joint/)
  assert.match(ci, /two-nut physical joint/i)
})

test('issue #33 имеет отдельный обязательный gate усиленной прочности и 3D-геометрии узла', () => {
  const workflow = workflows.get('joint-strength.yml')
  assert.ok(workflow, 'отсутствует joint-strength.yml')
  assert.match(workflow, /name:\s*Joint strength checks/)
  assert.match(workflow, /name:\s*Joint strength and visualization/)
  assert.match(workflow, /npm run test:joint-strength/)
  assert.match(workflow, /nut sections, weld area, preload, bolt shear and 3D geometry/i)
  assert.match(workflow, /scripts\/simulate-fresh-merge\.sh/)
})

test('PR CI имеет отдельный gate аналитической статики трёх опор', () => {
  const ci = workflows.get('ci.yml')
  assert.ok(ci)
  assert.match(ci, /support-statics:/)
  assert.match(ci, /name:\s*Support reaction statics/)
  assert.match(ci, /npm run test:statics/)
  assert.match(ci, /analytical three-support reaction oracles/i)
})

test('PR CI отдельно проверяет сценарии, справочники и сборочную массу', () => {
  const ci = workflows.get('ci.yml')
  assert.ok(ci)
  assert.match(ci, /usage-ux:/)
  assert.match(ci, /name:\s*Usage scenarios and reference catalogs/)
  assert.match(ci, /npm run test:ux/)
  assert.match(ci, /assembly mass and single-source catalogs/i)
})

test('static-site smoke собирает Web adapter вместе с публичными package API', () => {
  const ci = workflows.get('ci.yml')
  assert.ok(ci)
  assert.match(ci, /npm run build:web/)
  for (const modulePath of [
    'apps/web/app.js',
    'apps/web/calculation-worker.js',
    'apps/web/viewer.js',
    'apps/web/design-app.js',
    'apps/web/design-storage.js',
    'packages/domain/index.js',
    'packages/numerics/index.js',
    'packages/structural-analysis/index.js',
    'packages/engineering/index.js',
    'packages/application/index.js',
    'packages/design/index.js',
    'packages/reporting/index.js',
  ]) assert.ok(ci.includes(modulePath), `ci.yml smoke не проверяет ${modulePath}`)
  assert.match(ci, /<title>Калькулятор мачты<\/title>/)
  assert.match(ci, /Проверить конкретную мачту/)
  assert.doesNotMatch(ci, /--directory site\b/)
})

test('Pages deploy собирает apps/web + packages через canonical build:web', () => {
  const pages = workflows.get('pages.yml')
  assert.ok(pages)
  assert.match(pages, /actions\/configure-pages@v6/)
  assert.match(pages, /actions\/upload-pages-artifact@v5/)
  assert.match(pages, /actions\/deploy-pages@v5/)
  assert.match(pages, /group:\s*main-writer-\$\{\{ github\.repository \}\}-pages/)
  assert.match(pages, /cancel-in-progress:\s*false/)
  assert.match(pages, /pages:\s*write/)
  assert.match(pages, /id-token:\s*write/)
  assert.match(pages, /npm run build:web/)
  assert.match(pages, /_site\/apps\/web\/build-info\.json/)
  assert.doesNotMatch(pages, /cp -R site|cp logo\.jpg _site\/logo\.jpg/)
})

test('каждый workflow сохраняет явную Git default branch конфигурацию', () => {
  for (const [name, workflow] of workflows) {
    assert.match(workflow, /GIT_CONFIG_KEY_0:\s*init\.defaultBranch/, `${name}: нет GIT_CONFIG_KEY_0`)
    assert.match(workflow, /GIT_CONFIG_VALUE_0:\s*main/, `${name}: нет GIT_CONFIG_VALUE_0`)
  }
})
