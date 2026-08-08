import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(testRoot) === '.build' ? path.dirname(testRoot) : testRoot
const emittedRoot = path.basename(testRoot) === '.build' ? testRoot : path.join(sourceRoot, '.build')
const desktopRoot = path.join(sourceRoot, '_desktop')
const desktopAvailable = fs.existsSync(path.join(desktopRoot, 'packages', 'application', 'index.js'))
const applicationUrl = pathToFileURL(path.join(emittedRoot, 'packages', 'application', 'index.js')).href
const harnessUrl = pathToFileURL(path.join(sourceRoot, 'apps', 'desktop', 'adapter-harness.mjs')).href
const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))

const application = await import(applicationUrl)
const desktopHarness = desktopAvailable ? await import(harnessUrl) : null

function compactProject() {
  return application.createProjectInput({
    geometry: {
      moduleCount: 2,
      moduleDiametersMm: [16, 12],
    },
    environment: {
      windPresetId: 'custom',
      windPressurePa: 250,
      windEnvelopeEnabled: false,
      lateralCapacityStepDeg: 60,
    },
    criteria: { heightSearchMaxModules: 2 },
  })
}

test('Desktop packaged WebView core is exactly equivalent to direct application summary', { skip: !desktopAvailable }, async () => {
  const projectPackage = application.createProjectPackage(compactProject(), {
    metadata: { name: 'Desktop oracle' },
  })
  const text = application.serializeProjectPackage(projectPackage)
  const provenance = {
    toolVersion: String(packageJson.version),
    coreVersion: String(packageJson.version),
    command: 'desktop-calculate',
  }
  const direct = application.createBareResultSummary(
    projectPackage,
    application.calculateProject(projectPackage.project),
    { provenance },
  )
  const desktop = await desktopHarness.calculateDesktopSummary(text, provenance)
  assert.deepEqual(desktop, direct)
})

test('Desktop generated tree contains the same calculation Worker and no second solver package', { skip: !desktopAvailable }, () => {
  const desktopWorker = fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'calculation-worker.js'), 'utf8')
  const sourceWorker = fs.readFileSync(path.join(sourceRoot, 'apps', 'web', 'calculation-worker.js'), 'utf8')
  assert.equal(desktopWorker, sourceWorker)
  assert.match(desktopWorker, /calculateProject/)
  assert.match(desktopWorker, /optimizeAndCalculateProject/)
  assert.equal(fs.existsSync(path.join(sourceRoot, 'apps', 'desktop', 'packages')), false)
})

test('Desktop build is self-contained with emitted packages and local entrypoints', { skip: !desktopAvailable }, () => {
  for (const relative of [
    'index.html',
    'apps/web/index.html',
    'apps/web/app-bootstrap.js',
    'apps/web/file-adapter.js',
    'packages/application/index.js',
    'packages/design/index.js',
    'packages/reporting/index.js',
    'desktop-build-info.json',
  ]) {
    assert.equal(fs.existsSync(path.join(desktopRoot, relative)), true, `missing desktop asset: ${relative}`)
  }
  const desktopAdapter = fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'file-adapter.js'), 'utf8')
  assert.match(desktopAdapter, /environment:\s*'tauri'/)
})
