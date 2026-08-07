import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { createCalculationProjectHtml } from '../site/engine/calculation-project.js'
import { calculateCompleteMastWithConfiguredJoint } from '../site/engine/complete-calculation.js'

test('полный пользовательский расчёт содержит сборочную массу и горизонтальную стрелу до экспорта документа', () => {
  const result = calculateCompleteMastWithConfiguredJoint({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    heightSearchMaxModules: 3,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  })
  assert.equal(result.assemblyMass.method, 'fabrication-mass-estimate-v1')
  assert.ok(result.assemblyMass.rib.massKg > 0)
  assert.ok(result.assemblyMass.intermoduleJoint.totalMassKg > 0)
  assert.ok(result.assemblyMass.module.totalMassKg > result.assemblyMass.module.ribsMassKg)
  assert.equal(result.craneBoomCapacity.method, 'horizontal-boom-self-weight-plus-end-payload-v1')
  assert.ok(result.craneBoomCapacity.boomSelfWeightN > 0)
  assert.ok(result.craneBoomCapacity.maximumEndPayloadMassKg > 0)
})

test('бумажный проект содержит формулы массы сборки, усиленного узла, горизонтальной стрелы и аудит single-source справочников', () => {
  const result = calculateCompleteMastWithConfiguredJoint({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    heightSearchMaxModules: 3,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
    jointTighteningTorqueNm: 200,
    jointNutFactor: 0.2,
    jointPreloadVariation: 0.25,
    jointNutSectionAreaRatio: 2,
    weldToRibAreaRatio: 2.5,
  })
  const html = createCalculationProjectHtml(result, result.parameters)
  assert.match(html, /Масса физической сборки и аудит справочных данных/)
  assert.match(html, /mrib = ρ·πd²\/4·a/)
  assert.match(html, /Aweld ≈ k²\/2/)
  assert.match(html, /Полный межмодульный узел/)
  assert.match(html, /Сваренный и закреплённый модуль/)
  assert.match(html, /mast-calculator\/reference-data\/v2/)
  assert.match(html, /Арматура/)
  assert.match(html, /Классы болтов/)
  assert.match(html, /Электроды и проволока/)
  assert.match(html, /Усиленная проверка соединительного узла/)
  assert.match(html, /Anut = Ahex − πD1²\/4/)
  assert.match(html, /F0,nom = T\/\(K·d\)/)
  assert.match(html, /Nt,strength = F0,max \+ Nt,external/)
  assert.match(html, /F⊥ = F − e\(e·F\)/)
  assert.match(html, /Aeff,weld = βf·kf·lweff ≥ kweld·Arib/)
  assert.match(html, /NASA-STD-5020A/)
  assert.match(html, /Горизонтальная стрела: собственный вес и концевой груз/)
  assert.match(html, /qg = ρ·A·g·γg/)
  assert.match(html, /максимальный концевой груз/)
  assert.match(html, /не добавляется автоматически|обратную связь|пока/i)
  assert.doesNotMatch(html, /Полный JSON/i)
})
