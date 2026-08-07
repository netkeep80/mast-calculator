import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateCriticalBucklingFactor,
  calculateCriticalBucklingFactorBanded,
} from '../packages/structural-analysis/index.js'
import { denseToSymmetricBand, factorSymmetricBand } from '../packages/numerics/index.js'
import { largestEigenpairSymmetric } from '../packages/numerics/index.js'

test('поиск максимального собственного значения для диагональной матрицы', () => {
  const result = largestEigenpairSymmetric([
    [2, 0, 0],
    [0, -4, 0],
    [0, 0, 7],
  ])
  assert.ok(Math.abs(result.eigenvalue - 7) < 1e-8)
  assert.ok(result.residual < 1e-8)
})

test('критический множитель совпадает с аналитическим решением диагональной задачи', () => {
  const result = calculateCriticalBucklingFactor(
    [[2, 0], [0, 8]],
    [[-1, 0], [0, -2]],
  )
  assert.ok(Math.abs(result.factor - 2) < 1e-8)
  assert.ok(result.residual < 1e-8)
})

test('generalized Lanczos на ленточной матрице совпадает с dense reference', () => {
  const elastic = [
    [12, -2, 0, 0],
    [-2, 9, -1, 0],
    [0, -1, 7, -1],
    [0, 0, -1, 5],
  ]
  const geometric = [
    [-2.2, 0.3, 0, 0],
    [0.3, -1.7, 0.2, 0],
    [0, 0.2, -1.1, 0.1],
    [0, 0, 0.1, -0.8],
  ]
  const dense = calculateCriticalBucklingFactor(elastic, geometric)
  const elasticBand = denseToSymmetricBand(elastic)
  const geometricBand = denseToSymmetricBand(geometric)
  const banded = calculateCriticalBucklingFactorBanded(
    elasticBand,
    factorSymmetricBand(elasticBand),
    geometricBand,
    { maxIterations: 16, checkEvery: 1, tolerance: 1e-10 },
  )

  assert.ok(Math.abs(banded.factor - dense.factor) / dense.factor < 1e-7)
  assert.ok(banded.residual < 1e-7)
  assert.ok(banded.iterations <= 16)
})
