import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addBandValue,
  createSymmetricBandMatrix,
  denseToSymmetricBand,
  factorSymmetricBand,
  relativeBandResidual,
  solveSymmetricBandFactor,
} from '../packages/numerics/index.js'
import { solveDenseSystem } from '../packages/numerics/index.js'

const approximately = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
}

test('ленточная Cholesky-факторизация совпадает с dense reference', () => {
  const matrix = [
    [7, -2, 0.5, 0, 0],
    [-2, 8, -1, 0.25, 0],
    [0.5, -1, 6, -1.5, 0.2],
    [0, 0.25, -1.5, 7, -1],
    [0, 0, 0.2, -1, 5],
  ]
  const rhs = [3, -2, 5, 1, 4]
  const dense = solveDenseSystem(matrix, rhs).solution
  const band = denseToSymmetricBand(matrix)
  const factorization = factorSymmetricBand(band)
  const solution = solveSymmetricBandFactor(factorization, rhs)

  assert.equal(band.bandwidth, 2)
  assert.ok(factorization.minPivotRatio > 0)
  for (let index = 0; index < rhs.length; index += 1) approximately(solution[index], dense[index])
  assert.ok(relativeBandResidual(band, solution, rhs) < 1e-12)
})

test('ленточный solver хранит O(n·b), а не O(n²) ячеек', () => {
  const size = 1000
  const band = createSymmetricBandMatrix(size, 1)
  for (let row = 0; row < size; row += 1) {
    addBandValue(band, row, row, 4)
    if (row > 0) addBandValue(band, row, row - 1, -1)
  }
  const storedCells = band.rows.reduce((sum, row) => sum + row.length, 0)

  assert.equal(storedCells, size * 2)
  assert.ok(storedCells < size * size / 100)
})
