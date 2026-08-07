import {
  dotProduct,
  multiplySymmetricBand,
  solveSymmetricBandFactor,
  vectorNorm2,
} from './banded.js'
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

function tridiagonalMultiply(diagonal, offDiagonal, vector, shift = 0) {
  const result = new Float64Array(diagonal.length)
  for (let index = 0; index < diagonal.length; index += 1) {
    result[index] = (diagonal[index] + shift) * vector[index]
    if (index > 0) result[index] += offDiagonal[index - 1] * vector[index - 1]
    if (index + 1 < diagonal.length) result[index] += offDiagonal[index] * vector[index + 1]
  }
  return result
}

function largestEigenpairTridiagonal(diagonal, offDiagonal, options = {}) {
  const size = diagonal.length
  if (size === 0) return { eigenvalue: Number.NEGATIVE_INFINITY, vector: [], residual: 0 }
  const tolerance = options.tolerance ?? 1e-11
  const maxIterations = options.maxIterations ?? 1200

  let lowerBound = Number.POSITIVE_INFINITY
  let scale = 1
  for (let index = 0; index < size; index += 1) {
    const radius = Math.abs(offDiagonal[index - 1] ?? 0) + Math.abs(offDiagonal[index] ?? 0)
    lowerBound = Math.min(lowerBound, diagonal[index] - radius)
    scale = Math.max(scale, Math.abs(diagonal[index]), radius)
  }
  const shift = lowerBound < 0 ? -lowerBound + scale * 1e-12 : 0

  let vector = Float64Array.from(
    { length: size },
    (_, index) => Math.sin((index + 1) * 1.61803398875) + 1.5,
  )
  let norm = vectorNorm2(vector)
  for (let index = 0; index < size; index += 1) vector[index] /= norm

  let eigenvalue = diagonal[0] ?? 0
  let residual = Number.POSITIVE_INFINITY
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const shiftedProduct = tridiagonalMultiply(diagonal, offDiagonal, vector, shift)
    norm = vectorNorm2(shiftedProduct)
    if (norm <= Number.EPSILON) break
    const next = Float64Array.from(shiftedProduct, (value) => value / norm)
    const originalProduct = tridiagonalMultiply(diagonal, offDiagonal, next)
    eigenvalue = dotProduct(next, originalProduct)
    let residualSquared = 0
    for (let index = 0; index < size; index += 1) {
      const value = originalProduct[index] - eigenvalue * next[index]
      residualSquared += value * value
    }
    residual = Math.sqrt(residualSquared) / Math.max(1, Math.abs(eigenvalue))
    vector = next
    if (residual <= tolerance) break
  }
  return { eigenvalue, vector: Array.from(vector), residual }
}

function kNormalize(vector, elasticStiffness) {
  const product = multiplySymmetricBand(elasticStiffness, vector)
  const norm = Math.sqrt(Math.max(0, dotProduct(vector, product)))
  if (!(norm > Number.EPSILON)) throw new Error('Невозможно нормировать собственный вектор по матрице жёсткости')
  return Float64Array.from(vector, (value) => value / norm)
}

function subtractScaled(target, source, scale) {
  if (scale === 0) return
  for (let index = 0; index < target.length; index += 1) target[index] -= scale * source[index]
}

function reorthogonalizeK(vector, basis, elasticStiffness) {
  // Два прохода classical Gram-Schmidt в K-скалярном произведении устраняют
  // накопление повторных Ritz-векторов при близких собственных значениях.
  for (let pass = 0; pass < 2; pass += 1) {
    const kVector = multiplySymmetricBand(elasticStiffness, vector)
    for (const basisVector of basis) {
      const coefficient = dotProduct(basisVector, kVector)
      subtractScaled(vector, basisVector, coefficient)
    }
  }
}

function buildRitzMode(basis, coefficients) {
  const mode = new Float64Array(basis[0]?.length ?? 0)
  for (let basisIndex = 0; basisIndex < basis.length; basisIndex += 1) {
    const factor = coefficients[basisIndex] ?? 0
    for (let index = 0; index < mode.length; index += 1) {
      mode[index] += factor * basis[basisIndex][index]
    }
  }
  const maximum = Math.max(...mode.map(Math.abs), Number.EPSILON)
  return Array.from(mode, (value) => value / maximum)
}

