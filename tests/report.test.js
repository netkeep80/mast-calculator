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
  windEnvelopeEnabled: true,
  windEnvelopeStepDeg: 90,
  lateralCapacityStepDeg: 60,
}

const result = calculateCompleteMast(parameters)

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

test('CSV содержит усилия и требуемую физическую длину сварки обоих концов', () => {
  const csv = createCalculationCsv(result)
  assert.ok(csv.startsWith('\uFEFFРебро;Тип;'))
  assert.ok(csv.includes('Vmax, кН'))
  assert.ok(csv.includes('Mmax, Н·м'))
  assert.ok(csv.includes('σэкв, МПа'))
  assert.ok(csv.includes('Использование по Эйлеру'))
  assert.ok(csv.includes('Сварка A: физ. длина, мм'))
  assert.ok(csv.includes('Сварка B: физ. длина, мм'))
  assert.ok(csv.includes('Сварочный материал'))
  assert.equal(csv.trim().split('\r\n').length, result.model.members.length + 1)
})

test('внутренний snapshot v7 содержит frame, соединения и паспорт верификации', () => {
  const generatedAt = '2026-08-07T08:00:00.000Z'
  const buildInfo = { repository: 'netkeep80/mast-calculator', ref: 'main', sha: 'abc123', runId: '42' }
  const snapshot = createCalculationExport(result, result.parameters, generatedAt, buildInfo)

  assert.equal(snapshot.schema, 'mast-calculator/calculation-snapshot/v7')
  assert.equal(snapshot.software.sha, 'abc123')
  assert.equal(snapshot.summary.loadCaseCount, 4)
  assert.equal(snapshot.summary.windPresetId, 'custom')
  assert.ok(snapshot.summary.windSpeedMs > 0)
  assert.ok(snapshot.summary.lateralCriticalForceKgf > 0)
  assert.ok(snapshot.summary.lateralBoltLimitForceKgf > 0)
  assert.ok(snapshot.summary.maximumTotalTopMassKg > 0)
  assert.ok(snapshot.summary.equivalentWaterVolumeM3 >= 0)
  assert.equal(snapshot.summary.configuredBoltDiameterMm, 24)
  assert.equal(snapshot.summary.configuredBoltClass, '8.8')
  assert.ok(snapshot.summary.configuredBoltUtilization >= 0)
  assert.equal(snapshot.summary.configuredBoltGoverningLevel, 1)
  assert.ok(snapshot.summary.minimumBoltDiameterForConfiguredClassMm >= 16)
  assert.ok(snapshot.summary.criticalWeldPhysicalLengthMm >= 40)
  assert.equal(snapshot.summary.verificationStatus, 'internal-passed-external-pending')
  assert.equal(snapshot.summary.verificationFailed, 0)
  assert.ok(snapshot.summary.verificationPassed > 0)
  assert.equal(snapshot.summary.verificationNotVerified, 3)
  assert.ok(snapshot.lateralCapacity.criticalForceN > 0)
  assert.ok(snapshot.staticPayloadCapacity.maximumTotalTopMassKg > 0)
  assert.ok(snapshot.staticPayloadCapacity.boltUtilizationAtLimit >= 0)
  assert.equal(snapshot.connections.method, 'intermodule-bolt-and-member-end-weld-v1')
  assert.equal(snapshot.connections.jointCount, 3)
  assert.equal(snapshot.connections.bolt.selected.applicable, true)
  assert.equal(snapshot.connections.weld.envelope.length, result.model.members.length * 2)
  assert.equal(snapshot.verification.method, 'layered-layperson-verification-v1')
  assert.equal(snapshot.verification.levels.length, 6)
  assert.ok(snapshot.verification.checks.some((check) => check.id === 'reference-cantilever-deflection'))
  assert.ok(snapshot.verification.checks.some((check) => check.id === 'external-fem' && check.status === 'not-verified'))
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
  assert.equal(report.schema, 'mast-calculator/calculation-snapshot/v7')
  assert.equal(report.software.sha, 'abc123')
  assert.ok(report.lateralCapacity.criticalForceKgf > 0)
  assert.ok(report.staticPayloadCapacity.maximumTotalTopMassKg > 0)
  assert.equal(report.connections.bolt.selected.applicable, true)
  assert.equal(report.verification.counts.failed, 0)
})

test('бумажный проект содержит формулы нагрузок, болта, сварки и паспорт верификации', () => {
  const html = createCalculationProjectHtml(
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
  assert.match(html, /q = ρv²\/2/)
  assert.match(html, /Fmember = 1\/Umember\(1 Н\)/)
  assert.match(html, /Fbolt = 1\/Ubolt\(1 Н\)/)
  assert.match(html, /Flim = min\(Fmember, Fglobal, Fbolt\)/)
  assert.match(html, /Pdesign\(m\) = m·g·γpayload/)
  assert.match(html, /Vwater = mreserve \/ ρwater/)
  assert.match(html, /Nt = max\(0, −Faxis\) \+ \|Mb\|\/reff/)
  assert.match(html, /Nbs = Rbs·Ab·ns·γb·γc/)
  assert.match(html, /Nbt = Rbt·Abn·γc/)
  assert.match(html, /Ubolt = √\[\(Ns\/Nbs\)² \+ \(Nt\/Nbt\)²\]/)
  assert.match(html, /Nu,characteristic = Rbun·Abn/)
  assert.match(html, /lw,f = Qw\/\(βf·kf·Rwf·γc\)/)
  assert.match(html, /lw = max\(lw,f, lw,z, 4kf, 40 мм\)/)
  assert.match(html, /Паспорт верификации: как неспециалисту проверять расчёт/)
  assert.match(html, /δ = F·L\/\(E·A\)/)
  assert.match(html, /Независимый КЭ-комплекс/)
  assert.match(html, /НЕ ПРОВЕРЕНО/)
  assert.match(html, /abc123/)
})

test('бумажный расчётный проект не содержит JSON или машинного приложения', () => {
  const html = createCalculationProjectHtml(result, result.parameters)
  assert.doesNotMatch(html, /Полный JSON/i)
  assert.doesNotMatch(html, /Машинное приложение/i)
  assert.doesNotMatch(html, /calculation-snapshot\/v7/)
  assert.doesNotMatch(html, /<pre>/i)
})

test('бумажный проект подставляет фактическую высоту правильного октаэдра', () => {
  const html = createCalculationProjectHtml(result, result.parameters)
  const expectedHeight = result.parameters.ribCutLengthMm * Math.sqrt(2 / 3)
  assert.ok(Math.abs(result.parameters.moduleHeightMm - expectedHeight) < 1e-12)
  assert.match(html, /h = √\(a² − R²\)/)
})
