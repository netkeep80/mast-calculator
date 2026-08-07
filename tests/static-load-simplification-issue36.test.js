import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  STOCK_BAR_DIVISIONS,
  theoreticalCutLengthMm,
} from '../packages/domain/index.js'
import { DEFAULT_PARAMETERS, calculateMast, resolveCalculationParameters } from '../packages/application/index.js'
import { generateMastModel } from '../packages/structural-analysis/index.js'
import { calculateLateralCapacity } from '../packages/engineering/index.js'
import { buildLoadCase } from '../packages/structural-analysis/index.js'
import { calculateStaticPayloadCapacity } from '../packages/engineering/index.js'

const usageSource = fs.readFileSync(new URL('../site/usage-scenarios.js', import.meta.url), 'utf8')
const loadsSource = fs.readFileSync(new URL('../site/engine/loads.js', import.meta.url), 'utf8')
const completeSource = fs.readFileSync(new URL('../site/engine/complete-calculation.js', import.meta.url), 'utf8')

test('issue #36: раскрой содержит каждый целый вариант 1…48', () => {
  assert.deepEqual(STOCK_BAR_DIVISIONS, Array.from({ length: 48 }, (_, index) => index + 1))
  assert.equal(theoreticalCutLengthMm(12000, 1), 12000)
  assert.equal(theoreticalCutLengthMm(12000, 48), 250)
  assert.throws(() => theoreticalCutLengthMm(12000, 49), /от 1 до 48/)
})

test('issue #36: legacy дополнительные силы не влияют на обычный пользовательский load case', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windPressurePa: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
  })
  const model = generateMastModel(parameters)
  const clean = buildLoadCase(model, parameters)
  const legacy = buildLoadCase(model, {
    ...parameters,
    extraHorizontalLoadN: 25000,
    extraVerticalLoadN: 50000,
  })

  assert.deepEqual(legacy.totalAppliedLoad, clean.totalAppliedLoad)
  assert.doesNotMatch(loadsSource, /parameters\.extraHorizontalLoadN/)
  assert.doesNotMatch(loadsSource, /parameters\.extraVerticalLoadN/)
})

test('issue #36: внутренний unit-load имеет отдельный API и не требует поля формы', () => {
  const model = {
    nodes: [
      { id: 0, position: [0, 0, 0], restrained: [false, false, false, false, false, false] },
      { id: 1, position: [1, 0, 0], restrained: [false, false, false, false, false, false] },
      { id: 2, position: [0, 1, 0], restrained: [false, false, false, false, false, false] },
    ],
    members: [],
    topNodeIds: [0, 1, 2],
  }
  const loads = buildLoadCase(model, {
    ...DEFAULT_PARAMETERS,
    windPressurePa: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
  }, { topPointLoadN: [9, 6, -3] })

  assert.deepEqual(loads.nodalLoads, [[3, 2, -1], [3, 2, -1], [3, 2, -1]])
  assert.deepEqual(loads.topPointLoadN, [9, 6, -3])
})

test('issue #36: статический предел возвращает массу и остаток без отдельного эквивалента воды', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    equipmentMassKg: 20,
    windEnvelopeEnabled: false,
  })
  const capacity = calculateStaticPayloadCapacity(result.model, result.parameters)

  assert.ok(capacity.maximumTopEquipmentMassKg > 20)
  assert.equal(capacity.configuredTopEquipmentMassKg, 20)
  assert.ok(Math.abs(
    capacity.additionalTopEquipmentMassKg - (capacity.maximumTopEquipmentMassKg - 20),
  ) < 1e-9)
  assert.equal('equivalentWaterVolumeM3' in capacity, false)
  assert.equal('equivalentWaterVolumeLiters' in capacity, false)
})

test('issue #36: чистый боковой предел остаётся независимым reference upper bound', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  })
  const result = calculateLateralCapacity(generateMastModel(parameters), parameters)

  assert.equal(result.idealizedCraneBoomPayloadKg, result.criticalForceKgf)
  assert.match(result.craneBoomInterpretation, /консольн/i)
  assert.match(result.craneBoomInterpretation, /собственн.*вес/i)
})

test('issue #36: полный пользовательский расчёт добавляет отдельную горизонтальную стрелу', () => {
  assert.match(completeSource, /calculateCraneBoomCapacity/)
  assert.match(completeSource, /result\.craneBoomCapacity/)
})

test('issue #36: браузерный сценарный слой удаляет две дополнительные силы, скрывает воду и показывает стрелу', () => {
  assert.match(usageSource, /removeLegacyForceControl\('extraHorizontalLoadN'\)/)
  assert.match(usageSource, /removeLegacyForceControl\('extraVerticalLoadN'\)/)
  assert.match(usageSource, /metric-water-volume/)
  assert.match(usageSource, /waterArticle\.hidden = true/)
  assert.doesNotMatch(usageSource, /equivalentWaterVolumeM3/)
  assert.match(usageSource, /Горизонтальная стрела/)
  assert.match(usageSource, /boomSelfMassEquivalentKg/)
  assert.match(usageSource, /Сколько ещё можно добавить сверху/)
})
