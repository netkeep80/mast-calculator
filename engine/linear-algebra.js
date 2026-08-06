function validateSquareMatrix(matrix) {
  const size = matrix.length
  if (matrix.some((row) => row.length !== size)) throw new Error('Матрица должна быть квадратной')
  return size
}

export function solveDenseSystem(matrix, rhs) {
  const size = rhs.length
  if (matrix.length !== size || matrix.some((row) => row.length !== size)) {
    throw new Error('Матрица должна быть квадратной и соответствовать правой части')
  }

  const augmented = matrix.map((row, index) => [...row, rhs[index] ?? 0])
  let maximumPivot = 0
  let minimumPivot = Number.POSITIVE_INFINITY

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column
    let pivotAbs = Math.abs(augmented[column]?.[column] ?? 0)
    for (let row = column + 1; row < size; row += 1) {
      const candidate = Math.abs(augmented[row]?.[column] ?? 0)
      if (candidate > pivotAbs) {
        pivotAbs = candidate
        pivotRow = row
      }
    }

    const localScale = Math.max(
      1,
      ...augmented.slice(column).map((row) => Math.max(...row.slice(column, size).map(Math.abs))),
    )
    if (pivotAbs <= localScale * 1e-13) {
      throw new Error(`Матрица жёсткости вырождена около степени свободы ${column}`)
    }

    if (pivotRow !== column) {
      const temporary = augmented[column]
      augmented[column] = augmented[pivotRow]
      augmented[pivotRow] = temporary
    }

    maximumPivot = Math.max(maximumPivot, pivotAbs)
    minimumPivot = Math.min(minimumPivot, pivotAbs)
    const pivot = augmented[column][column]

    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / pivot
      if (Math.abs(factor) <= Number.EPSILON) continue
      augmented[row][column] = 0
      for (let index = column + 1; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index]
      }
    }
  }

  const solution = new Array(size).fill(0)
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = augmented[row][size]
    for (let column = row + 1; column < size; column += 1) {
      sum -= augmented[row][column] * solution[column]
    }
    solution[row] = sum / augmented[row][row]
  }

  return {
    solution,
    minPivotRatio: maximumPivot > 0 ? minimumPivot / maximumPivot : 0,
  }
}

export function relativeResidual(matrix, solution, rhs) {
  const residual = matrixVectorMultiply(matrix, solution).map((value, index) => value - (rhs[index] ?? 0))
  return vectorNorm(residual) / Math.max(1, vectorNorm(rhs))
}

export function choleskyDecomposition(matrix) {
  const size = validateSquareMatrix(matrix)
  const lower = Array.from({ length: size }, () => new Array(size).fill(0))
  const scale = Math.max(1, ...matrix.map((row, index) => Math.abs(row[index])))

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let value = matrix[row][column]
      for (let index = 0; index < column; index += 1) {
        value -= lower[row][index] * lower[column][index]
      }
      if (row === column) {
        if (value <= scale * 1e-13) throw new Error('Матрица упругой жёсткости не является положительно определённой')
        lower[row][column] = Math.sqrt(value)
      } else {
        lower[row][column] = value / lower[column][column]
      }
    }
  }
  return lower
}

export function invertLowerTriangular(lower) {
  const size = validateSquareMatrix(lower)
  const inverse = Array.from({ length: size }, () => new Array(size).fill(0))
  for (let column = 0; column < size; column += 1) {
    for (let row = 0; row < size; row += 1) {
      let value = row === column ? 1 : 0
      for (let index = 0; index < row; index += 1) value -= lower[row][index] * inverse[index][column]
      inverse[row][column] = value / lower[row][row]
    }
  }
  return inverse
}

export function transpose(matrix) {
  if (matrix.length === 0) return []
  return Array.from({ length: matrix[0].length }, (_, column) => matrix.map((row) => row[column]))
}

export function matrixMultiply(left, right) {
  const rows = left.length
  const shared = left[0]?.length ?? 0
  if (right.length !== shared) throw new Error('Несогласованные размеры матриц')
  const columns = right[0]?.length ?? 0
  const result = Array.from({ length: rows }, () => new Array(columns).fill(0))
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < shared; index += 1) {
      const factor = left[row][index]
      if (factor === 0) continue
      for (let column = 0; column < columns; column += 1) result[row][column] += factor * right[index][column]
    }
  }
  return result
}

export function matrixVectorMultiply(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0))
}

export function vectorNorm(vector) {
  return Math.hypot(...vector)
}

export function largestEigenpairSymmetric(matrix, options = {}) {
  const size = validateSquareMatrix(matrix)
  if (size === 0) return { eigenvalue: Number.NEGATIVE_INFINITY, vector: [], residual: 0, iterations: 0 }
  const tolerance = options.tolerance ?? 1e-10
  const maxIterations = options.maxIterations ?? 4000

  let lowerBound = Number.POSITIVE_INFINITY
  let scale = 1
  for (let row = 0; row < size; row += 1) {
    let radius = 0
    for (let column = 0; column < size; column += 1) {
      scale = Math.max(scale, Math.abs(matrix[row][column]))
      if (column !== row) radius += Math.abs(matrix[row][column])
    }
    lowerBound = Math.min(lowerBound, matrix[row][row] - radius)
  }
  const shift = lowerBound < 0 ? -lowerBound + scale * 1e-12 : 0
  let vector = Array.from({ length: size }, (_, index) => Math.sin((index + 1) * 1.61803398875) + 1.5)
  let norm = vectorNorm(vector)
  vector = vector.map((value) => value / norm)
  let eigenvalue = 0
  let residual = Number.POSITIVE_INFINITY

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const multiplied = matrixVectorMultiply(matrix, vector).map((value, index) => value + shift * vector[index])
    norm = vectorNorm(multiplied)
    if (norm <= Number.EPSILON) return { eigenvalue: -shift, vector, residual: 0, iterations: iteration }
    const next = multiplied.map((value) => value / norm)
    const originalProduct = matrixVectorMultiply(matrix, next)
    const nextEigenvalue = next.reduce((sum, value, index) => sum + value * originalProduct[index], 0)
    const difference = originalProduct.map((value, index) => value - nextEigenvalue * next[index])
    residual = vectorNorm(difference) / Math.max(1, Math.abs(nextEigenvalue))
    vector = next
    eigenvalue = nextEigenvalue
    if (residual <= tolerance) return { eigenvalue, vector, residual, iterations: iteration }
  }

  return { eigenvalue, vector, residual, iterations: maxIterations }
}
