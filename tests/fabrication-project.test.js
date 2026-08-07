import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { createCalculationProjectHtml } from '../site/engine/calculation-project.js'
import { calculateCompleteMastWithConfiguredJoint } from '../site/engine/complete-calculation.js'

test('полный пользовательский расчёт содержит сборочную массу до экспорта документа', () => {
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
})

test('бумажный проект содержит формулы массы сборки и аудит single-source справочников', () => {
  const result = calculateCompleteMastWithConfiguredJoint({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    heightSearchMaxModules: 3,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  })
  const html = createCalculationProjectHtml(result, result.parameters)
  assert.match(html, /Масса физической сборки и аудит справочных данных/)
  assert.match(html, /mrib = ρ·πd²\/4·a/)
  assert.match(html, /Aweld ≈ k²\/2/)
  assert.match(html, /Полный межмодульный узел/)
  assert.match(html, /Сваренный и закреплённый модуль/)
  assert.match(html, /mast-calculator\/reference-data\/v1/)
  assert.match(html, /Арматура/)
  assert.match(html, /Классы болтов/)
  assert.match(html, /Электроды и проволока/)
  assert.match(html, /не добавляется автоматически|обратную связь|пока/i)
  assert.doesNotMatch(html, /Полный JSON/i)
})
