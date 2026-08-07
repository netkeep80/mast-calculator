import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { createCalculationProjectHtml } from '../site/engine/calculation-project.js'
import { calculateCompleteMastWithConfiguredJoint } from '../site/engine/complete-calculation.js'
import {
  buildEskdConstructionDocumentationModel,
  createEskdConstructionDocumentation,
  createEskdConstructionDocumentationHtml,
  ESKD_EXPORT_SCHEMA,
  ESKD_STANDARDS,
} from '../site/engine/eskd-construction-documentation.js'
import { TECHNICAL_PROJECTION_SCHEMA } from '../site/engine/technical-projection.js'

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

test('ЕСКД v2 строится из той же detailed mesh геометрии, что 3D/OBJ', () => {
  const result = calculation()
  const model = buildEskdConstructionDocumentationModel(result)
  assert.equal(model.schema, ESKD_EXPORT_SCHEMA)
  assert.equal(model.technicalProjectionSchema, TECHNICAL_PROJECTION_SCHEMA)
  assert.equal(model.moduleCount, result.model.moduleCount)
  assert.equal(model.ribLengthMm, result.parameters.ribCutLengthMm)
  assert.equal(model.moduleHeightMm, result.parameters.moduleHeightMm)
  assert.equal(model.detailedModel.statistics.structuralMembers, result.model.members.length)
  assert.ok(model.detailedModel.statistics.faces > result.model.members.length)
  assert.equal(model.bolt.diameterMm, result.connections.configurator.geometry.bolt.diameterMm)
  assert.equal(model.clearanceNut.threadDiameterMm, result.connections.configurator.geometry.bottomClearanceNut.threadDiameterMm)
  assert.equal(model.couplingNut.threadDiameterMm, result.connections.configurator.geometry.topCouplingNut.threadDiameterMm)
})

test('экспорт использует актуальную российскую ЕСКД-базу', () => {
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

test('отдельный комплект КД содержит ровно шесть листов А4', () => {
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

test('чертежи мачты и модуля содержат автоматически построенные проекции общей 3D-модели', () => {
  const html = createEskdConstructionDocumentation(calculation())
  assert.match(html, /data-tech-view="front"/)
  assert.match(html, /data-tech-view="top"/)
  assert.match(html, /data-tech-view="iso"/)
  assert.match(html, /class="tech-visible"/)
  assert.match(html, /H = /)
  assert.match(html, /h = /)
  assert.match(html, /ребро a = /)
})

test('спецификация модуля согласована с production-моделью физической сборки', () => {
  const result = calculation()
  const html = createEskdConstructionDocumentation(result)
  assert.match(html, />9<\/td>/)
  assert.match(html, new RegExp(`Болт M${result.assemblyMass.hardware.bolt.diameterMm}×`))
  assert.match(html, new RegExp(`Гайка проходная M${result.assemblyMass.hardware.clearanceNut.threadDiameterMm}`))
  assert.match(html, new RegExp(`Гайка соединительная M${result.assemblyMass.hardware.couplingNut.threadDiameterMm}×`))
  assert.match(html, new RegExp(`зацепление ${result.connections.configurator.geometry.threadEngagementMm.toFixed(0)}`))
})

test('генератор не подделывает реквизиты разработчика', () => {
  const html = createEskdConstructionDocumentation(calculation())
  assert.match(html, /Обозначение/)
  assert.match(html, /НЕ ПРИСВОЕНО/)
  assert.match(html, /Организация-разработчик: ____________________/)
  assert.match(html, /Разраб\./)
  assert.match(html, /Провер\./)
  assert.match(html, /Н\. контр\./)
  assert.match(html, /Утв\./)
  assert.match(html, /провести нормоконтроль/)
})

test('standalone HTML готов к печати A4 и не требует расчётного проекта', () => {
  const html = createEskdConstructionDocumentationHtml(calculation())
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /@page\{size:A4 portrait/)
  assert.match(html, new RegExp(ESKD_EXPORT_SCHEMA.replaceAll('/', '\\/')))
  assert.equal((html.match(/class="eskd-sheet"/g) ?? []).length, 6)
})

test('бумажный расчётный проект больше не содержит КД', () => {
  const result = calculation()
  const html = createCalculationProjectHtml(result, result.parameters)
  assert.doesNotMatch(html, /class="eskd-sheet"/)
  assert.ok(!html.includes(ESKD_EXPORT_SCHEMA))
  assert.doesNotMatch(html, /Комплект конструкторской документации ЕСКД/)
})
