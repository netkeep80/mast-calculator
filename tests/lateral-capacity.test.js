import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, resolveCalculationParameters } from '../site/engine/calculate.js'
import { generateMastModel } from '../site/engine/geometry.js'
import {
  calculateLateralCapacity,
  STANDARD_GRAVITY_M_S2,
} from '../site/engine/lateral-capacity.js'

const approximately = (actual, expected, relative = 1e-8, absolute = 1e-9) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `ожидалось ${expected}, получено ${actual}, допуск ${tolerance}`,
  )
}

function verticalCantileverModel({ lengthM = 2, diameterM = 0.02 } = {}) {
  return {
    moduleCount: 1,
    topNodeIds: [1],
    nodes: [
      { id: 0, position: [0, 0, 0], restrained: [true, true, true, true, true, true] },
      { id: 1, position: [0, 0, lengthM], restrained: [false, false, false, false, false, false] },
    ],
    members: [{
      id: 0,
      nodeA: 0,
      nodeB: 1,
      diameterM,
      youngModulusPa: 200e9,
      yieldStrengthPa: 400e6,
      poissonRatio: 0.3,
      densityKgM3: 7850,
      effectiveLengthFactor: 0.5,
    }],
  }
}

test('боковая нагрузка круглой консоли совпадает с P = Ryd·W/L', () => {
  const lengthM = 2
  const diameterM = 0.02
  const model = verticalCantileverModel({ lengthM, diameterM })
  const parameters = {
    ...DEFAULT_PARAMETERS,
    materialSafetyFactor: 1,
    lateralCapacityStepDeg: 30,
  }
  const result = calculateLateralCapacity(model, parameters)
  const sectionModulusM3 = Math.PI * diameterM ** 3 / 32
  const expectedForceN = 400e6 * sectionModulusM3 / lengthM

  approximately(result.criticalForceN, expectedForceN, 1e-8)
  approximately(result.memberLimitForceN, expectedForceN, 1e-8)
  assert.equal(result.governingMode, 'material-strength')
  assert.equal(result.cases.length, 4)
  assert.equal(result.symmetrySectorDeg, 120)
  approximately(result.criticalForceKgf, expectedForceN / STANDARD_GRAVITY_M_S2, 1e-8)
})

test('расчёт боковой нагрузки мачты возвращает конечный положительный предел и худшее направление', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 30,
  })
  const model = generateMastModel(parameters)
  const result = calculateLateralCapacity(model, parameters)

  assert.ok(Number.isFinite(result.criticalForceN))
  assert.ok(result.criticalForceN > 0)
  assert.ok(result.criticalForceKgf > 0)
  assert.ok([0, 30, 60, 90].includes(result.directionDeg))
  assert.ok(['material-strength', 'local-member-buckling', 'global-buckling'].includes(result.governingMode))
  assert.equal(result.cases.length, 4)
})

test('увеличение диаметра ребра увеличивает боковую несущую способность', () => {
  const base = {
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 30,
  }

  const thinParameters = resolveCalculationParameters({ ...base, barDiameterMm: 10 })
  const thickParameters = resolveCalculationParameters({ ...base, barDiameterMm: 20 })
  const thin = calculateLateralCapacity(generateMastModel(thinParameters), thinParameters)
  const thick = calculateLateralCapacity(generateMastModel(thickParameters), thickParameters)

  assert.ok(thick.criticalForceN > thin.criticalForceN)
})

test('боковой тест явно не смешивается с погодными и постоянными нагрузками', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windPresetId: 'bft12',
    iceThicknessMm: 20,
    equipmentMassKg: 100,
    extraVerticalLoadN: 5000,
    lateralCapacityStepDeg: 60,
  })
  const result = calculateLateralCapacity(generateMastModel(parameters), parameters)

  assert.match(result.excludedLoads, /ветер/)
  assert.match(result.excludedLoads, /собственный вес/)
  assert.equal(result.cases.length, 2)
  assert.ok(result.criticalForceN > 0)
})
