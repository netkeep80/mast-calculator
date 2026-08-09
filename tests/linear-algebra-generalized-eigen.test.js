import assert from 'node:assert/strict'
import test from 'node:test'
import {
  denseToSymmetricBand,
  factorSymmetricBand,
  largestGeneralizedEigenpairsBanded,
} from '../packages/numerics/index.js'

function solve(stiffness, operator, count) {
  const stiffnessBand = denseToSymmetricBand(stiffness)
  const operatorBand = denseToSymmetricBand(operator)
  return largestGeneralizedEigenpairsBanded(
    stiffnessBand,
    factorSymmetricBand(stiffnessBand),
    operatorBand,
    { eigenpairCount: count, tolerance: 1e-11, maxIterations: 40 },
  )
}

test('generalized eigensolver recovers diagonal Bx=mu*Kx modes in descending mu order', () => {
  const result = solve(
    [[4, 0, 0], [0, 9, 0], [0, 0, 16]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    3,
  )
  const expected = [1 / 4, 1 / 9, 1 / 16]
  assert.equal(result.eigenpairs.length, expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(Math.abs(result.eigenpairs[index].eigenvalue - expected[index]) < 1e-10)
    assert.ok(result.eigenpairs[index].residual < 1e-10)
  }
})

test('generalized eigensolver matches exact coupled 2DOF eigenvalues', () => {
  const result = solve(
    [[2, -1], [-1, 2]],
    [[1, 0], [0, 1]],
    2,
  )
  assert.ok(Math.abs(result.eigenpairs[0].eigenvalue - 1) < 1e-10)
  assert.ok(Math.abs(result.eigenpairs[1].eigenvalue - 1 / 3) < 1e-10)
  assert.ok(result.eigenpairs.every((pair) => pair.residual < 1e-10))
})

test('1DOF spring-mass frequency follows f=sqrt(k/m)/(2*pi)', () => {
  const stiffness = 1250
  const mass = 8
  const result = solve([[stiffness]], [[mass]], 1)
  const omegaSquared = 1 / result.eigenpairs[0].eigenvalue
  const frequencyHz = Math.sqrt(omegaSquared) / (2 * Math.PI)
  const expectedHz = Math.sqrt(stiffness / mass) / (2 * Math.PI)
  assert.ok(Math.abs(frequencyHz - expectedHz) < 1e-12)
})

test('generalized eigensolver accepts positive-semidefinite operator and ignores zero modes', () => {
  const result = solve(
    [[1, 0, 0], [0, 2, 0], [0, 0, 8]],
    [[1, 0, 0], [0, 0, 0], [0, 0, 4]],
    2,
  )
  assert.ok(Math.abs(result.eigenpairs[0].eigenvalue - 1) < 1e-10)
  assert.ok(Math.abs(result.eigenpairs[1].eigenvalue - 0.5) < 1e-10)
  assert.ok(result.eigenpairs.every((pair) => pair.residual < 1e-10))
})
