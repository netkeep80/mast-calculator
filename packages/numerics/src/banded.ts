export interface SymmetricBandMatrix {
  size: number
  bandwidth: number
  rows: Float64Array[]
}

export interface SymmetricBandFactorization {
  lower: SymmetricBandMatrix
  minPivotRatio: number
}

type NumericArray = ArrayLike<number>
type NumericMatrix = readonly (readonly number[])[]

export function createSymmetricBandMatrix(size: number, bandwidth: number): SymmetricBandMatrix {
  const n = Math.max(0, Math.floor(size))
  const bw = Math.max(0, Math.floor(bandwidth))
  return {
    size: n,
    bandwidth: bw,
    rows: Array.from({ length: n }, () => new Float64Array(bw + 1)),
  }
}

export function cloneSymmetricBandMatrix(matrix: SymmetricBandMatrix): SymmetricBandMatrix {
  return {
    size: matrix.size,
    bandwidth: matrix.bandwidth,
    rows: matrix.rows.map((row) => Float64Array.from(row)),
  }
}

function orderedIndices(row: number, column: number): [number, number] {
  return row >= column ? [row, column] : [column, row]
}

export function getBandValue(matrix: SymmetricBandMatrix, row: number, column: number): number {
  const [high, low] = orderedIndices(row, column)
  const offset = high - low
  if (high < 0 || high >= matrix.size || low < 0 || offset > matrix.bandwidth) return 0
  return matrix.rows[high]![offset]!
}

export function addBandValue(matrix: SymmetricBandMatrix, row: number, column: number, value: number): void {
  if (value === 0) return
  const [high, low] = orderedIndices(row, column)
  const offset = high - low
  if (high < 0 || high >= matrix.size || low < 0 || low >= matrix.size) {
    throw new Error('Индекс ленточной матрицы вне диапазона')
  }
  if (offset > matrix.bandwidth) {
    throw new Error(`Элемент (${row}, ${column}) выходит за полуширину ленты ${matrix.bandwidth}`)
  }
  const bandRow = matrix.rows[high]!
  bandRow[offset] = bandRow[offset]! + value
}

export function multiplySymmetricBand(matrix: SymmetricBandMatrix, vector: NumericArray): Float64Array {
  if (vector.length !== matrix.size) throw new Error('Несогласованный размер вектора')
  const result = new Float64Array(matrix.size)
  for (let row = 0; row < matrix.size; row += 1) {
    const values = matrix.rows[row]!
    result[row] = result[row]! + values[0]! * vector[row]!
    const maximumOffset = Math.min(matrix.bandwidth, row)
    for (let offset = 1; offset <= maximumOffset; offset += 1) {
      const column = row - offset
      const value = values[offset]!
      if (value === 0) continue
      result[row] = result[row]! + value * vector[column]!
      result[column] = result[column]! + value * vector[row]!
    }
  }
  return result
}

export function dotProduct(left: NumericArray, right: NumericArray): number {
  if (left.length !== right.length) throw new Error('Несогласованный размер векторов')
  let sum = 0
  for (let index = 0; index < left.length; index += 1) sum += left[index]! * right[index]!
  return sum
}

export function vectorNorm2(vector: NumericArray): number {
  return Math.sqrt(Math.max(0, dotProduct(vector, vector)))
}

export function factorSymmetricBand(matrix: SymmetricBandMatrix): SymmetricBandFactorization {
  const factor = createSymmetricBandMatrix(matrix.size, matrix.bandwidth)
  let minimumPivot = Number.POSITIVE_INFINITY
  let maximumPivot = 0
  let diagonalScale = 1
  for (let row = 0; row < matrix.size; row += 1) {
    diagonalScale = Math.max(diagonalScale, Math.abs(getBandValue(matrix, row, row)))
  }

  for (let row = 0; row < matrix.size; row += 1) {
    const firstColumn = Math.max(0, row - matrix.bandwidth)
    for (let column = firstColumn; column <= row; column += 1) {
      let value = getBandValue(matrix, row, column)
      const firstShared = Math.max(
        0,
        row - matrix.bandwidth,
        column - matrix.bandwidth,
      )
      for (let index = firstShared; index < column; index += 1) {
        value -= getBandValue(factor, row, index) * getBandValue(factor, column, index)
      }

      if (row === column) {
        if (!(value > diagonalScale * 1e-13)) {
          throw new Error(`Матрица жёсткости не является положительно определённой около степени свободы ${row}`)
        }
        minimumPivot = Math.min(minimumPivot, value)
        maximumPivot = Math.max(maximumPivot, value)
        factor.rows[row]![0] = Math.sqrt(value)
      } else {
        factor.rows[row]![row - column] = value / factor.rows[column]![0]!
      }
    }
  }

  return {
    lower: factor,
    minPivotRatio: maximumPivot > 0 ? minimumPivot / maximumPivot : 0,
  }
}

export function solveSymmetricBandFactor(
  factorization: SymmetricBandFactorization | SymmetricBandMatrix,
  rhs: NumericArray,
): Float64Array {
  const lower = 'lower' in factorization ? factorization.lower : factorization
  if (rhs.length !== lower.size) throw new Error('Несогласованный размер правой части')
  const intermediate = new Float64Array(lower.size)
  for (let row = 0; row < lower.size; row += 1) {
    let value = rhs[row]!
    const firstColumn = Math.max(0, row - lower.bandwidth)
    for (let column = firstColumn; column < row; column += 1) {
      value -= getBandValue(lower, row, column) * intermediate[column]!
    }
    intermediate[row] = value / lower.rows[row]![0]!
  }

  const solution = new Float64Array(lower.size)
  for (let row = lower.size - 1; row >= 0; row -= 1) {
    let value = intermediate[row]!
    const lastRow = Math.min(lower.size - 1, row + lower.bandwidth)
    for (let below = row + 1; below <= lastRow; below += 1) {
      value -= getBandValue(lower, below, row) * solution[below]!
    }
    solution[row] = value / lower.rows[row]![0]!
  }
  return solution
}

export function relativeBandResidual(
  matrix: SymmetricBandMatrix,
  solution: NumericArray,
  rhs: NumericArray,
): number {
  const product = multiplySymmetricBand(matrix, solution)
  let residualSquared = 0
  let rhsSquared = 0
  for (let index = 0; index < matrix.size; index += 1) {
    const residual = product[index]! - rhs[index]!
    residualSquared += residual * residual
    rhsSquared += rhs[index]! * rhs[index]!
  }
  return Math.sqrt(residualSquared) / Math.max(1, Math.sqrt(rhsSquared))
}

export function denseToSymmetricBand(matrix: NumericMatrix, tolerance = 0): SymmetricBandMatrix {
  const size = matrix.length
  let bandwidth = 0
  for (let row = 0; row < size; row += 1) {
    if (matrix[row]!.length !== size) throw new Error('Матрица должна быть квадратной')
    for (let column = 0; column <= row; column += 1) {
      if (Math.abs(matrix[row]![column]!) > tolerance) bandwidth = Math.max(bandwidth, row - column)
    }
  }
  const band = createSymmetricBandMatrix(size, bandwidth)
  for (let row = 0; row < size; row += 1) {
    for (let column = Math.max(0, row - bandwidth); column <= row; column += 1) {
      band.rows[row]![row - column] = matrix[row]![column]!
    }
  }
  return band
}
