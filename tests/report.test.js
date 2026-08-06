import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, calculateMast } from '../site/engine/calculate.js'
import {
  buildMaterialSummary,
  buildMemberEnvelope,
  createCalculationCsv,
  createCalculationJson,
} from '../site/engine/report.js'

const parameters = {
  ...DEFAULT_PARAMETERS,
  moduleCount: 2,
  windEnvelopeEnabled: true,
  windEnvelopeStepDeg: 90,
}

const result = calculateMast(parameters)

test('ведомость содержит каждый стержень и определяющий ветровой случай', () => {
  const members = buildMemberEnvelope(result)
  assert.equal(members.length, result.model.members.length)
  const directions = new Set(result.cases.map((loadCase) => loadCase.windDirectionDeg))
  for (const member of members) {
    assert.ok(directions.has(member.windDirectionDeg))
    assert.ok(member.lengthM > 0)
    assert.ok(member.diameterMm > 0)
    assert.ok(member.designCapacityN > 0)
    assert.ok(member.utilization >= 0)
    assert.ok(['horizontal', 'diagonal'].includes(member.family))
  }
})

test('материальная ведомость сохраняет количество, длину и массу', () => {
  const material = buildMaterialSummary(result)
  assert.equal(material.totalCount, result.model.members.length)
  assert.equal(material.groups.reduce((sum, group) => sum + group.count, 0), material.totalCount)
  assert.ok(material.totalLengthM > 0)
  assert.ok(Math.abs(material.totalMassKg - result.analysis.totalMassKg) < 1e-9)
})

test('CSV формируется в совместимом с русским Excel формате', () => {
  const csv = createCalculationCsv(result)
  assert.ok(csv.startsWith('\uFEFFСтержень;Тип;'))
  assert.ok(csv.includes('Коэффициент использования'))
  assert.equal(csv.trim().split('\r\n').length, result.model.members.length + 1)
})

test('JSON содержит параметры, сводку и воспроизводимую дату', () => {
  const generatedAt = '2026-08-06T19:30:00.000Z'
  const report = JSON.parse(createCalculationJson(result, parameters, generatedAt))
  assert.equal(report.schema, 'mast-calculator/calculation-report/v1')
  assert.equal(report.generatedAt, generatedAt)
  assert.equal(report.parameters.moduleCount, 2)
  assert.equal(report.summary.loadCaseCount, 4)
  assert.equal(report.members.length, result.model.members.length)
  assert.equal(report.material.totalCount, result.model.members.length)
})
