import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateGuyedProject,
  calculateProject,
  createVerification,
  optimizeProject,
} from '../packages/application/index.js'

const compactInput = {
  moduleCount: 1,
  heightSearchMaxModules: 2,
  windPresetId: 'custom',
  windPressurePa: 250,
  windEnvelopeEnabled: false,
  lateralCapacityStepDeg: 60,
  equipmentMassKg: 10,
  equipmentWindAreaM2: 0.2,
}

test('public application API calculates a complete project in a plain Node process', () => {
  const result = calculateProject(compactInput)
  assert.equal(result.model.moduleCount, 1)
  assert.equal(result.model.members.length, 9)
  assert.ok(result.lateralCapacity)
  assert.ok(result.staticPayloadCapacity)
  assert.ok(result.heightCapacity)
  assert.ok(result.craneBoomCapacity)
  assert.ok(result.assemblyMass)
  assert.equal(result.verification.counts.internal, result.performance.verificationInternalCheckCount)
  assert.equal(createVerification(result).counts.failed, 0)
})

test('public application API exposes optimization and guyed calculation without Web adapters', () => {
  const optimization = optimizeProject(compactInput, { diameters: [12], stopAtFirstPassing: false })
  assert.equal(optimization.evaluatedCount, 1)
  assert.equal(optimization.variants[0].diameter, 12)

  const guyed = calculateGuyedProject(compactInput, [])
  assert.equal(guyed.model.moduleCount, 1)
  assert.equal(guyed.cableSystem.cables.length, 0)
  assert.ok(Number.isFinite(guyed.envelope.maxTopDisplacementM))
})
