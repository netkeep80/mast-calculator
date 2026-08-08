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
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const scripts = packageJson.scripts ?? {}
const durableDocs = new Map([
  ['README.md', fs.readFileSync(path.join(root, 'README.md'), 'utf8')],
  ['CONTRIBUTING.md', fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8')],
  ['AGENTS.md', fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')],
])

function jobBlocks(workflow) {
  const jobsIndex = workflow.indexOf('\njobs:')
  assert.notEqual(jobsIndex, -1, 'workflow must contain jobs')
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

function npmRunReferences(text) {
  return [...text.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)].map((match) => match[1])
}

test('CI/CD workflows use least-privilege contents: read by default', () => {
  for (const [name, workflow] of workflows) {
    assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/, `${name}: missing top-level contents: read`)
  }
})

test('every runner job has an explicit timeout', () => {
  for (const [filename, workflow] of workflows) {
    for (const job of jobBlocks(workflow)) {
      if (!/runs-on:/.test(job.block)) continue
      assert.match(job.block, /timeout-minutes:\s*\d+/, `${filename}/${job.name}: missing timeout`)
    }
  }
})

test('workflows use the current Node 24 / GitHub Actions generations', () => {
  const all = [...workflows.values()].join('\n')
  assert.doesNotMatch(all, /actions\/checkout@v[1-5](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/setup-node@v[1-5](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/configure-pages@v[1-5](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/upload-pages-artifact@v[1-4](?:\s|$)/)
  assert.doesNotMatch(all, /actions\/deploy-pages@v[1-4](?:\s|$)/)
  assert.match(all, /actions\/checkout@v6/)
  assert.match(all, /actions\/setup-node@v6/)
  for (const [name, workflow] of workflows) {
    if (!/actions\/setup-node/.test(workflow)) continue
    assert.match(workflow, /node-version:\s*['"]24\.x['"]/, `${name}: Node jobs must use 24.x`)
  }
})

test('primary PR CI has one functional regression owner and durable responsibility gates', () => {
  const ci = workflows.get('ci.yml')
  assert.ok(ci)
  assert.match(ci, /scripts\/simulate-fresh-merge\.sh/)
  assert.equal((ci.match(/run:\s*npm test\s*$/gm) ?? []).length, 1, 'full npm test must run exactly once')
  for (const job of ['quality', 'security', 'regression', 'performance', 'platform-equivalence', 'static-site']) {
    assert.match(ci, new RegExp(`^  ${job}:`, 'm'), `ci.yml missing ${job}`)
  }
  assert.doesNotMatch(ci, /^  (?:triple-fem|joint-configurator|support-statics|usage-ux):/m)
  assert.match(ci, /npm run test:performance/)
  assert.match(ci, /scripts\/check-build-budgets\.mjs/)
  assert.match(ci, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/)
  assert.match(ci, /npm run test:platform/)
  assert.match(ci, /npm run build:web/)
})

test('architecture workflow enforces boundaries without rerunning the functional suite', () => {
  const architecture = workflows.get('architecture.yml')
  assert.ok(architecture)
  assert.match(architecture, /npm run typecheck/)
  assert.match(architecture, /npm run test:architecture/)
  assert.match(architecture, /npm run audit:architecture/)
  assert.doesNotMatch(architecture, /npm (?:test|run test:emitted|run test:contracts)/)
})

test('migration-era issue workflows are gone after Foundation purge', () => {
  for (const [filename, workflow] of workflows) {
    assert.doesNotMatch(filename, /^issue\d+\.ya?ml$/i, `${filename}: issue-number workflow must be folded into durable gates`)
    assert.doesNotMatch(
      workflow,
      /name:\s*(?:Joint strength checks|Static load simplification checks|3D and construction documentation)/,
      `${filename}: migration-era workflow must be folded into durable gates`,
    )
  }
})

test('npm run references resolve to current scripts', () => {
  for (const [name, text] of [...workflows, ...durableDocs]) {
    for (const script of npmRunReferences(text)) {
      assert.ok(Object.hasOwn(scripts, script), `${name}: references removed npm script ${script}`)
    }
  }
})

test('focused test scripts have a durable CI or contributor-facing owner', () => {
  const ownershipText = [
    ...workflows.values(),
    ...durableDocs.values(),
  ].join('\n')
  const forbiddenMigrationAliases = /^(?:test:(?:emitted|foundation|properties|canonical|triple|joint|joint-strength|issue\d+|statics|ux|mixed-diameters|guys|obj|viewer))$/
  for (const script of Object.keys(scripts).filter((name) => name.startsWith('test:')).sort()) {
    assert.doesNotMatch(script, forbiddenMigrationAliases, `${script}: migration-era alias should be deleted`)
    assert.match(ownershipText, new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), `${script}: no durable CI/docs owner`)
  }
})

test('static-site smoke serves the canonical Web adapter and public package APIs', () => {
  const ci = workflows.get('ci.yml')
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
  ]) assert.ok(ci.includes(modulePath), `ci.yml smoke missing ${modulePath}`)
  assert.match(ci, /<title>Калькулятор мачты<\/title>/)
  assert.match(ci, /Проверить конкретную мачту/)
})

test('Pages deploy uses canonical build:web and explicit writer concurrency', () => {
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
})

test('release write permission is scoped to the publish job only', () => {
  const release = workflows.get('desktop-release.yml')
  assert.ok(release)
  assert.match(release, /permissions:\s*\n\s+contents:\s*read/)
  assert.match(release, /publish:[\s\S]*?permissions:\s*\n\s+contents:\s*write/)
})

test('every workflow preserves explicit Git default-branch configuration', () => {
  for (const [name, workflow] of workflows) {
    assert.match(workflow, /GIT_CONFIG_KEY_0:\s*init\.defaultBranch/, `${name}: missing GIT_CONFIG_KEY_0`)
    assert.match(workflow, /GIT_CONFIG_VALUE_0:\s*main/, `${name}: missing GIT_CONFIG_VALUE_0`)
  }
})
