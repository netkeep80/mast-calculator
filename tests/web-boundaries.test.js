import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const worker = fs.readFileSync(new URL('../apps/web/calculation-worker.js', import.meta.url), 'utf8')
const usage = fs.readFileSync(new URL('../apps/web/usage-scenarios.js', import.meta.url), 'utf8')
const reports = fs.readFileSync(new URL('../apps/web/reports-exports.js', import.meta.url), 'utf8')
const fileAdapter = fs.readFileSync(new URL('../apps/web/file-adapter.js', import.meta.url), 'utf8')
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

test('design/report projections persist only through the environment file adapter', () => {
  assert.doesNotMatch(usage, /createDesignPackage|saveDesignPackage|design-storage|localStorage/)
  assert.match(reports, /createDesignPackage/)
  assert.match(reports, /fileAdapter/)
  assert.match(reports, /\.saveText/)
  assert.doesNotMatch(reports, /localStorage|new Blob\(|createObjectURL/)
  assert.match(fileAdapter, /environment:\s*'browser'/)
  assert.match(fileAdapter, /new Blob\(/)
  assert.match(fileAdapter, /createObjectURL/)
  assert.doesNotMatch(usage, /calculateAssemblyMass|reinforcementMassPerMeterKg|theoreticalCutLengthMm/)
  assert.doesNotMatch(usage, /result\.assemblyMass\s*=|__mastLastUsageResult/)
  assert.doesNotMatch(designPackage, /localStorage|DESIGN_PACKAGE_STORAGE_KEY|saveDesignResult|saveDesignPackage|loadDesignPackage/)
})
