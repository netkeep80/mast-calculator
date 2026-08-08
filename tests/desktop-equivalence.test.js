import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { calculateBuiltAdapterSummary } from './support/built-adapter-harness.mjs'

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(testRoot) === '.build' ? path.dirname(testRoot) : testRoot
const emittedRoot = path.basename(testRoot) === '.build' ? testRoot : path.join(sourceRoot, '.build')
const webRoot = path.join(sourceRoot, '_site')
const desktopRoot = path.join(sourceRoot, '_desktop')
const webAvailable = fs.existsSync(path.join(webRoot, 'packages', 'application', 'index.js'))
const desktopAvailable = fs.existsSync(path.join(desktopRoot, 'packages', 'application', 'index.js'))
const adaptersAvailable = webAvailable && desktopAvailable
const moduleUrl = (root, packageName) => pathToFileURL(path.join(root, 'packages', packageName, 'index.js')).href
const applicationUrl = moduleUrl(emittedRoot, 'application')
const designUrl = moduleUrl(emittedRoot, 'design')
const reportingUrl = moduleUrl(emittedRoot, 'reporting')
const cliPath = path.join(sourceRoot, 'apps', 'cli', 'mast-calc.mjs')
const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))

const application = await import(applicationUrl)
const design = await import(designUrl)
const reporting = await import(reportingUrl)
const desktopApplication = desktopAvailable ? await import(moduleUrl(desktopRoot, 'application')) : null
const desktopDesign = desktopAvailable ? await import(moduleUrl(desktopRoot, 'design')) : null
const desktopReporting = desktopAvailable ? await import(moduleUrl(desktopRoot, 'reporting')) : null

const FAST_ENVIRONMENT = Object.freeze({
  windPresetId: 'custom',
  windPressurePa: 250,
  windEnvelopeEnabled: false,
  lateralCapacityStepDeg: 60,
})
const FAST_CRITERIA = Object.freeze({ heightSearchMaxModules: 2 })

function compactProject(overrides = {}) {
  return application.createProjectInput({
    geometry: { moduleCount: 2, ...(overrides.geometry ?? {}) },
    environment: { ...FAST_ENVIRONMENT, ...(overrides.environment ?? {}) },
    equipment: { ...(overrides.equipment ?? {}) },
    connection: { ...(overrides.connection ?? {}) },
    criteria: { ...FAST_CRITERIA, ...(overrides.criteria ?? {}) },
  })
}

