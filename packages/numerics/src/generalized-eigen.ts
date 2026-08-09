import {
  dotProduct,
  multiplySymmetricBand,
  solveSymmetricBandFactor,
  vectorNorm2,
  type SymmetricBandFactorization,
  type SymmetricBandMatrix,
} from './banded.js'

type NumericArray = ArrayLike<number>

export interface GeneralizedEigenOptions {
  readonly eigenpairCount?: number
  readonly tolerance?: number
  readonly maxIterations?: number
  readonly oversampling?: number
}

export interface GeneralizedEigenpair {
  readonly eigenvalue: number
  readonly vector: number[]
  readonly residual: number
}

export interface GeneralizedEigenResult {
  readonly eigenpairs: GeneralizedEigenpair[]
  readonly iterations: number
  readonly subspaceDimension: number
}

interface DenseEigenpair {
  readonly eigenvalue: number
  readonly vector: number[]
}

const EPSILON = 1e-14

function symmetricJacobiEigenpairs(matrix: readonly (readonly number[])[]): DenseEigenpair[] {
  const size = matrix.length
  if (matrix.some((row) => row.length !== size)) throw new Error('Проекционная матрица должна быть квадратной')
  if (size === 0) return []

  const values = matrix.map((row) => [...row])
  const vectors = Array.from({ length: size }, (_, row) => (
    Array.from({ length: size }, (_, column) => row === column ? 1 : 0)
  ))
  const diagonalScale = Math.max(1, ...values.map((row, index) => Math.abs(row[index]!)))
  const maximumRotations = Math.max(32, size * size * 40)

  for (let rotation = 0; rotation < maximumRotations; rotation += 1) {
    let pivotRow = 0
    let pivotColumn = 0
    let maximumOffDiagonal = 0
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const candidate = Math.abs(values[row]![column]!)
        if (candidate > maximumOffDiagonal) {
          maximumOffDiagonal = candidate
          pivotRow = row
          pivotColumn = column
        }
      }
    }
    if (maximumOffDiagonal <= diagonalScale * 1e-13) break

    const app = values[pivotRow]![pivotRow]!
    const aqq = values[pivotColumn]![pivotColumn]!
    const apq = values[pivotRow]![pivotColumn]!
    const tau = (aqq - app) / (2 * apq)
    const tangent = tau === 0
      ? 1
      : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
    const cosine = 1 / Math.sqrt(1 + tangent * tangent)
    const sine = tangent * cosine

    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) continue
      const aip = values[index]![pivotRow]!
      const aiq = values[index]![pivotColumn]!
      const nextIp = cosine * aip - sine * aiq
      const nextIq = sine * aip + cosine * aiq
      values[index]![pivotRow] = nextIp
      values[pivotRow]![index] = nextIp
      values[index]![pivotColumn] = nextIq
      values[pivotColumn]![index] = nextIq
    }

    values[pivotRow]![pivotRow] = cosine * cosine * app
      - 2 * sine * cosine * apq
      + sine * sine * aqq
    values[pivotColumn]![pivotColumn] = sine * sine * app
      + 2 * sine * cosine * apq
      + cosine * cosine * aqq
    values[pivotRow]![pivotColumn] = 0
    values[pivotColumn]![pivotRow] = 0

    for (let row = 0; row < size; row += 1) {
      const vip = vectors[row]![pivotRow]!
      const viq = vectors[row]![pivotColumn]!
      vectors[row]![pivotRow] = cosine * vip - sine * viq
      vectors[row]![pivotColumn] = sine * vip + cosine * viq
    }
  }

  return Array.from({ length: size }, (_, index) => ({
    eigenvalue: values[index]![index]!,
    vector: vectors.map((row) => row[index]!),
  })).sort((left, right) => right.eigenvalue - left.eigenvalue)
}

function subtractScaled(target: Float64Array, source: NumericArray, scale: number): void {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = target[index]! - scale * source[index]!
  }
}

function stiffnessOrthonormalize(
  candidates: readonly NumericArray[],
  stiffness: SymmetricBandMatrix,
  targetCount: number,
): Float64Array[] {
  const basis: Float64Array[] = []
  for (const candidate of candidates) {
    if (candidate.length !== stiffness.size) throw new Error('Размер собственного вектора не соответствует матрице жёсткости')
    const vector = Float64Array.from(candidate)
    for (let pass = 0; pass < 2; pass += 1) {
      for (const previous of basis) {
        const stiffnessVector = multiplySymmetricBand(stiffness, vector)
        subtractScaled(vector, previous, dotProduct(previous, stiffnessVector))
      }
    }
    const stiffnessVector = multiplySymmetricBand(stiffness, vector)
    const norm = Math.sqrt(Math.max(0, dotProduct(vector, stiffnessVector)))
    if (!(norm > EPSILON)) continue
    for (let index = 0; index < vector.length; index += 1) vector[index] = vector[index]! / norm
    basis.push(vector)
    if (basis.length >= targetCount) break
  }
  return basis
}

