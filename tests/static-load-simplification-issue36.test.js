import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PARAMETERS, calculateCompleteMastWithConfiguredJoint, resolveCalculationParameters } from '../packages/application/index.js'
import { calculateLateralCapacity, calculateStaticPayloadCapacity } from '../packages/engineering/index.js'
import { generateMastModel } from '../packages/structural-analysis/index.js'

const rootUrl = new URL('../', import.meta.url)
const completeSource = fs.readFileSync(fileURLToPath(new URL('packages/application/src/complete-calculation.js', rootUrl)), 'utf8')
const usageSource = fs.readFileSync(fileURLToPath(new URL('apps/web/usage-scenarios.js', rootUrl)), 'utf8')
const htmlSource = fs.readFileSync(fileURLToPath(new URL('apps/web/index.html', rootUrl)), 'utf8')

const approximately = (actual, expected, relative = 1e-9, absolute = 1e-12) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `ожидалось ${expected}, получено ${actual}, допуск ${tolerance}`)
}

test('issue #36: раскрой содержит каждый целый вариант 1…48', () => {
  const catalogSource = fs.readFileSync(fileURLToPath(new URL('packages/domain/src/catalog.js', rootUrl)), 'utf8')
  assert.match(catalogSource, /Array\.from\(\{ length: 48 \}, \(_, index\) => index \+ 1\)/)
})

test('issue #36: legacy дополнительные силы не влияют на обычный пользовательский load case', async () => {
  const { buildLoadCase } = await import('../packages/structural-analysis/index.js')
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    extraHorizontalLoadN: 1e9,
    extraVerticalLoadN: 1e9,
  })
  const clean = { ...parameters }
  delete clean.extraHorizontalLoadN
  delete clean.extraVerticalLoadN
  const model = generateMastModel(parameters)
  assert.deepEqual(buildLoadCase(model, parameters), buildLoadCase(model, clean))
})

test('issue #36: внутренний unit-load имеет отдельный API и не требует поля формы', async () => {
  const { buildLoadCase } = await import('../packages/structural-analysis/index.js')
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
  })
  const model = generateMastModel(parameters)
  const reference = buildLoadCase(model, parameters, { topPointLoadN: [123, 0, 0] })
  approximately(reference.totalAppliedLoad[0], 123, 1e-12, 1e-12)
})

test('issue #36: статический предел возвращает массу и остаток без отдельного эквивалента воды', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    equipmentMassKg: 20,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  })
  const capacity = calculateStaticPayloadCapacity(generateMastModel(parameters), parameters)

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

test('issue #36: полный пользовательский расчёт включает отдельную горизонтальную стрелу без post-result mutation', () => {
  assert.match(completeSource, /const craneBoomCapacity = calculateCraneBoomCapacity/)
  assert.match(completeSource, /\n\s+craneBoomCapacity,\n/)
  assert.doesNotMatch(completeSource, /result\.craneBoomCapacity\s*=/)
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

test('issue #36: полный пользовательский расчёт действительно возвращает отдельную стрелу', () => {
  const result = calculateCompleteMastWithConfiguredJoint({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
    heightSearchMaxModules: 2,
  })
  assert.ok(result.craneBoomCapacity)
  assert.ok(result.craneBoomCapacity.maximumEndPayloadMassKg > 0)
})

test('issue #36: форма не публикует legacy произвольные силы', () => {
  assert.doesNotMatch(htmlSource, /name=["']extraHorizontalLoadN["']/)
  assert.doesNotMatch(htmlSource, /name=["']extraVerticalLoadN["']/)
})
