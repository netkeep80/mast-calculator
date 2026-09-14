import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateProject,
  createProjectInput,
  createVerification,
} from '../packages/application/index.js'

const compactInput = createProjectInput({
  geometry: { moduleCount: 1 },
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
  criteria: { heightSearchMaxModules: 2 },
})

test('diagnostic: compact public calculation has no failed verification checks', () => {
  const result = calculateProject(compactInput)
  const verification = createVerification(result)
  const failed = verification.checks
    .filter((check) => check.status === 'fail')
    .map((check) => ({
      id: check.id,
      level: check.level,
      title: check.title,
      actual: check.actual,
      expected: check.expected,
      tolerance: check.tolerance,
      relativeError: check.relativeError,
      evidence: check.evidence,
    }))

  assert.deepEqual(failed, [])
})
