import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const worker = fs.readFileSync(new URL('../apps/web/calculation-worker.js', import.meta.url), 'utf8')
const usage = fs.readFileSync(new URL('../apps/web/usage-scenarios.js', import.meta.url), 'utf8')
const designStorage = fs.readFileSync(new URL('../apps/web/design-storage.js', import.meta.url), 'utf8')
const designPackage = fs.readFileSync(new URL('../packages/design/src/design-package.js', import.meta.url), 'utf8')

test('Web Worker delegates heavy actions to application use cases', () => {
  assert.match(worker, /calculateProject/)
  assert.match(worker, /optimizeAndCalculateProject/)
  assert.doesNotMatch(worker, /\boptimizeProject\b/)
  assert.doesNotMatch(worker, /calculateCompleteMastWithConfiguredJoint/)
  assert.doesNotMatch(worker, /augmentVerificationWithModuleChecks/)
  assert.doesNotMatch(worker, /selectUniformDiameter/)
  assert.doesNotMatch(worker, /STANDARD_DIAMETERS_MM|moduleDiametersMm|configuratorMode/)
})

test('browser persistence stores application-built design packages without owning design orchestration', () => {
  assert.match(usage, /createDesignPackage/)
  assert.match(usage, /saveDesignPackage/)
  assert.match(usage, /from '\.\/design-storage\.js'/)
  assert.match(designStorage, /globalThis\.localStorage/)
  assert.match(designStorage, /saveDesignPackage/)
  assert.doesNotMatch(designStorage, /buildDesignPackage|saveDesignResult/)
  assert.doesNotMatch(usage, /calculateAssemblyMass|reinforcementMassPerMeterKg|theoreticalCutLengthMm/)
  assert.doesNotMatch(usage, /result\.assemblyMass\s*=|__mastLastUsageResult/)
  assert.doesNotMatch(designPackage, /localStorage|DESIGN_PACKAGE_STORAGE_KEY|saveDesignResult|saveDesignPackage|loadDesignPackage/)
})
