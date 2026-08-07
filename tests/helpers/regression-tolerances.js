import assert from 'node:assert/strict'

export const REGRESSION_TOLERANCES = Object.freeze({
  dof: Object.freeze({ relative: 2e-8, absolute: 2e-10, unit: 'm/rad' }),
  force: Object.freeze({ relative: 2e-8, absolute: 1e-5, unit: 'N' }),
  moment: Object.freeze({ relative: 2e-8, absolute: 1e-6, unit: 'N·m' }),
  utilization: Object.freeze({ relative: 2e-8, absolute: 1e-10, unit: '1' }),
  eigenvalue: Object.freeze({ relative: 2e-7, absolute: 1e-8, unit: '1' }),
  residual: Object.freeze({ relative: 0, absolute: 1e-6, unit: '1' }),
  geometryMm: Object.freeze({ relative: 1e-10, absolute: 1e-7, unit: 'mm' }),
  massKg: Object.freeze({ relative: 2e-9, absolute: 1e-6, unit: 'kg' }),
  scalar: Object.freeze({ relative: 2e-8, absolute: 1e-10, unit: '1' }),
})

export function toleranceFor(kind, actual, expected) {
  const policy = REGRESSION_TOLERANCES[kind]
  if (!policy) throw new Error(`Неизвестный класс допуска regression: ${kind}`)
  const scale = Math.max(Math.abs(Number(actual) || 0), Math.abs(Number(expected) || 0), 1)
  return Math.max(policy.absolute, policy.relative * scale)
}

export function assertClose(actual, expected, kind, label = kind) {
  assert.ok(Number.isFinite(actual), `${label}: actual не является конечным числом (${actual})`)
  assert.ok(Number.isFinite(expected), `${label}: expected не является конечным числом (${expected})`)
  const tolerance = toleranceFor(kind, actual, expected)
  const difference = Math.abs(actual - expected)
  assert.ok(
    difference <= tolerance,
    `${label}: ожидалось ${expected}, получено ${actual}; |Δ|=${difference}, допуск=${tolerance} ${REGRESSION_TOLERANCES[kind].unit}`,
  )
}

export function assertVectorClose(actual, expected, kind, label = kind) {
  assert.equal(actual.length, expected.length, `${label}: различается длина вектора`)
  for (let index = 0; index < actual.length; index += 1) {
    assertClose(actual[index], expected[index], kind, `${label}[${index}]`)
  }
}
