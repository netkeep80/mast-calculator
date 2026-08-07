import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { createCalculationProjectHtml } from '../site/engine/calculation-project.js'
import { calculateCompleteMastWithConfiguredJoint } from '../site/engine/complete-calculation.js'
import {
  buildEskdConstructionDocumentationModel,
  createEskdConstructionDocumentation,
  ESKD_EXPORT_SCHEMA,
  ESKD_STANDARDS,
} from '../site/engine/eskd-construction-documentation.js'

function calculation(overrides = {}) {
  return calculateCompleteMastWithConfiguredJoint({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    heightSearchMaxModules: 3,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
    ...overrides,
  })
}

test('ЕСКД-модель строится только из фактически рассчитанной конструкции', () => {
  const result = calculation()
  const model = buildEskdConstructionDocumentationModel(result)
  assert.equal(model.schema, ESKD_EXPORT_SCHEMA)
  assert.equal(model.moduleCount, 2)
  assert.equal(model.ribLengthMm, result.parameters.ribCutLengthMm)
  assert.equal(model.ribDiameterMm, result.parameters.barDiameterMm)
  assert.equal(model.moduleHeightMm, result.parameters.moduleHeightMm)
  assert.equal(model.mastHeightMm, 2 * result.parameters.moduleHeightMm)
  assert.equal(model.bolt.diameterMm, result.connections.configurator.geometry.bolt.diameterMm)
  assert.equal(model.clearanceNut.threadDiameterMm, result.connections.configurator.geometry.bottomClearanceNut.threadDiameterMm)
  assert.equal(model.couplingNut.threadDiameterMm, result.connections.configurator.geometry.topCouplingNut.threadDiameterMm)
  assert.equal(
    model.mass.hardware.couplingNut.threadEngagementMm,
    result.connections.configurator.geometry.threadEngagementMm,
  )
})

test('экспорт использует актуальную российскую ЕСКД-базу и не ссылается на отменённые версии как на основную', () => {
  const ids = ESKD_STANDARDS.map((item) => item.id)
  assert.ok(ids.includes('ГОСТ Р 2.102-2023'))
  assert.ok(ids.includes('ГОСТ Р 2.104-2023'))
  assert.ok(ids.includes('ГОСТ Р 2.109-2023'))
  assert.ok(ids.includes('ГОСТ Р 2.201-2023'))
  assert.ok(ids.includes('ГОСТ Р 2.105-2019'))
  assert.ok(ids.includes('ГОСТ 2.301-68'))
  assert.ok(!ids.includes('ГОСТ 2.102-2013'))
  assert.ok(!ids.includes('ГОСТ 2.104-2006'))
})

test('комплект КД содержит шесть печатных листов А4 и обязательные виды документов', () => {
  const html = createEskdConstructionDocumentation(calculation())
  assert.equal((html.match(/class="eskd-sheet"/g) ?? []).length, 6)
  assert.equal((html.match(/data-format="A4"/g) ?? []).length, 6)
  assert.match(html, /Мачта модульная\. Сборочный чертеж/)
  assert.match(html, /Мачта модульная\. Спецификация/)
  assert.match(html, /Модуль мачты\. Сборочный чертеж/)
  assert.match(html, /Модуль мачты\. Спецификация/)
  assert.match(html, /Узел межмодульный\. Сборочный чертеж/)
  assert.match(html, /Ребро\. Чертеж детали/)
  assert.match(html, /data-title-block-form="1"/)
  assert.match(html, /data-title-block-form="2"/)
})

test('спецификация модуля согласована с production-моделью физической сборки', () => {
  const result = calculation()
  const html = createEskdConstructionDocumentation(result)
  assert.match(html, />9<\/td><td>[^<]*ГОСТ/)
  assert.match(html, new RegExp(`Болт M${result.assemblyMass.hardware.bolt.diameterMm}×`))
  assert.match(html, new RegExp(`Гайка проходная M${result.assemblyMass.hardware.clearanceNut.threadDiameterMm}`))
  assert.match(html, new RegExp(`Гайка соединительная M${result.assemblyMass.hardware.couplingNut.threadDiameterMm}×`))
  assert.match(html, />3<\/td>/)
  assert.match(
    html,
    new RegExp(`зацепление ${result.connections.configurator.geometry.threadEngagementMm.toFixed(0)}`),
  )
  assert.doesNotMatch(html, /зацепление — мм/)
})

test('генератор не подделывает реквизиты, которые должен присвоить разработчик', () => {
  const html = createEskdConstructionDocumentation(calculation())
  assert.match(html, /Обозначение/)
  assert.match(html, /НЕ ПРИСВОЕНО/)
  assert.match(html, /Организация-разработчик: ____________________/)
  assert.match(html, /Разраб\./)
  assert.match(html, /Провер\./)
  assert.match(html, /Н\. контр\./)
  assert.match(html, /Утв\./)
  assert.match(html, /присвоить обозначения КД по ГОСТ Р 2\.201-2023/)
  assert.match(html, /провести нормоконтроль/)
})

test('обычный экспорт бумажного проекта автоматически включает комплект КД', () => {
  const result = calculation()
  const html = createCalculationProjectHtml(result, result.parameters)
  assert.match(html, /15\. Комплект конструкторской документации ЕСКД/)
  assert.ok(html.includes(ESKD_EXPORT_SCHEMA))
  assert.match(html, /ГОСТ Р 2\.102-2023/)
  assert.match(html, /ГОСТ Р 2\.104-2023/)
  assert.match(html, /ГОСТ Р 2\.201-2023/)
})
