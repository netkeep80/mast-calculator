import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'
import {
  calculateCompleteMast,
  DEFAULT_PARAMETERS,
  windDirections,
} from '../site/engine/calculate.js'

test('120° симметрия удаляет только эквивалентные направления полной ветровой сетки', () => {
  const directions30 = windDirections({
    ...DEFAULT_PARAMETERS,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 30,
  })
  assert.deepEqual(directions30, [0, 30, 60, 90])

  // Для шага, который не делит 120°, нельзя просто перебирать 0..120 с тем же шагом:
  // сначала строится исходная круговая сетка и только потом сворачивается modulo 120°.
  const directions45 = windDirections({
    ...DEFAULT_PARAMETERS,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 45,
  })
  assert.deepEqual(directions45, [0, 15, 30, 45, 60, 75, 90, 105])
})

test('40 модулей считаются одной факторизацией с монотонным прогрессом', { timeout: 30_000 }, () => {
  const events = []
  const started = performance.now()
  const result = calculateCompleteMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 40,
  }, {
    onProgress: (event) => events.push({ ...event }),
  })
  const elapsedMs = performance.now() - started

  assert.equal(result.performance.linearSystemSolver, 'symmetric-band-cholesky')
  assert.equal(result.performance.stiffnessFactorizationCount, 1)
  assert.equal(result.performance.freeDofCount, 720)
  assert.ok(result.performance.stiffnessBandwidth <= 35)
  assert.equal(result.performance.operationalCaseCount, 4)
  assert.equal(result.performance.lateralCaseCount, 8)
  assert.equal(result.envelope.caseCount, 4)
  assert.ok(Number.isFinite(result.envelope.maxUtilization))
  assert.ok(Number.isFinite(result.envelope.maxTopDisplacementM))
  assert.ok(Number.isFinite(result.lateralCapacity.criticalForceN))

  assert.ok(events.length >= 2)
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index].completed >= events[index - 1].completed)
    assert.equal(events[index].total, events[0].total)
  }
  const final = events.at(-1)
  assert.equal(final.phase, 'done')
  assert.equal(final.completed, final.total)

  // Порог намеренно щедрый для shared CI runners. Он защищает именно от возврата
  // к минутному dense O(n³)-поведению, а фактическое время печатается в лог CI.
  console.info(`40-module benchmark: ${elapsedMs.toFixed(1)} ms; DOF=${result.performance.freeDofCount}; bandwidth=${result.performance.stiffnessBandwidth}; cases=${result.performance.operationalCaseCount}+${result.performance.lateralCaseCount}`)
  assert.ok(elapsedMs < 20_000, `40-модульный расчёт занял ${elapsedMs.toFixed(0)} мс`)
})
