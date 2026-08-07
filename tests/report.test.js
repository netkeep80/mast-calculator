import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, calculateCompleteMast } from '../site/engine/calculate.js'
import { createCalculationProjectHtml } from '../site/engine/calculation-project.js'
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
  heightSearchMaxModules: 10,
  windEnvelopeEnabled: true,
  windEnvelopeStepDeg: 90,
  lateralCapacityStepDeg: 60,
}

const result = calculateCompleteMast(parameters)

test('ведомость содержит физический модуль каждого ребра и frame-результаты определяющего случая', () => {
  const members = buildMemberEnvelope(result)
  assert.equal(members.length, result.model.members.length)
  const directions = new Set(result.cases.map((loadCase) => loadCase.windDirectionDeg))
  for (const member of members) {
    assert.ok(directions.has(member.windDirectionDeg))
    assert.ok(member.moduleNumber >= 1 && member.moduleNumber <= result.model.moduleCount)
    assert.ok(['top-ring', 'leg'].includes(member.role))
    assert.ok(member.lengthM > 0)
    assert.ok(member.diameterMm > 0)
    assert.ok(member.designCapacityN > 0)
    assert.ok(member.utilization >= 0)
    assert.equal(member.localEndForces.length, 12)
  }
})

test('материальная ведомость сохраняет 9N рёбер, длину и массу', () => {
  const material = buildMaterialSummary(result)
  assert.equal(material.totalCount, result.model.moduleCount * 9)
  assert.equal(material.totalCount, result.model.members.length)
  assert.equal(material.groups.reduce((sum, group) => sum + group.count, 0), material.totalCount)
  assert.ok(material.totalLengthM > 0)
  assert.ok(Math.abs(material.totalMassKg - result.analysis.totalMassKg) < 1e-9)
})

test('CSV начинается с модуля и содержит усилия и сварку обоих концов', () => {
  const csv = createCalculationCsv(result)
  assert.ok(csv.startsWith('\uFEFFМодуль;Ребро;Тип;'))
  assert.ok(csv.includes('Vmax, кН'))
  assert.ok(csv.includes('Mmax, Н·м'))
  assert.ok(csv.includes('σэкв, МПа'))
  assert.ok(csv.includes('Использование по Эйлеру'))
  assert.ok(csv.includes('Сварка A: физ. длина, мм'))
  assert.ok(csv.includes('Сварка B: физ. длина, мм'))
  assert.ok(csv.includes('Сварочный материал'))
  assert.equal(csv.trim().split('\r\n').length, result.model.members.length + 1)
})

test('snapshot v8 содержит physical modules, modular solver, height capacity и соединения', () => {
  const generatedAt = '2026-08-07T08:00:00.000Z'
  const buildInfo = { repository: 'netkeep80/mast-calculator', ref: 'main', sha: 'abc123', runId: '42' }
  const snapshot = createCalculationExport(result, result.parameters, generatedAt, buildInfo)

  assert.equal(snapshot.schema, 'mast-calculator/calculation-snapshot/v8')
  assert.equal(snapshot.software.sha, 'abc123')
  assert.equal(snapshot.summary.loadCaseCount, 4)
  assert.equal(snapshot.summary.windPresetId, 'custom')
  assert.equal(snapshot.summary.modularStaticSolver, 'module-schur-top-down-v1')
  assert.ok(snapshot.summary.modularRelativeDisplacementDifference < 1e-8)
  assert.ok(snapshot.summary.modularInterfaceEquilibriumResidual < 1e-8)
  assert.ok(snapshot.summary.designMaximumModules >= 0)
  assert.ok(snapshot.summary.ultimateMaximumModules >= snapshot.summary.designMaximumModules)
  assert.ok(snapshot.heightCapacity.evaluationCount > 0)
  assert.equal(snapshot.model.modules.length, result.model.moduleCount)
  assert.ok(snapshot.model.modules.every((module) => module.memberIds.length === 9))
  assert.ok(snapshot.model.members.every((member) => Number.isInteger(member.moduleIndex)))
  assert.ok(snapshot.loadCases.every((loadCase) => loadCase.analysis.modular?.method === 'module-schur-top-down-v1'))
  assert.equal(snapshot.loadCases[0].analysis.modular.modules.length, result.model.moduleCount)

  assert.ok(snapshot.summary.lateralCriticalForceKgf > 0)
  assert.ok(snapshot.summary.maximumTotalTopMassKg > 0)
  assert.equal(snapshot.summary.configuredBoltDiameterMm, 24)
  assert.equal(snapshot.summary.configuredBoltClass, '8.8')
  assert.equal(snapshot.connections.method, 'intermodule-bolt-and-member-end-weld-v1')
  assert.equal(snapshot.connections.jointCount, 3)
  assert.equal(snapshot.connections.weld.envelope.length, result.model.members.length * 2)
  assert.equal(snapshot.summary.verificationStatus, 'internal-passed-external-pending')
  assert.equal(snapshot.summary.verificationFailed, 0)
  assert.equal(snapshot.summary.verificationNotVerified, 3)
  assert.equal(snapshot.verification.levels.length, 6)
  assert.ok(snapshot.verification.checks.some((check) => check.id === 'reference-cantilever-deflection'))
  assert.ok(snapshot.verification.checks.some((check) => check.id === 'external-fem' && check.status === 'not-verified'))
})

