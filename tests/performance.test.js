import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'
import {
  calculateCompleteMast,
  DEFAULT_PARAMETERS,
  HEIGHT_SEARCH_PROGRESS_STEPS,
  windDirections,
} from '../site/engine/calculate.js'
import { STATIC_PAYLOAD_PROGRESS_STEPS } from '../site/engine/static-payload-capacity.js'

let benchmark40Cache = null

function benchmark40Modules() {
  if (benchmark40Cache) return benchmark40Cache
  const events = []
  const started = performance.now()
  const result = calculateCompleteMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 40,
  }, {
    onProgress: (event) => events.push({ ...event }),
  })
  benchmark40Cache = {
    result,
    events,
    elapsedMs: performance.now() - started,
  }
  return benchmark40Cache
}

test('120° симметрия удаляет только эквивалентные направления полной ветровой сетки', () => {
  const directions30 = windDirections({
    ...DEFAULT_PARAMETERS,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 30,
  })
  assert.deepEqual(directions30, [0, 30, 60, 90])

  const directions45 = windDirections({
    ...DEFAULT_PARAMETERS,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 45,
  })
  assert.deepEqual(directions45, [0, 15, 30, 45, 60, 75, 90, 105])
})

test('40 модулей сохраняют корректность global+modular paths, height search, соединений и verification', { timeout: 30_000 }, () => {
  const { result, events } = benchmark40Modules()

  assert.equal(result.performance.linearSystemSolver, 'symmetric-band-cholesky')
  assert.equal(result.performance.stiffnessFactorizationCount, 1)
  assert.equal(result.performance.freeDofCount, 720)
  assert.ok(result.performance.stiffnessBandwidth <= 35)
  assert.equal(result.performance.modularStaticSolver, 'module-schur-top-down-v1')
  assert.equal(result.performance.modularInterfaceFactorizationCount, 40)
  assert.ok(result.performance.modularRelativeDisplacementDifference < 1e-8)
  assert.ok(result.performance.modularInterfaceEquilibriumResidual < 1e-8)
  assert.equal(result.performance.operationalCaseCount, 4)
  assert.equal(result.performance.lateralCaseCount, 8)
  assert.equal(result.performance.staticPayloadEvaluationCount, STATIC_PAYLOAD_PROGRESS_STEPS)
  assert.ok(result.performance.heightSearchEvaluationCount > 0)
  assert.ok(result.performance.heightSearchEvaluationCount <= HEIGHT_SEARCH_PROGRESS_STEPS)
  assert.equal(result.performance.verificationInternalCheckCount, result.verification.counts.internal)

  assert.equal(result.model.members.length, 40 * 9)
  assert.equal(result.analysis.moduleResults.length, 40)
  assert.equal(result.envelope.caseCount, 4)
  assert.ok(Number.isFinite(result.envelope.maxUtilization))
  assert.ok(Number.isFinite(result.envelope.maxTopDisplacementM))
  assert.ok(Number.isFinite(result.lateralCapacity.criticalForceN))
  assert.ok(Number.isFinite(result.lateralCapacity.boltLimitForceN))
  assert.ok(Number.isFinite(result.staticPayloadCapacity.maximumTotalTopMassKg))
  assert.ok(Number.isFinite(result.staticPayloadCapacity.boltUtilizationAtLimit))
  assert.ok(result.staticPayloadCapacity.maximumTotalTopMassKg > 0)
  assert.ok(result.staticPayloadCapacity.diagnostics.relativeResidual < 1e-8)
  assert.ok(result.staticPayloadCapacity.diagnostics.maximumNodeEquilibriumResidual < 1e-8)
  assert.ok(result.staticPayloadCapacity.diagnostics.bucklingResidual < 1e-5)

  assert.equal(result.heightCapacity.method, 'integer-module-height-search-v1')
  assert.ok(result.heightCapacity.design.maximumModules >= 0)
  assert.ok(result.heightCapacity.ultimateResistance.maximumModules >= result.heightCapacity.design.maximumModules)
  assert.equal(result.heightCapacity.evaluationCount, result.performance.heightSearchEvaluationCount)

  assert.equal(result.connections.jointCount, 3 * (40 - 1))
  assert.equal(result.connections.bolt.selected.applicable, true)
  assert.ok(Number.isFinite(result.connections.bolt.selected.utilization))
  assert.equal(result.connections.weld.envelope.length, result.model.members.length * 2)
  assert.ok(result.connections.weld.critical.check.requiredPhysicalLengthMm >= 40)

  assert.equal(result.verification.status, 'internal-passed-external-pending')
  assert.equal(result.verification.counts.failed, 0)
  assert.ok(result.verification.counts.internal > 0)
  for (const level of result.verification.levels.filter((item) => item.number <= 4)) {
    assert.equal(level.status, 'pass', `внутренний уровень ${level.number}`)
  }

  for (const loadCase of result.cases) {
    assert.ok(loadCase.analysis.diagnostics.relativeResidual < 1e-8)
    assert.ok(loadCase.analysis.diagnostics.maximumNodeEquilibriumResidual < 1e-8)
    assert.ok(loadCase.analysis.buckling.residual < 1e-5)
    assert.ok(loadCase.analysis.modular.relativeDisplacementDifference < 1e-8)
    assert.ok(loadCase.analysis.modular.interfaceEquilibriumResidual < 1e-8)
  }
  for (const lateralCase of result.lateralCapacity.cases) {
    assert.ok(lateralCase.eigenResidual < 1e-5)
    assert.ok(Number.isFinite(lateralCase.boltUnitUtilization))
  }

  assert.ok(events.length >= 2)
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index].completed >= events[index - 1].completed)
    assert.equal(events[index].total, events[0].total)
  }
  assert.ok(events.some((event) => event.phase === 'static-payload'))
  assert.ok(events.some((event) => event.phase === 'height-capacity'))
  const final = events.at(-1)
  assert.equal(final.phase, 'done')
  assert.equal(final.completed, final.total)
})

test('40-модульный benchmark остаётся в отдельном wall-clock бюджете', { timeout: 30_000 }, () => {
  const { result, elapsedMs } = benchmark40Modules()
  console.info(`40-module benchmark: ${elapsedMs.toFixed(1)} ms; DOF=${result.performance.freeDofCount}; bandwidth=${result.performance.stiffnessBandwidth}; moduleFactors=${result.performance.modularInterfaceFactorizationCount}; cases=${result.performance.operationalCaseCount}+${result.performance.lateralCaseCount}+${result.performance.staticPayloadEvaluationCount}; height=${result.performance.heightSearchEvaluationCount}; joints=${result.connections.jointCount}; weldEnds=${result.connections.weld.envelope.length}; verification=${result.verification.counts.internal}`)
  assert.ok(elapsedMs < 20_000, `40-модульный расчёт занял ${elapsedMs.toFixed(0)} мс`)
})
