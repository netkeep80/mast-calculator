import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, calculateMast } from '../site/engine/calculate.js'
import { createCalculationNoteHtml } from '../site/engine/calculation-note.js'
import {
  buildMaterialSummary,
  buildMemberEnvelope,
  createCalculationCsv,
  createCalculationExport,
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

test('JSON v2 содержит полную модель, нагрузки, результаты и идентификатор сборки', () => {
  const generatedAt = '2026-08-06T19:30:00.000Z'
  const buildInfo = { repository: 'netkeep80/mast-calculator', ref: 'main', sha: 'abc123', runId: '42' }
  const report = JSON.parse(createCalculationJson(result, result.parameters, generatedAt, buildInfo))
  assert.equal(report.schema, 'mast-calculator/calculation-report/v2')
  assert.equal(report.generatedAt, generatedAt)
  assert.equal(report.software.sha, 'abc123')
  assert.equal(report.parameters.moduleCount, 2)
  assert.equal(report.summary.loadCaseCount, 4)
  assert.equal(report.members.length, result.model.members.length)
  assert.equal(report.material.totalCount, result.model.members.length)
  assert.equal(report.model.nodes.length, result.model.nodes.length)
  assert.equal(report.model.members.length, result.model.members.length)
  assert.equal(report.loadCases.length, result.cases.length)
  assert.equal(report.loadCases[0].loads.nodalLoadsN.length, result.model.nodes.length)
  assert.equal(report.loadCases[0].analysis.memberResults.length, result.model.members.length)
})

test('createCalculationExport и HTML-записка используют один и тот же канонический снимок', () => {
  const generatedAt = '2026-08-07T08:00:00.000Z'
  const buildInfo = { repository: 'netkeep80/mast-calculator', ref: 'main', sha: 'abc123', runId: '42' }
  const snapshot = createCalculationExport(result, result.parameters, generatedAt, buildInfo)
  const html = createCalculationNoteHtml(result, result.parameters, generatedAt, buildInfo)

  assert.equal(snapshot.software.sha, 'abc123')
  assert.match(html, /Расчётная записка/)
  assert.match(html, /mast-calculator\/calculation-report\/v2/)
  assert.match(html, /abc123/)
  assert.match(html, /Полный JSON/)
  assert.match(html, new RegExp(String(snapshot.model.nodes.length)))
})
