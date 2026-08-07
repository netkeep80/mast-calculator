import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { selectUniformDiameter } from '../site/engine/optimize.js'

const unloadedParameters = {
  ...DEFAULT_PARAMETERS,
  moduleCount: 1,
  windEnvelopeEnabled: false,
  windPressurePa: 0,
  windPresetId: 'custom',
  deadLoadFactor: 0,
  equipmentMassKg: 0,
  equipmentWindAreaM2: 0,
  extraHorizontalLoadN: 0,
  extraVerticalLoadN: 0,
  iceThicknessMm: 0,
  displacementLimitMm: 1e6,
  minimumBucklingFactor: 1,
}

test('подбор диаметра прекращается на первом проходящем размере', () => {
  const result = selectUniformDiameter(unloadedParameters, [12, 8, 10])

  assert.equal(result.recommended.diameter, 8)
  assert.equal(result.evaluatedCount, 1)
  assert.equal(result.availableCount, 3)
  assert.deepEqual(result.variants.map((variant) => variant.diameter), [8])
})

test('reference-режим позволяет явно рассчитать все диаметры', () => {
  const result = selectUniformDiameter(unloadedParameters, [12, 8, 10], {
    stopAtFirstPassing: false,
  })

  assert.equal(result.recommended.diameter, 8)
  assert.equal(result.evaluatedCount, 3)
  assert.deepEqual(result.variants.map((variant) => variant.diameter), [8, 10, 12])
})
