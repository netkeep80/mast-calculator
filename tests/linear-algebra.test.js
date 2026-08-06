import assert from 'node:assert/strict'
import test from 'node:test'
import { relativeResidual, solveDenseSystem } from '../site/engine/linear-algebra.js'

test('решатель использует выбор главного элемента', () => {
  const matrix = [[0, 2], [1, 3]]
  const rhs = [4, 5]
  const result = solveDenseSystem(matrix, rhs)
  assert.ok(Math.abs(result.solution[0] + 1) < 1e-12)
  assert.ok(Math.abs(result.solution[1] - 2) < 1e-12)
  assert.ok(relativeResidual(matrix, result.solution, rhs) < 1e-12)
})

test('вырожденная матрица отклоняется', () => {
  assert.throws(() => solveDenseSystem([[1, 2], [2, 4]], [1, 2]), /вырождена/)
})
