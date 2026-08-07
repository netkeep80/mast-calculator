import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMast, DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { STANDARD_GRAVITY_M_S2 } from '../site/engine/lateral-capacity.js'
import {
  calculateStaticPayloadCapacity,
  STATIC_PAYLOAD_PROGRESS_STEPS,
  WATER_DENSITY_KG_M3,
} from '../site/engine/static-payload-capacity.js'

function oneModule(parameters = {}) {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    equipmentMassKg: 0,
    extraVerticalLoadN: 0,
    ...parameters,
  })
  return {
    model: result.model,
    parameters: result.parameters,
  }
}

test('статическая грузоподъёмность вершины конечна и ищется с собственным весом', () => {
  const { model, parameters } = oneModule()
  const events = []
  const capacity = calculateStaticPayloadCapacity(model, parameters, {
    onProgress: (event) => events.push(event),
  })

  assert.ok(Number.isFinite(capacity.maximumTotalTopMassKg))
  assert.ok(capacity.maximumTotalTopMassKg > 0)
  assert.ok(capacity.baseSelfWeightN > 0)
  assert.ok(capacity.maximumTotalTopMassKg <= capacity.purePayloadReference.criticalLimitKg * 1.000001)
  assert.ok(capacity.utilizationAtLimit <= 1.00001)
  assert.ok(capacity.bucklingFactorAtLimit >= 0.9999)
  assert.equal(events.at(-1).completed, STATIC_PAYLOAD_PROGRESS_STEPS)
  assert.equal(events.at(-1).total, STATIC_PAYLOAD_PROGRESS_STEPS)
})

test('остаток массы учитывает уже заданное оборудование и вертикальную силу', () => {
  const { model, parameters } = oneModule({
    equipmentMassKg: 25,
    extraVerticalLoadN: 750,
  })
  const capacity = calculateStaticPayloadCapacity(model, parameters)
  const equivalentExisting = 25 + 750 / (STANDARD_GRAVITY_M_S2 * parameters.equipmentLoadFactor)
  const expectedReserve = Math.max(0, capacity.maximumTotalTopMassKg - equivalentExisting)

  assert.ok(Math.abs(capacity.configuredEquivalentTopMassKg - equivalentExisting) < 1e-9)
  assert.ok(Math.abs(capacity.remainingAdditionalMassKg - expectedReserve) < 1e-9)
})

test('эквивалентный объём воды согласован с массой и плотностью 1000 кг/м³', () => {
  const { model, parameters } = oneModule()
  const capacity = calculateStaticPayloadCapacity(model, parameters)

  assert.equal(capacity.waterDensityKgM3, WATER_DENSITY_KG_M3)
  assert.ok(Math.abs(
    capacity.equivalentWaterVolumeM3
      - capacity.remainingAdditionalMassKg / WATER_DENSITY_KG_M3,
  ) < 1e-12)
  assert.ok(Math.abs(
    capacity.equivalentWaterVolumeLiters
      - capacity.equivalentWaterVolumeM3 * 1000,
  ) < 1e-9)
})

test('специальный статический сценарий не зависит от ветра и льда', () => {
  const first = oneModule({ windPressurePa: 100, iceThicknessMm: 0 })
  const second = oneModule({ windPressurePa: 1500, iceThicknessMm: 30 })
  const a = calculateStaticPayloadCapacity(first.model, first.parameters)
  const b = calculateStaticPayloadCapacity(second.model, second.parameters)

  assert.ok(Math.abs(a.maximumTotalTopMassKg - b.maximumTotalTopMassKg) < 1e-8)
})

test('увеличение диаметра арматуры повышает статическую грузоподъёмность вершины', () => {
  const thin = oneModule({ barDiameterMm: 12 })
  const thick = oneModule({ barDiameterMm: 20 })
  const thinCapacity = calculateStaticPayloadCapacity(thin.model, thin.parameters)
  const thickCapacity = calculateStaticPayloadCapacity(thick.model, thick.parameters)

  assert.ok(thickCapacity.maximumTotalTopMassKg > thinCapacity.maximumTotalTopMassKg)
})
