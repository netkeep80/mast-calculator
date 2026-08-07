import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBoltRecommendations,
  calculateBoltCapacity,
  checkBoltDemand,
  minimumBoltForClass,
} from '../site/engine/bolt-check.js'
import {
  getBoltSize,
  metricThreadStressAreaMm2,
} from '../site/engine/connection-catalog.js'
import { DEFAULT_PARAMETERS, calculateCompleteMast, calculateMast } from '../site/engine/calculate.js'
import {
  calculateMinimumWeldLength,
  recommendWeldConsumable,
} from '../site/engine/weld-check.js'

const approximately = (actual, expected, relative = 1e-10, absolute = 1e-9) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}; tol=${tolerance}`)
}

test('M24×3 имеет нормативную площадь резьбового сечения порядка 353 мм²', () => {
  const size = getBoltSize(24)
  const formulaArea = metricThreadStressAreaMm2(24, 3)
  assert.equal(size.netAreaMm2, 353)
  assert.ok(Math.abs(formulaArea - size.netAreaMm2) / size.netAreaMm2 < 0.01)
})

test('M24 8.8 воспроизводит расчетные сопротивления СП 16 по срезу и растяжению', () => {
  const capacity = calculateBoltCapacity({
    diameterMm: 24,
    boltClass: '8.8',
    connectionConditionFactor: 1,
    shearPlanes: 1,
  })
  approximately(capacity.shearCapacityN, 332 * 452)
  approximately(capacity.tensionCapacityN, 451 * 353)
  approximately(capacity.characteristicRuptureN, 830 * 353)
})

test('совместное растяжение и срез болта проверяются по эллиптическому взаимодействию', () => {
  const capacity = calculateBoltCapacity({ diameterMm: 24, boltClass: '8.8' })
  const result = checkBoltDemand({
    tensionN: capacity.tensionCapacityN * 0.6,
    shearN: capacity.shearCapacityN * 0.8,
  }, {
    diameterMm: 24,
    boltClass: '8.8',
  })
  approximately(result.interactionUtilization, 1)
  approximately(result.utilization, 1)
  assert.equal(result.passes, true)
})

test('для чистого растяжения 100 кН минимальный болт класса 8.8 — M20', () => {
  const result = minimumBoltForClass([{ tensionN: 100_000, shearN: 0 }], '8.8')
  assert.equal(result.recommended?.diameterMm, 20)
  assert.equal(result.candidates.find((item) => item.diameterMm === 16)?.passes, false)
})

test('класс 5.8 не объявляется пригодным к растяжению без Rbt в таблице Г.5', () => {
  const check = checkBoltDemand({ tensionN: 1000, shearN: 0 }, {
    diameterMm: 24,
    boltClass: '5.8',
  })
  assert.equal(check.tensionSupported, false)
  assert.equal(check.passes, false)
  assert.equal(check.utilization, Number.POSITIVE_INFINITY)
})

test('подбор формируется отдельно для каждого поддерживаемого класса прочности', () => {
  const recommendations = buildBoltRecommendations([{ tensionN: 40_000, shearN: 20_000 }])
  assert.deepEqual(recommendations.map((item) => item.boltClass), ['5.6', '5.8', '8.8', '10.9', '12.9'])
  assert.equal(recommendations.find((item) => item.boltClass === '5.8')?.recommended, null)
  assert.ok(recommendations.find((item) => item.boltClass === '8.8')?.recommended)
})

test('два модуля создают ровно три физических межмодульных болта и каждый передает две верхние диагонали', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: false,
    windDirectionDeg: 0,
  })
  assert.equal(result.connections.jointCount, 3)
  assert.equal(result.connections.jointDemandCount, 3)
  assert.equal(result.connections.bolt.selected.applicable, true)
  assert.ok(result.connections.bolt.selected.utilization >= 0)
  assert.ok(result.connections.jointDemands.every((item) => item.level === 1))
  assert.ok(result.connections.jointDemands.every((item) => item.upperMemberIds.length === 2))
})

test('для одного модуля внутренний соединительный болт не выдумывается', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
  })
  assert.equal(result.connections.jointCount, 0)
  assert.equal(result.connections.bolt.selected.applicable, false)
  assert.equal(result.connections.bolt.selected.utilization, 0)
})

test('более прочный и крупный болт повышает отдельный боковой предел соединения', () => {
  const common = {
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 120,
    lateralCapacityStepDeg: 60,
  }
  const weak = calculateCompleteMast({
    ...common,
    jointBoltDiameterMm: 16,
    jointBoltClass: '5.6',
  })
  const strong = calculateCompleteMast({
    ...common,
    jointBoltDiameterMm: 48,
    jointBoltClass: '12.9',
  })
  assert.ok(strong.lateralCapacity.boltLimitForceN > weak.lateralCapacity.boltLimitForceN)
  assert.ok(strong.staticPayloadCapacity.purePayloadReference.boltLimitKg > weak.staticPayloadCapacity.purePayloadReference.boltLimitKg)
})

test('чистая осевая сила дает проверяемую минимальную длину сварки', () => {
  const check = calculateMinimumWeldLength({
    axialForceN: 100_000,
    shearForceN: 0,
    torsionNm: 0,
    bendingNm: 0,
  }, {
    consumableId: 'electrode-e50a-uoni-13-55',
    weldLegMm: 4,
    segmentCount: 3,
    betaF: 0.7,
    betaZ: 1,
    connectionConditionFactor: 1,
    baseMetalRunMPa: 490,
    weldGroupRadiusMm: 6,
  })
  const expectedByWeldMetal = 100_000 / (0.7 * 4 * 215)
  approximately(check.requiredByWeldMetalMm, expectedByWeldMetal)
  approximately(check.requiredEffectiveLengthMm, expectedByWeldMetal)
  approximately(check.requiredPhysicalLengthMm, expectedByWeldMetal + 30)
})

test('минимальная конструктивная расчетная длина шва не меньше 40 мм и 4kf', () => {
  const check = calculateMinimumWeldLength({ axialForceN: 1000 }, {
    consumableId: 'electrode-e50a-uoni-13-55',
    weldLegMm: 12,
    segmentCount: 1,
    baseMetalRunMPa: 490,
    weldGroupRadiusMm: 10,
  })
  assert.equal(check.codeMinimumEffectiveMm, 48)
  assert.equal(check.requiredEffectiveLengthMm, 48)
  assert.equal(check.requiredPhysicalLengthMm, 58)
})

test('для Run=490 МПа каталог рекомендует Э50А/УОНИ и Св-08Г2С базового уровня Э50', () => {
  const electrode = recommendWeldConsumable({ process: 'electrode', baseMetalRunMPa: 490 })
  const wire = recommendWeldConsumable({ process: 'wire', baseMetalRunMPa: 490 })
  assert.equal(electrode.recommended?.id, 'electrode-e50a-uoni-13-55')
  assert.equal(wire.recommended?.id, 'wire-sv08g2s')
})

test('огибающая сварки хранит по одному определяющему случаю на каждый физический конец ребра', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 60,
  })
  assert.equal(result.connections.weld.envelope.length, result.model.members.length * 2)
  assert.ok(result.connections.weld.critical.check.requiredPhysicalLengthMm >= 40)
  assert.ok(result.connections.weld.envelope.every((item) => Number.isFinite(item.windDirectionDeg)))
})