function canonicalProjectCases() {
  const basic = compactProject({ geometry: { moduleCount: 1, barDiameterMm: 12 } })
  const mixed = compactProject({ geometry: { moduleCount: 2, moduleDiametersMm: [16, 12] } })
  const manualJoint = compactProject({
    geometry: { moduleCount: 1, barDiameterMm: 16 },
    connection: {
      configuratorMode: 'manual',
      boltDiameterMm: 24,
      boltClass: '8.8',
      clearanceNutThreadMm: 30,
      boltLengthMm: 80,
      threadEngagementFactor: 2,
    },
  })
  const capacities = compactProject({
    geometry: { moduleCount: 2, barDiameterMm: 16 },
    environment: { windPressurePa: 380 },
    equipment: { massKg: 25, windAreaM2: 0.5, dragCoefficient: 1.4, loadFactor: 1.1 },
  })
  const sp20Mean = compactProject({
    geometry: { moduleCount: 2, barDiameterMm: 16 },
    environment: {
      windActionMode: 'sp20-mean-v1',
      windRegion: 'III',
      windTerrainType: 'B',
      windPresetId: 'custom',
      windPressurePa: 380,
      windDirectionDeg: 30,
    },
    equipment: { massKg: 5, windAreaM2: 0.25 },
  })
  const guyedProject = compactProject({
    geometry: { moduleCount: 4, barDiameterMm: 16 },
    environment: { windPressurePa: 180, windDirectionDeg: 0 },
    equipment: { massKg: 5, windAreaM2: 0.2 },
  })
  const resolvedGuyedProject = application.resolveProjectInput(guyedProject)
  const guyedHeightM = resolvedGuyedProject.moduleCount * resolvedGuyedProject.moduleHeightMm / 1000

  return [
    {
      name: 'basic-auto-joint',
      package: application.createProjectPackage(basic, { metadata: { name: 'Basic auto-joint oracle' } }),
      verify: (summary) => {
        assert.equal(summary.mode, 'bare')
        assert.equal(summary.result.geometry.moduleCount, 1)
        assert.equal(summary.result.connection.mode, 'auto')
      },
    },
    {
      name: 'mixed-diameters',
      package: application.createProjectPackage(mixed, { metadata: { name: 'Mixed-diameter oracle' } }),
      verify: (summary) => {
        assert.deepEqual(summary.result.geometry.moduleDiametersMm, [16, 12])
      },
    },
    {
      name: 'manual-joint',
      package: application.createProjectPackage(manualJoint, { metadata: { name: 'Manual-joint oracle' } }),
      verify: (summary) => {
        assert.equal(summary.result.connection.mode, 'manual')
        assert.equal(summary.result.connection.bolt?.diameterMm, 24)
        assert.equal(summary.result.connection.bolt?.lengthMm, 80)
        assert.equal(summary.result.connection.clearanceNutThreadMm, 30)
      },
    },
    {
      name: 'capacities',
      package: application.createProjectPackage(capacities, { metadata: { name: 'Capacity oracle' } }),
      verify: (summary) => {
        assert.ok(Number.isFinite(summary.result.capacities.lateralCriticalForceKgf))
        assert.ok(Number.isFinite(summary.result.capacities.staticMaximumTopMassKg))
        assert.ok(Number.isFinite(summary.result.capacities.heightDesignMaximumM))
        assert.ok(Number.isFinite(summary.result.capacities.craneMaximumEndPayloadMassKg))
      },
    },
    {
      name: 'sp20-mean-wind',
      package: application.createProjectPackage(sp20Mean, { metadata: { name: 'SP20 mean-wind oracle' } }),
      verify: (summary) => {
        assert.equal(summary.mode, 'bare')
        assert.equal(summary.project.environment.windActionMode, 'sp20-mean-v1')
        assert.equal(summary.project.environment.windRegion, 'III')
        assert.equal(summary.project.environment.windTerrainType, 'B')
        assert.ok(Number.isFinite(summary.result.response.maxUtilization))
        assert.ok(Number.isFinite(summary.result.response.topDisplacementMm))
      },
    },
    {
      name: 'guys',
      package: application.createProjectPackage(guyedProject, {
        metadata: { name: 'Guy-wire oracle' },
        guys: {
          tiers: [{
            heightM: guyedHeightM,
            anchorRadiusM: 5,
            guyCount: 3,
            azimuthOffsetDeg: 0,
            wireId: 'galv-6x19-iwrc-6',
            pretensionN: 600,
          }],
          safetyFactor: 3,
          terminationEfficiency: 0.8,
        },
      }),
      verify: (summary) => {
        assert.equal(summary.mode, 'guyed')
        assert.equal(summary.result.guys.cableCount, 3)
        assert.ok(Number.isFinite(summary.result.response.maximumCableUtilization))
      },
    },
  ]
}

function cleanCliEnvironment() {
  const env = { ...process.env }
  delete env.GITHUB_SHA
  delete env.GITHUB_REF
  delete env.GITHUB_RUN_ID
  return env
}

