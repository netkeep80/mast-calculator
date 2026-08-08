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

  assert.match(worker, /calculateProjectWithGuys/)
  assert.match(worker, /optimizeAndCalculateProject/)
  assert.match(worker, /projectInput/)
  assert.match(worker, /projectGuys/)
  assert.doesNotMatch(worker, /STANDARD_DIAMETERS_MM/)
  assert.doesNotMatch(worker, /moduleDiametersMm/)
  assert.doesNotMatch(worker, /configuratorMode/)
  assert.doesNotMatch(worker, /selectUniformDiameter|optimizeProject/)
  assert.doesNotMatch(worker, /maxUtilization|minimumBucklingFactor|jointBoltDiameterMm/)
  assert.doesNotMatch(worker, /packages\/(?:domain|engineering|numerics|structural-analysis)\//)
})

test('guy wires use the same canonical project editor and one application calculation transport', () => {
  const editor = source('apps/web/guy-editor.js')
  const guyState = source('apps/web/guy-project-state.js')
  const controller = source('apps/web/calculation-controller.js')
  const worker = source('apps/web/calculation-worker.js')
  const legacyPage = source('apps/web/guys.html')

  assert.match(editor, /readProjectInputFromForm/)
  assert.match(editor, /previewProjectGeometry/)
  assert.match(guyState, /getGuyEditor\(\)\?\.read\(\)/)
  assert.match(controller, /currentProjectGuys\(\)/)
  assert.match(controller, /guys: projectGuys/)
  assert.match(worker, /calculateProjectWithGuys/)
  assert.match(legacyPage, /index\.html#guys/)
  assert.doesNotMatch(legacyPage, /<form|guys-app\.js/)
  assert.equal(fs.existsSync(path.join(sourceRoot, 'apps', 'web', 'guys-app.js')), false)
  assert.doesNotMatch(editor + guyState + controller + worker, /mastFieldMap/)
  assert.doesNotMatch(editor + guyState + controller + worker, /packages\/(?:engineering|numerics|structural-analysis)\//)
})

test('joint bootstrap is a presenter over application previews and completed result state', () => {
  const bootstrap = source('apps/web/app-bootstrap.js')

  assert.match(bootstrap, /previewJointConfiguration/)
  assert.match(bootstrap, /getJointConfigurationOptions/)
  assert.match(bootstrap, /getJointClearanceNutOptions/)
  assert.match(bootstrap, /readProjectInputFromForm/)
  assert.match(bootstrap, /applyProjectInputToForm/)
  assert.match(bootstrap, /applyProjectInputToForm\(form, projectInput\)/)
  assert.match(bootstrap, /subscribeCalculationResult/)
  assert.doesNotMatch(bootstrap, /calculateBoltCapacity|checkJointNutSections|buildJointHardwareGeometry/)
  assert.doesNotMatch(bootstrap, /JointAwareWorker|globalThis\.Worker\s*=|class .*Worker|message\.action/)
  assert.doesNotMatch(bootstrap, /packages\/(?:engineering|numerics|structural-analysis)\//)
})

test('all Web JavaScript stays above engineering, numerics and structural-analysis packages', () => {
  const webFiles = [
    'app.js',
    'app-bootstrap.js',
    'calculation-controller.js',
    'calculation-worker.js',
    'guy-editor.js',
    'guy-project-state.js',
    'guy-result-panel.js',
    'main-project-form.js',
    'procurement-export.js',
    'project-form-dom.js',
    'project-form.js',
    'project-package-ui.js',
    'result-channel.js',
    'usage-scenarios.js',
    'web-state.js',
    'workspace-shell.js',
  ]
  for (const file of webFiles) {
    assert.doesNotMatch(
      source(`apps/web/${file}`),
      /packages\/(?:engineering|numerics|structural-analysis)\//,
      `${file} must use application/public presentation packages instead of lower engineering layers`,
    )
  }
})
