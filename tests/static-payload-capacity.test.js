import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMast, DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import {
  calculateStaticPayloadCapacity,
  STATIC_PAYLOAD_PROGRESS_STEPS,
} from '../site/engine/static-payload-capacity.js'

function oneModule(parameters = {}) {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    equipmentMassKg: 0,
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

  assert.ok(Number.isFinite(capacity.maximumTopEquipmentMassKg))
  assert.ok(capacity.maximumTopEquipmentMassKg > 0)
  assert.equal(capacity.maximumTotalTopMassKg, capacity.maximumTopEquipmentMassKg)
  assert.ok(capacity.baseSelfWeightN > 0)
  assert.ok(capacity.maximumTopEquipmentMassKg <= capacity.purePayloadReference.criticalLimitKg * 1.000001)
  assert.ok(capacity.utilizationAtLimit <= 1.00001)
  assert.ok(capacity.bucklingFactorAtLimit >= 0.9999)
  assert.equal(events.at(-1).completed, STATIC_PAYLOAD_PROGRESS_STEPS)
  assert.equal(events.at(-1).total, STATIC_PAYLOAD_PROGRESS_STEPS)
})

test('остаток массы зависит только от уже заданной массы оборудования', () => {
  const { model, parameters } = oneModule({
    equipmentMassKg: 25,
    // Legacy-поле намеренно передано для защиты от возврата старой семантики.
    // Issue #36 удаляет произвольную вертикальную силу из пользовательской модели.
    extraVerticalLoadN: 750,
  })
  const capacity = calculateStaticPayloadCapacity(model, parameters)
  const expectedReserve = Math.max(0, capacity.maximumTopEquipmentMassKg - 25)

  assert.equal(capacity.configuredTopEquipmentMassKg, 25)
  assert.equal(capacity.configuredEquivalentTopMassKg, 25)
  assert.ok(Math.abs(capacity.additionalTopEquipmentMassKg - expectedReserve) < 1e-9)
  assert.equal(capacity.remainingAdditionalMassKg, capacity.additionalTopEquipmentMassKg)
})

test('эквивалент воды больше не является результатом статической грузоподъёмности', () => {
  const { model, parameters } = oneModule()
  const capacity = calculateStaticPayloadCapacity(model, parameters)

  assert.equal('waterDensityKgM3' in capacity, false)
  assert.equal('equivalentWaterVolumeM3' in capacity, false)
  assert.equal('equivalentWaterVolumeLiters' in capacity, false)
})

test('специальный статический сценарий не зависит от ветра и льда', () => {
  const first = oneModule({ windPressurePa: 100, iceThicknessMm: 0 })
  const second = oneModule({ windPressurePa: 1500, iceThicknessMm: 30 })
  const a = calculateStaticPayloadCapacity(first.model, first.parameters)
  const b = calculateStaticPayloadCapacity(second.model, second.parameters)

  assert.ok(Math.abs(a.maximumTopEquipmentMassKg - b.maximumTopEquipmentMassKg) < 1e-8)
})

test('увеличение диаметра арматуры повышает статическую грузоподъёмность вершины', () => {
  const thin = oneModule({ barDiameterMm: 12 })
  const thick = oneModule({ barDiameterMm: 20 })
  const thinCapacity = calculateStaticPayloadCapacity(thin.model, thin.parameters)
  const thickCapacity = calculateStaticPayloadCapacity(thick.model, thick.parameters)

  assert.ok(thickCapacity.maximumTopEquipmentMassKg > thinCapacity.maximumTopEquipmentMassKg)
})
