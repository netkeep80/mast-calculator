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
const moduleUrl = (root, packageName) => pathToFileURL(path.join(root, 'packages', packageName, 'index.js')).href
const applicationUrl = moduleUrl(emittedRoot, 'application')
const designUrl = moduleUrl(emittedRoot, 'design')
const reportingUrl = moduleUrl(emittedRoot, 'reporting')
const harnessUrl = pathToFileURL(path.join(sourceRoot, 'apps', 'desktop', 'adapter-harness.mjs')).href
const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))

const application = await import(applicationUrl)
const design = await import(designUrl)
const reporting = await import(reportingUrl)
const desktopApplication = desktopAvailable ? await import(moduleUrl(desktopRoot, 'application')) : null
const desktopDesign = desktopAvailable ? await import(moduleUrl(desktopRoot, 'design')) : null
const desktopReporting = desktopAvailable ? await import(moduleUrl(desktopRoot, 'reporting')) : null
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

test('Desktop packaged core produces byte-identical design/report/export artifacts', { skip: !desktopAvailable }, () => {
  const project = compactProject()
  const desktopProject = desktopApplication.createProjectInput(project)
  const directResult = application.calculateProject(project)
  const desktopResult = desktopApplication.calculateProject(desktopProject)
  const createdAt = '2026-08-08T12:00:00.000Z'
  const source = {
    repository: 'netkeep80/mast-calculator',
    ref: 'refs/heads/oracle',
    sha: '0123456789abcdef',
  }
  const buildInfo = { ...source, runId: 'desktop-oracle' }

  const directDesignPackage = application.createDesignPackage(directResult, { createdAt, ...source })
  const desktopDesignPackage = desktopApplication.createDesignPackage(desktopResult, { createdAt, ...source })
  assert.equal(
    design.serializeDesignPackage(directDesignPackage),
    desktopDesign.serializeDesignPackage(desktopDesignPackage),
  )
  assert.equal(design.createMastObj(directResult), desktopDesign.createMastObj(desktopResult))
  assert.equal(
    reporting.createEskdConstructionDocumentationHtml(directResult),
    desktopReporting.createEskdConstructionDocumentationHtml(desktopResult),
  )
  assert.equal(
    reporting.createCalculationProjectHtml(directResult, directResult.parameters, createdAt, buildInfo),
    desktopReporting.createCalculationProjectHtml(desktopResult, desktopResult.parameters, createdAt, buildInfo),
  )

  const directProcurement = application.createProcurementEstimateFromCalculation(directResult)
  const desktopProcurement = desktopApplication.createProcurementEstimateFromCalculation(desktopResult)
  assert.deepEqual(desktopProcurement, directProcurement)
  assert.equal(
    design.createProcurementEstimateHtml(directProcurement, createdAt),
    desktopDesign.createProcurementEstimateHtml(desktopProcurement, createdAt),
  )
})

test('Desktop generated tree contains the same calculation Worker/controller and no second solver package', { skip: !desktopAvailable }, () => {
  for (const file of ['calculation-worker.js', 'calculation-controller.js']) {
    const desktopSource = fs.readFileSync(path.join(desktopRoot, 'apps', 'web', file), 'utf8')
    const source = fs.readFileSync(path.join(sourceRoot, 'apps', 'web', file), 'utf8')
    assert.equal(desktopSource, source)
  }
  const desktopWorker = fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'calculation-worker.js'), 'utf8')
  const desktopController = fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'calculation-controller.js'), 'utf8')
  assert.match(desktopWorker, /calculateProject/)
  assert.match(desktopWorker, /optimizeAndCalculateProject/)
  assert.match(desktopController, /\.terminate\(\)/)
  assert.equal(fs.existsSync(path.join(sourceRoot, 'apps', 'desktop', 'packages')), false)
})

test('Desktop build is self-contained with emitted packages and local entrypoints', { skip: !desktopAvailable }, () => {
  for (const relative of [
    'index.html',
    'apps/web/index.html',
    'apps/web/app-bootstrap.js',
    'apps/web/file-adapter.js',
    'apps/web/runtime-info.js',
    'packages/application/index.js',
    'packages/design/index.js',
    'packages/reporting/index.js',
    'desktop-build-info.json',
  ]) {
    assert.equal(fs.existsSync(path.join(desktopRoot, relative)), true, `missing desktop asset: ${relative}`)
  }
  const desktopAdapter = fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'file-adapter.js'), 'utf8')
  const buildInfo = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'build-info.json'), 'utf8'))
  assert.match(desktopAdapter, /environment:\s*'tauri'/)
  assert.equal(buildInfo.adapter, 'tauri')
  assert.equal(buildInfo.appVersion, String(packageJson.version))
  assert.equal(buildInfo.coreVersion, String(packageJson.version))
})
