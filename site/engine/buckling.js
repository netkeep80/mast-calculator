import {
  choleskyDecomposition,
  invertLowerTriangular,
  largestEigenpairSymmetric,
  matrixMultiply,
  matrixVectorMultiply,
  transpose,
  vectorNorm,
} from './linear-algebra.js'

const scaleMatrix = (matrix, scalar) => matrix.map((row) => row.map((value) => value * scalar))

export function calculateCriticalBucklingFactor(elasticStiffness, geometricStiffness) {
  if (elasticStiffness.length === 0) {
    return { factor: Number.POSITIVE_INFINITY, mode: [], residual: 0, eigenResidual: 0, iterations: 0 }
  }

  const lower = choleskyDecomposition(elasticStiffness)
  const inverseLower = invertLowerTriangular(lower)
  const transformed = matrixMultiply(
    matrixMultiply(inverseLower, scaleMatrix(geometricStiffness, -1)),
    transpose(inverseLower),
  )
  const eigenpair = largestEigenpairSymmetric(transformed)

  if (!(eigenpair.eigenvalue > 1e-12)) {
    return {
      factor: Number.POSITIVE_INFINITY,
      mode: new Array(elasticStiffness.length).fill(0),
      residual: 0,
      eigenResidual: eigenpair.residual,
      iterations: eigenpair.iterations,
    }
  }

  const factor = 1 / eigenpair.eigenvalue
  let mode = matrixVectorMultiply(transpose(inverseLower), eigenpair.vector)
  const maximum = Math.max(...mode.map(Math.abs), Number.EPSILON)
  mode = mode.map((value) => value / maximum)

  const elasticPart = matrixVectorMultiply(elasticStiffness, mode)
  const geometricPart = matrixVectorMultiply(geometricStiffness, mode)
  const residualVector = elasticPart.map((value, index) => value + factor * geometricPart[index])
  const residual = vectorNorm(residualVector) / Math.max(1, vectorNorm(elasticPart), factor * vectorNorm(geometricPart))

  return {
    factor,
    mode,
    residual,
    eigenResidual: eigenpair.residual,
    iterations: eigenpair.iterations,
  }
}