function runCliSummary(packageText) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mast-adapter-oracle-'))
  const projectFile = path.join(directory, 'canonical-project.json')
  fs.writeFileSync(projectFile, packageText)
  try {
    const output = spawnSync(process.execPath, [cliPath, 'calculate', projectFile, '--json'], {
      cwd: sourceRoot,
      env: cleanCliEnvironment(),
      encoding: 'utf8',
      timeout: 120_000,
    })
    assert.equal(output.status, 0, output.stderr)
    assert.equal(output.stderr, '')
    return JSON.parse(output.stdout)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

function directSummary(projectPackage, provenance) {
  if (projectPackage.guys) {
    const result = application.calculateGuyedProject(
      projectPackage.project,
      projectPackage.guys.tiers,
      {
        ...(projectPackage.guys.safetyFactor === undefined ? {} : { safetyFactor: projectPackage.guys.safetyFactor }),
        ...(projectPackage.guys.terminationEfficiency === undefined ? {} : { terminationEfficiency: projectPackage.guys.terminationEfficiency }),
      },
    )
    return application.createGuyedResultSummary(projectPackage, result, { provenance })
  }
  return application.createBareResultSummary(
    projectPackage,
    application.calculateProject(projectPackage.project),
    { provenance },
  )
}

test('canonical project set is exactly equivalent through direct, CLI, Web and Desktop adapters', { skip: !adaptersAvailable, timeout: 180_000 }, async (t) => {
  const provenance = {
    toolVersion: String(packageJson.version),
    coreVersion: String(packageJson.version),
    command: 'calculate',
  }

  for (const scenario of canonicalProjectCases()) {
    await t.test(scenario.name, async () => {
      const packageText = application.serializeProjectPackage(scenario.package)
      const direct = directSummary(scenario.package, provenance)
      const cli = runCliSummary(packageText)
      const web = await calculateBuiltAdapterSummary(webRoot, packageText, provenance)
      const desktop = await calculateBuiltAdapterSummary(desktopRoot, packageText, provenance)

      scenario.verify(direct)
      assert.deepEqual(cli, direct)
      assert.deepEqual(web, direct)
      assert.deepEqual(desktop, direct)
    })
  }
})

test('Desktop packaged core produces byte-identical design/report/export artifacts', { skip: !desktopAvailable }, () => {
  const project = compactProject({ geometry: { moduleCount: 2, moduleDiametersMm: [16, 12] } })
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

test('Web and Desktop builds are self-contained variants of the same emitted application', { skip: !adaptersAvailable }, () => {
  for (const relative of [
    'index.html',
    'apps/web/index.html',
    'apps/web/app-bootstrap.js',
    'apps/web/file-adapter.js',
    'apps/web/runtime-info.js',
    'packages/application/index.js',
    'packages/design/index.js',
    'packages/reporting/index.js',
  ]) {
    assert.equal(fs.existsSync(path.join(webRoot, relative)), true, `missing Web asset: ${relative}`)
    assert.equal(fs.existsSync(path.join(desktopRoot, relative)), true, `missing Desktop asset: ${relative}`)
  }
  assert.equal(fs.existsSync(path.join(desktopRoot, 'desktop-build-info.json')), true)

  const webAdapter = fs.readFileSync(path.join(webRoot, 'apps', 'web', 'file-adapter.js'), 'utf8')
  const desktopAdapter = fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'file-adapter.js'), 'utf8')
  const webBuildInfo = JSON.parse(fs.readFileSync(path.join(webRoot, 'apps', 'web', 'build-info.json'), 'utf8'))
  const desktopBuildInfo = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'apps', 'web', 'build-info.json'), 'utf8'))

  assert.match(webAdapter, /environment:\s*'browser'/)
  assert.match(desktopAdapter, /environment:\s*'tauri'/)
  assert.equal(webBuildInfo.adapter, 'web')
  assert.equal(desktopBuildInfo.adapter, 'tauri')
  assert.equal(webBuildInfo.appVersion, String(packageJson.version))
  assert.equal(desktopBuildInfo.appVersion, String(packageJson.version))
  assert.equal(webBuildInfo.coreVersion, String(packageJson.version))
  assert.equal(desktopBuildInfo.coreVersion, String(packageJson.version))
})
