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
  let residualSquared = 0
  let rhsSquared = 0
  for (let row = 0; row < rhs.length; row += 1) {
    let value = -(rhs[row] ?? 0)
    for (let column = 0; column < solution.length; column += 1) {
      value += matrix[row][column] * solution[column]
    }
    residualSquared += value * value
    rhsSquared += (rhs[row] ?? 0) ** 2
  }
  return Math.sqrt(residualSquared) / Math.max(1, Math.sqrt(rhsSquared))
}