test('машинный JSON v8 остаётся внутренним средством воспроизводимости', () => {
  const report = JSON.parse(createCalculationJson(
    result,
    result.parameters,
    '2026-08-07T08:00:00.000Z',
    { sha: 'abc123' },
  ))
  assert.equal(report.schema, 'mast-calculator/calculation-snapshot/v8')
  assert.equal(report.software.sha, 'abc123')
  assert.equal(report.model.modules.length, 2)
  assert.equal(report.loadCases[0].analysis.modular.method, 'module-schur-top-down-v1')
  assert.ok(report.heightCapacity.evaluationCount > 0)
  assert.ok(report.lateralCapacity.criticalForceKgf > 0)
  assert.ok(report.staticPayloadCapacity.maximumTotalTopMassKg > 0)
  assert.equal(report.connections.bolt.selected.applicable, true)
  assert.equal(report.verification.counts.failed, 0)
})

test('бумажный проект сохраняет формулы frame, болта, сварки и паспорт верификации', () => {
  const html = createCalculationProjectHtml(
    result,
    result.parameters,
    '2026-08-07T08:00:00.000Z',
    { repository: 'netkeep80/mast-calculator', ref: 'main', sha: 'abc123', runId: '42' },
  )

  assert.match(html, /Расчётный проект арматурного каркаса/)
  assert.match(html, /a = L₀ \/ n/)
  assert.match(html, /h = √\(a² − R²\) = a·√\(2\/3\)/)
  assert.match(html, /K·u = F/)
  assert.match(html, /\(K \+ λ·KG\)·φ = 0/)
  assert.match(html, /Fbolt = 1\/Ubolt\(1 Н\)/)
  assert.match(html, /Nt = max\(0, −Faxis\) \+ \|Mb\|\/reff/)
  assert.match(html, /Ubolt = √\[\(Ns\/Nbs\)² \+ \(Nt\/Nbt\)²\]/)
  assert.match(html, /lw = max\(lw,f, lw,z, 4kf, 40 мм\)/)
  assert.match(html, /Паспорт верификации: как неспециалисту проверять расчёт/)
  assert.match(html, /Независимый КЭ-комплекс/)
  assert.match(html, /НЕ ПРОВЕРЕНО/)
  assert.match(html, /abc123/)
})

test('бумажный расчётный проект не содержит JSON или машинного snapshot', () => {
  const html = createCalculationProjectHtml(result, result.parameters)
  assert.doesNotMatch(html, /Полный JSON/i)
  assert.doesNotMatch(html, /Машинное приложение/i)
  assert.doesNotMatch(html, /calculation-snapshot\/v8/)
  assert.doesNotMatch(html, /<pre>/i)
})

test('бумажный проект подставляет фактическую высоту правильного октаэдра', () => {
  const html = createCalculationProjectHtml(result, result.parameters)
  const expectedHeight = result.parameters.ribCutLengthMm * Math.sqrt(2 / 3)
  assert.ok(Math.abs(result.parameters.moduleHeightMm - expectedHeight) < 1e-12)
  assert.match(html, /h = √\(a² − R²\)/)
})
