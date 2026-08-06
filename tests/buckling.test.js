import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCriticalBucklingFactor } from '../site/engine/buckling.js'
import { largestEigenpairSymmetric } from '../site/engine/linear-algebra.js'

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
