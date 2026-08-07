import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateGuyedProject,
  calculateProject,
  createProjectInput,
  createVerification,
  optimizeProject,
} from '../packages/application/index.js'

const compactInput = createProjectInput({
  geometry: {
    moduleCount: 1,
  },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 250,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  },
  equipment: {
    massKg: 10,
    windAreaM2: 0.2,
  },
  criteria: {
    heightSearchMaxModules: 2,
  },
})

test('public application API calculates a complete immutable project in a plain Node process', () => {
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
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.analysis), true)
  assert.equal(Object.isFrozen(result.verification.checks), true)
  assert.throws(() => { result.parameters.moduleCount = 999 }, TypeError)
})

test('public application API exposes optimization and guyed calculation without Web adapters', () => {
  const optimization = optimizeProject(compactInput, { diameters: [12], stopAtFirstPassing: false })
  assert.equal(optimization.evaluatedCount, 1)
  assert.equal(optimization.variants[0].diameter, 12)
  assert.equal(Object.isFrozen(optimization), true)

  const guyed = calculateGuyedProject(compactInput, [])
  assert.equal(guyed.model.moduleCount, 1)
  assert.equal(guyed.cableSystem.cables.length, 0)
  assert.ok(Number.isFinite(guyed.envelope.maxTopDisplacementM))
  assert.equal(Object.isFrozen(guyed), true)
})
