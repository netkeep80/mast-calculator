import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateGuyedProject,
  calculateProject,
  calculateProjectWithGuys,
  createProjectInput,
} from '../packages/application/index.js'

const input = createProjectInput({
  geometry: { moduleCount: 3 },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 180,
    windEnvelopeEnabled: false,
    windDirectionDeg: 20,
    lateralCapacityStepDeg: 60,
  },
  equipment: { massKg: 5, windAreaM2: 0.1 },
  criteria: { heightSearchMaxModules: 4, displacementLimitMm: 100 },
})

const guys = Object.freeze({
  tiers: Object.freeze([Object.freeze({
    id: 'api-tier',
    heightM: 1.2,
    anchorRadiusM: 5,
    guyCount: 3,
    pretensionN: 800,
    wireId: 'galv-6x19-iwrc-6',
  })]),
  safetyFactor: 3,
  terminationEfficiency: 0.8,
})

test('application optional-guy job preserves the normal CalculationResult and adds a separate guyed envelope', () => {
  const combined = calculateProjectWithGuys(input, guys)
  const bare = calculateProject(input)
  const guyed = calculateGuyedProject(input, guys.tiers, {
    safetyFactor: guys.safetyFactor,
    terminationEfficiency: guys.terminationEfficiency,
  })

  assert.equal(combined.result.model.moduleCount, bare.model.moduleCount)
  assert.equal(combined.result.envelope.maxUtilization, bare.envelope.maxUtilization)
  assert.equal(combined.result.envelope.maxTopDisplacementM, bare.envelope.maxTopDisplacementM)
  assert.equal(combined.result.envelope.minimumBucklingFactor, bare.envelope.minimumBucklingFactor)
  assert.deepEqual(combined.guyedResult.envelope, guyed.envelope)
  assert.deepEqual(combined.guyedResult.cableEnvelope, guyed.cableEnvelope)
  assert.equal(Object.isFrozen(combined), true)
})

test('application optional-guy job is exactly the normal calculation when guys are absent', () => {
  const progress = []
  const combined = calculateProjectWithGuys(input, null, {
    onProgress: (event) => progress.push(event),
  })
  assert.equal(combined.guyedResult, null)
  assert.equal(combined.result.model.moduleCount, 3)
  assert.equal(progress.some((event) => event.phase === 'guys'), false)
  assert.equal(progress.at(-1).fraction, 1)
})

test('application optional-guy job exposes one adapter progress stream including the nonlinear guy phase', () => {
  const progress = []
  calculateProjectWithGuys(input, guys, {
    onProgress: (event) => progress.push(event),
  })
  assert.ok(progress.some((event) => event.phase === 'guys'))
  assert.equal(progress.at(-1).phase, 'guys')
  assert.equal(progress.at(-1).fraction, 1)
  for (let index = 1; index < progress.length; index += 1) {
    assert.ok(progress[index].fraction >= progress[index - 1].fraction)
  }
})
