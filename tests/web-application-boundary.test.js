import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_PROJECT_FORM_VALUES,
  projectInputFromFlatValues,
} from '../apps/web/project-form.js'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

test('shared Web form mapper produces canonical grouped ProjectInput without owning defaults', () => {
  const input = projectInputFromFlatValues({
    moduleCount: 3,
    equipmentMassKg: 7,
  })

  assert.equal(input.geometry.moduleCount, 3)
  assert.equal(input.equipment.massKg, 7)
  assert.equal(input.material.reinforcementClass, DEFAULT_PROJECT_FORM_VALUES.reinforcementClass)
  assert.equal(input.environment.windPressurePa, DEFAULT_PROJECT_FORM_VALUES.windPressurePa)
  assert.equal('moduleCount' in input, false)
  assert.equal('equipmentMassKg' in input, false)
})

test('main Web controller delegates form, job and state ownership to cohesive adapters', () => {
  const app = source('apps/web/app.js')

  assert.match(app, /createMainProjectFormController/)
  assert.match(app, /createCalculationController/)
  assert.match(app, /createWebApplicationState/)
  assert.match(app, /projectForm\.readProjectInput\(\)/)
  assert.doesNotMatch(app, /\bfunction readParameters\b|\bnumericFormValue\b/)
  assert.doesNotMatch(app, /DEFAULT_PROJECT_INPUT|flattenProjectInput/)
  assert.doesNotMatch(app, /theoreticalCutLengthMm|regularOctahedronHeightMm/)
  assert.doesNotMatch(app, /windPressureFromSpeedMs|windSpeedFromPressurePa/)
  assert.doesNotMatch(app, /lastParameters|lastResult|activeWorker/)
})

test('calculation Worker transports application jobs but owns no optimization policy', () => {
  const worker = source('apps/web/calculation-worker.js')

  assert.match(worker, /calculateProject/)
  assert.match(worker, /optimizeAndCalculateProject/)
  assert.match(worker, /projectInput/)
  assert.doesNotMatch(worker, /STANDARD_DIAMETERS_MM/)
  assert.doesNotMatch(worker, /moduleDiametersMm/)
  assert.doesNotMatch(worker, /configuratorMode/)
  assert.doesNotMatch(worker, /selectUniformDiameter|optimizeProject/)
  assert.doesNotMatch(worker, /maxUtilization|minimumBucklingFactor|jointBoltDiameterMm/)
  assert.doesNotMatch(worker, /packages\/(?:domain|engineering|numerics|structural-analysis)\//)
})

test('guy-wire page uses the shared DOM ProjectInput adapter and application calculation path', () => {
  const guys = source('apps/web/guys-app.js')

  assert.match(guys, /readProjectInputFromForm/)
  assert.match(guys, /applyDefaultProjectInputToForm/)
  assert.match(guys, /calculateProject\(projectInput\)/)
  assert.match(guys, /calculateGuyedProject\(projectInput, tiers, guyOptions\)/)
  assert.match(guys, /previewProjectGeometry/)
  assert.doesNotMatch(guys, /\bfunction readParameters\b|projectInputFromFlatValues/)
  assert.doesNotMatch(guys, /DEFAULT_PARAMETERS|resolveCalculationParameters/)
  assert.doesNotMatch(guys, /\bcalculateMast\s*\(/)
  assert.doesNotMatch(guys, /theoreticalCutLengthMm|regularOctahedronHeightMm/)
  assert.doesNotMatch(guys, /packages\/(?:engineering|numerics|structural-analysis)\//)
})

test('joint bootstrap renders application-owned physical previews instead of engineering formulas', () => {
  const bootstrap = source('apps/web/app-bootstrap.js')

  assert.match(bootstrap, /previewJointConfiguration/)
  assert.match(bootstrap, /getJointConfigurationOptions/)
  assert.match(bootstrap, /getJointClearanceNutOptions/)
  assert.doesNotMatch(bootstrap, /calculateBoltCapacity|checkJointNutSections|buildJointHardwareGeometry/)
  assert.doesNotMatch(bootstrap, /packages\/(?:engineering|numerics|structural-analysis)\//)
})

test('all Web JavaScript stays above engineering, numerics and structural-analysis packages', () => {
  const webFiles = [
    'app.js',
    'app-bootstrap.js',
    'calculation-controller.js',
    'calculation-worker.js',
    'guys-app.js',
    'main-project-form.js',
    'project-form-dom.js',
    'project-form.js',
    'usage-scenarios.js',
    'web-state.js',
  ]
  for (const file of webFiles) {
    assert.doesNotMatch(
      source(`apps/web/${file}`),
      /packages\/(?:engineering|numerics|structural-analysis)\//,
      `${file} must use application/public presentation packages instead of lower engineering layers`,
    )
  }
})