function bandedBucklingResidual(elasticStiffness, geometricStiffness, mode, factor) {
  const elasticPart = multiplySymmetricBand(elasticStiffness, mode)
  const geometricPart = multiplySymmetricBand(geometricStiffness, mode)
  const residual = new Float64Array(mode.length)
  for (let index = 0; index < mode.length; index += 1) {
    residual[index] = elasticPart[index] + factor * geometricPart[index]
  }
  return vectorNorm2(residual) / Math.max(
    1,
    vectorNorm2(elasticPart),
    factor * vectorNorm2(geometricPart),
  )
}

export function calculateCriticalBucklingFactorBanded(
  elasticStiffness,
  elasticFactorization,
  geometricStiffness,
  options = {},
) {
  const size = elasticStiffness.size
  if (size === 0) {
    return { factor: Number.POSITIVE_INFINITY, mode: [], residual: 0, eigenResidual: 0, iterations: 0 }
  }

  const tolerance = options.tolerance ?? 1e-8
  const maxIterations = Math.min(size, options.maxIterations ?? 160)
  const checkEvery = Math.max(1, options.checkEvery ?? 4)
  const initial = Float64Array.from(
    { length: size },
    (_, index) => Math.sin((index + 1) * 1.61803398875) + 1.5,
  )

  let current = kNormalize(initial, elasticStiffness)
  let previous = null
  let previousBeta = 0
  const basis = []
  const diagonal = []
  const offDiagonal = []
  let lastEigenpair = null
  let lastGeneralizedResidual = Number.POSITIVE_INFINITY
  let iterations = 0

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    iterations = iteration + 1
    basis.push(current)

    const geometricProduct = multiplySymmetricBand(geometricStiffness, current)
    const rightHandSide = Float64Array.from(geometricProduct, (value) => -value)
    const alpha = dotProduct(current, rightHandSide)
    diagonal.push(alpha)

    const nextResidual = solveSymmetricBandFactor(elasticFactorization, rightHandSide)
    if (previous) subtractScaled(nextResidual, previous, previousBeta)
    subtractScaled(nextResidual, current, alpha)
    reorthogonalizeK(nextResidual, basis, elasticStiffness)

    const kResidual = multiplySymmetricBand(elasticStiffness, nextResidual)
    const beta = Math.sqrt(Math.max(0, dotProduct(nextResidual, kResidual)))
    const shouldCheck = diagonal.length === 1
      || diagonal.length % checkEvery === 0
      || beta <= 1e-14
      || iteration + 1 === maxIterations

    if (shouldCheck) {
      lastEigenpair = largestEigenpairTridiagonal(diagonal, offDiagonal)
      if (lastEigenpair.eigenvalue > 1e-12) {
        const candidateFactor = 1 / lastEigenpair.eigenvalue
        const candidateMode = buildRitzMode(basis, lastEigenpair.vector)
        lastGeneralizedResidual = bandedBucklingResidual(
          elasticStiffness,
          geometricStiffness,
          candidateMode,
          candidateFactor,
        )
        // Оценка beta*e_m^T*y дешёвая, но после полной reorthogonalization сама
        // по себе не является достаточным критерием. Останавливаемся только по
        // реальной невязке исходного generalized equation (K+lambda*KG)phi=0.
        if (lastGeneralizedResidual <= tolerance) break
      }
    }

    if (!(beta > 1e-14)) break
    offDiagonal.push(beta)
    previous = current
    current = Float64Array.from(nextResidual, (value) => value / beta)
    previousBeta = beta
  }

  if (!lastEigenpair) lastEigenpair = largestEigenpairTridiagonal(diagonal, offDiagonal)
  if (!(lastEigenpair.eigenvalue > 1e-12)) {
    return {
      factor: Number.POSITIVE_INFINITY,
      mode: new Array(size).fill(0),
      residual: 0,
      eigenResidual: lastEigenpair.residual,
      iterations,
    }
  }

  const factor = 1 / lastEigenpair.eigenvalue
  const mode = buildRitzMode(basis, lastEigenpair.vector)
  const residual = bandedBucklingResidual(elasticStiffness, geometricStiffness, mode, factor)
  return {
    factor,
    mode,
    residual,
    eigenResidual: lastEigenpair.residual,
    iterations,
  }
}