function deterministicSeeds(size: number, count: number): Float64Array[] {
  return Array.from({ length: count * 2 }, (_, seed) => Float64Array.from(
    { length: size },
    (_, index) => (
      Math.sin((index + 1) * (seed + 1) * 0.7548776662466927)
      + Math.cos((index + 1) * (seed + 2) * 0.5698402909980532)
      + ((index + seed) % Math.max(2, count) === 0 ? 0.25 : 0)
    ),
  ))
}

function projectedOperator(
  basis: readonly Float64Array[],
  operator: SymmetricBandMatrix,
): number[][] {
  const products = basis.map((vector) => multiplySymmetricBand(operator, vector))
  return basis.map((left) => products.map((rightProduct) => dotProduct(left, rightProduct)))
}

function combineBasis(basis: readonly Float64Array[], coefficients: NumericArray): Float64Array {
  const result = new Float64Array(basis[0]?.length ?? 0)
  for (let basisIndex = 0; basisIndex < basis.length; basisIndex += 1) {
    const factor = coefficients[basisIndex] ?? 0
    const vector = basis[basisIndex]!
    for (let index = 0; index < result.length; index += 1) {
      result[index] = result[index]! + factor * vector[index]!
    }
  }
  return result
}

function generalizedResidual(
  stiffness: SymmetricBandMatrix,
  operator: SymmetricBandMatrix,
  vector: NumericArray,
  eigenvalue: number,
): number {
  const operatorPart = multiplySymmetricBand(operator, vector)
  const stiffnessPart = multiplySymmetricBand(stiffness, vector)
  const residual = new Float64Array(vector.length)
  for (let index = 0; index < residual.length; index += 1) {
    residual[index] = operatorPart[index]! - eigenvalue * stiffnessPart[index]!
  }
  return vectorNorm2(residual) / Math.max(
    Number.EPSILON,
    vectorNorm2(operatorPart),
    Math.abs(eigenvalue) * vectorNorm2(stiffnessPart),
  )
}

/**
 * Solves B·x = μ·K·x for the largest positive μ, where K is symmetric
 * positive definite and B is symmetric (positive semidefinite is allowed).
 *
 * The production matrices stay banded. A small Rayleigh–Ritz projection is
 * diagonalized with a dense Jacobi rotation, while each subspace iteration
 * applies K⁻¹ through the already validated banded Cholesky factorization.
 */
export function largestGeneralizedEigenpairsBanded(
  stiffness: SymmetricBandMatrix,
  stiffnessFactorization: SymmetricBandFactorization | SymmetricBandMatrix,
  operator: SymmetricBandMatrix,
  options: GeneralizedEigenOptions = {},
): GeneralizedEigenResult {
  if (operator.size !== stiffness.size) throw new Error('Обобщённая собственная задача имеет несогласованные размеры')
  const size = stiffness.size
  const requestedCount = Math.max(1, Math.floor(options.eigenpairCount ?? 1))
  if (requestedCount > size) throw new Error('Запрошено больше собственных пар, чем степеней свободы')
  if (size === 0) return { eigenpairs: [], iterations: 0, subspaceDimension: 0 }

  const tolerance = options.tolerance ?? 1e-9
  const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? 80))
  const oversampling = Math.max(0, Math.floor(options.oversampling ?? 4))
  const subspaceDimension = Math.min(size, Math.max(requestedCount, requestedCount + oversampling))
  const seeds = deterministicSeeds(size, subspaceDimension)
  let basis = stiffnessOrthonormalize(seeds, stiffness, subspaceDimension)
  if (basis.length < requestedCount) throw new Error('Не удалось построить начальное подпространство собственных форм')

  let latest: GeneralizedEigenpair[] = []
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const iterated = basis.map((vector) => {
      const applied = multiplySymmetricBand(operator, vector)
      return solveSymmetricBandFactor(stiffnessFactorization, applied)
    })
    const candidates = [...iterated, ...seeds]
    const nextBasis = stiffnessOrthonormalize(candidates, stiffness, subspaceDimension)
    if (nextBasis.length < requestedCount) throw new Error('Оператор имеет недостаточный ранг для запрошенных собственных форм')

    const projected = projectedOperator(nextBasis, operator)
    const densePairs = symmetricJacobiEigenpairs(projected)
    const rotated = densePairs.map((pair) => combineBasis(nextBasis, pair.vector))
    basis = stiffnessOrthonormalize(rotated, stiffness, nextBasis.length)

    latest = densePairs
      .filter((pair) => pair.eigenvalue > EPSILON)
      .slice(0, requestedCount)
      .map((pair, index) => {
        const vector = basis[index]
        if (!vector) throw new Error('Потеряна собственная форма после ортонормализации')
        return {
          eigenvalue: pair.eigenvalue,
          vector: Array.from(vector),
          residual: generalizedResidual(stiffness, operator, vector, pair.eigenvalue),
        }
      })

    if (latest.length >= requestedCount && latest.every((pair) => pair.residual <= tolerance)) {
      return { eigenpairs: latest, iterations: iteration, subspaceDimension: nextBasis.length }
    }
  }

  if (latest.length < requestedCount) throw new Error('Не найдено требуемое число положительных собственных значений')
  return { eigenpairs: latest, iterations: maxIterations, subspaceDimension: basis.length }
}
