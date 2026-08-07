import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, calculateMast } from '../site/engine/calculate.js'
import {
  buildHorizontalBoomLoadCase,
  calculateCraneBoomCapacity,
} from '../site/engine/crane-boom-capacity.js'
import { calculateLateralCapacity } from '../site/engine/lateral-capacity.js'

const approximately = (actual, expected, relative = 1e-9, absolute = 1e-8) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}; tol=${tolerance}`)
}

function mast(overrides = {}) {
  return calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
    equipmentMassKg: 0,
    ...overrides,
  })
}

test('issue #36: горизонтальная стрела поворачивает собственный вес рёбер в поперечную нагрузку', () => {
  const result = mast()
  const loads = buildHorizontalBoomLoadCase(result.model, result.parameters, 0, 0)

  assert.ok(loads.selfWeightN > 0)
  approximately(loads.totalAppliedLoad[2], 0)
  approximately(loads.totalAppliedLoad[0], loads.selfWeightN)
  approximately(loads.nodalResultant[0], 0)
  assert.ok(loads.memberDistributedLoads.every((load) => Math.abs(load[2]) < 1e-12))
  assert.ok(loads.memberLoadDetails.every((item) => item.horizontalBoomGravity === true))
})

test('issue #36: концевой груз добавляется к собственному весу горизонтальной стрелы', () => {
  const result = mast({ equipmentLoadFactor: 1.1 })
  const loads = buildHorizontalBoomLoadCase(result.model, result.parameters, 25, 0)
  const expectedPayloadN = 25 * 9.80665 * 1.1

  approximately(loads.horizontalBoomPayloadForceN, expectedPayloadN)
  approximately(loads.nodalResultant[0], expectedPayloadN)
  approximately(loads.totalAppliedLoad[0], loads.selfWeightN + expectedPayloadN)
})

test('issue #36: расчёт стрелы возвращает конечный положительный предел концевой массы', () => {
  const result = mast()
  const boom = calculateCraneBoomCapacity(result.model, result.parameters, { stepDeg: 60 })

  assert.ok(Number.isFinite(boom.maximumEndPayloadMassKg))
  assert.ok(boom.maximumEndPayloadMassKg > 0)
  assert.ok(boom.boomSelfWeightN > 0)
  assert.ok(boom.boomSelfMassEquivalentKg > 0)
  assert.ok(Number.isFinite(boom.governingDirectionDeg))
  assert.match(boom.interpretation, /собственн.*вес/i)
})

test('issue #36: собственный вес горизонтальной стрелы уменьшает предел относительно чистого tip-load upper bound', () => {
  const result = mast()
  const boom = calculateCraneBoomCapacity(result.model, result.parameters, { stepDeg: 60 })
  const pure = calculateLateralCapacity(result.model, result.parameters, { stepDeg: 60 })

  assert.ok(boom.maximumEndPayloadMassKg < pure.idealizedCraneBoomPayloadKg)
})

test('issue #36: более толстая арматура повышает грузоподъёмность горизонтальной стрелы', () => {
  const thin = mast({ barDiameterMm: 12 })
  const thick = mast({ barDiameterMm: 20 })
  const thinBoom = calculateCraneBoomCapacity(thin.model, thin.parameters, { stepDeg: 60 })
  const thickBoom = calculateCraneBoomCapacity(thick.model, thick.parameters, { stepDeg: 60 })

  assert.ok(thickBoom.maximumEndPayloadMassKg > thinBoom.maximumEndPayloadMassKg)
})

test('issue #36: уже заданная масса вычитается из остающегося концевого груза стрелы', () => {
  const result = mast({ equipmentMassKg: 5 })
  const boom = calculateCraneBoomCapacity(result.model, result.parameters, { stepDeg: 60 })

  assert.equal(boom.configuredEndPayloadMassKg, 5)
  approximately(
    boom.additionalEndPayloadMassKg,
    Math.max(0, boom.maximumEndPayloadMassKg - 5),
  )
})
