import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateProject,
  createApplicationCancellationController,
  createProjectInput,
  MastApplicationError,
  optimizeAndCalculateProject,
} from '../packages/application/index.js'

const compactInput = createProjectInput({
  geometry: { moduleCount: 1 },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 250,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  },
  criteria: { heightSearchMaxModules: 2 },
})

function assertCancelled(error) {
  assert.ok(error instanceof MastApplicationError)
  assert.equal(error.category, 'cancelled')
  assert.equal(error.code, 'operation-cancelled')
  return true
}

test('pre-aborted portable signal rejects calculation before numerical work', () => {
  const controller = createApplicationCancellationController()
  controller.abort('stop before start')

  assert.throws(
    () => calculateProject(compactInput, { signal: controller.signal }),
    assertCancelled,
  )
})

test('calculation cooperatively aborts at an existing progress boundary', () => {
  const controller = createApplicationCancellationController()
  let progressCount = 0

  assert.throws(() => calculateProject(compactInput, {
    signal: controller.signal,
    onProgress: () => {
      progressCount += 1
      controller.abort('stop during calculation')
    },
  }), assertCancelled)
  assert.ok(progressCount >= 1)
})

test('optimize-then-calculate job propagates the same portable cancellation signal', () => {
  const controller = createApplicationCancellationController()
  let progressCount = 0

  assert.throws(() => optimizeAndCalculateProject(compactInput, {
    diameters: [12, 14],
    signal: controller.signal,
    onProgress: () => {
      progressCount += 1
      controller.abort('stop optimization')
    },
  }), assertCancelled)
  assert.ok(progressCount >= 1)
})
