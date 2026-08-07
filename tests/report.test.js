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
  moduleCount: 1,
  windEnvelopeEnabled: true,
  windEnvelopeStepDeg: 90,
}

const result = calculateMast(parameters)

test('ведомость содержит каждое ребро и frame-результаты определяющего случая', () => {
  const members = buildMemberEnvelope(result)
  assert.equal(members.length, result.model.members.length)
  const directions = new Set(result.cases.map((loadCase) => loadCase.windDirectionDeg))
  for (const member of members) {
    assert.ok(directions.has(member.windDirectionDeg))
    assert.ok(member.lengthM > 0)
    assert.ok(member.diameterMm > 0)
    assert.ok(member.designCapacityN > 0)
    assert.ok(member.utilization >= 0)
    assert.ok(member.maxShearN >= 0)
    assert.ok(member.maxBendingNm >= 0)
    assert.ok(member.maxTorsionNm >= 0)
    assert.ok(member.equivalentStressPa >= 0)
    assert.ok(Number.isFinite(member.stressUtilization))
    assert.ok(Number.isFinite(member.bucklingUtilization))
    assert.equal(member.localEndForces.length, 12)
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

test('CSV содержит усилия, моменты и эквивалентные напряжения frame-модели', () => {
  const csv = createCalculationCsv(result)
  assert.ok(csv.startsWith('\uFEFFРебро;Тип;'))
  assert.ok(csv.includes('Vmax, кН'))
  assert.ok(csv.includes('Mmax, Н·м'))
  assert.ok(csv.includes('σэкв, МПа'))
  assert.ok(csv.includes('Использование по Эйлеру'))
  assert.equal(csv.trim().split('\r\n').length, result.model.members.length + 1)
})

test('внутренний snapshot v3 содержит полную frame-модель и расчётные случаи', () => {
  const generatedAt = '2026-08-07T08:00:00.000Z'
  const buildInfo = { repository: 'netkeep80/mast-calculator', ref: 'main', sha: 'abc123', runId: '42' }
  const snapshot = createCalculationExport(result, result.parameters, generatedAt, buildInfo)

  assert.equal(snapshot.schema, 'mast-calculator/calculation-snapshot/v3')
  assert.equal(snapshot.software.sha, 'abc123')
  assert.equal(snapshot.summary.loadCaseCount, 4)
  assert.equal(snapshot.model.nodes.length, result.model.nodes.length)
  assert.equal(snapshot.model.nodes[0].restrained.length, 6)
  assert.equal(snapshot.loadCases.length, result.cases.length)
  assert.equal(snapshot.loadCases[0].analysis.solver, 'linear-3d-frame-euler-bernoulli')
  assert.equal(snapshot.loadCases[0].analysis.rotationsRad.length, result.model.nodes.length)
  assert.equal(snapshot.loadCases[0].analysis.reactionMomentsNm.length, result.model.nodes.length)
  assert.equal(snapshot.loadCases[0].analysis.memberResults[0].localEndForces.length, 12)
  assert.equal(snapshot.loadCases[0].loads.memberDistributedLoadsNPerM.length, result.model.members.length)
})

test('машинный JSON остаётся внутренним средством воспроизводимости', () => {
  const report = JSON.parse(createCalculationJson(
    result,
    result.parameters,
    '2026-08-07T08:00:00.000Z',
    { sha: 'abc123' },
  ))
  assert.equal(report.schema, 'mast-calculator/calculation-snapshot/v3')
  assert.equal(report.software.sha, 'abc123')
})

test('бумажный расчётный проект содержит пошаговые формулы и идентификатор кода', () => {
  const html = createCalculationNoteHtml(
    result,
    result.parameters,
    '2026-08-07T08:00:00.000Z',
    { repository: 'netkeep80/mast-calculator', ref: 'main', sha: 'abc123', runId: '42' },
  )

  assert.match(html, /Расчётный проект арматурного каркаса/)
  assert.match(html, /a = L₀ \/ n/)
  assert.match(html, /h = √\(a² − R²\) = a·√\(2\/3\)/)
  assert.match(html, /A = πd²\/4/)
  assert.match(html, /K·u = F/)
  assert.match(html, /σeq = √\(σ² \+ 3τ²\)/)
  assert.match(html, /NE = π²EI\/Leff²\/γM/)
  assert.match(html, /\(K \+ λ·KG\)·φ = 0/)
  assert.match(html, /abc123/)
})

test('бумажный расчётный проект не содержит JSON или машинного приложения', () => {
  const html = createCalculationNoteHtml(result, result.parameters)
  assert.doesNotMatch(html, /Полный JSON/i)
  assert.doesNotMatch(html, /Машинное приложение/i)
  assert.doesNotMatch(html, /calculation-snapshot\/v3/)
  assert.doesNotMatch(html, /<pre>/i)
})

test('бумажный проект подставляет фактическую высоту правильного октаэдра', () => {
  const html = createCalculationNoteHtml(result, result.parameters)
  const expectedHeight = result.parameters.ribCutLengthMm * Math.sqrt(2 / 3)
  assert.ok(Math.abs(result.parameters.moduleHeightMm - expectedHeight) < 1e-12)
  assert.match(html, /h = √\(a² − R²\)/)
})
