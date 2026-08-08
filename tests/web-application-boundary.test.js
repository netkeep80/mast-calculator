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

test('calculation Worker transports application jobs but owns no optimization policy', () => {
  const worker = source('apps/web/calculation-worker.js')

  assert.match(worker, /calculateProject/)
  assert.match(worker, /optimizeAndCalculateProject/)
  assert.doesNotMatch(worker, /STANDARD_DIAMETERS_MM/)
  assert.doesNotMatch(worker, /moduleDiametersMm/)
  assert.doesNotMatch(worker, /configuratorMode/)
  assert.doesNotMatch(worker, /selectUniformDiameter|optimizeProject/)
  assert.doesNotMatch(worker, /maxUtilization|minimumBucklingFactor|jointBoltDiameterMm/)
  assert.doesNotMatch(worker, /packages\/(?:domain|engineering|numerics|structural-analysis)\//)
})

test('guy-wire page uses the same ProjectInput and application calculation path as other adapters', () => {
  const guys = source('apps/web/guys-app.js')

  assert.match(guys, /projectInputFromFlatValues/)
  assert.match(guys, /calculateProject\(projectInput\)/)
  assert.match(guys, /calculateGuyedProject\(projectInput, tiers, guyOptions\)/)
  assert.match(guys, /previewProjectGeometry/)
  assert.doesNotMatch(guys, /DEFAULT_PARAMETERS|resolveCalculationParameters/)
  assert.doesNotMatch(guys, /\bcalculateMast\s*\(/)
  assert.doesNotMatch(guys, /theoreticalCutLengthMm|regularOctahedronHeightMm/)
  assert.doesNotMatch(guys, /packages\/(?:engineering|numerics|structural-analysis)\//)
})
