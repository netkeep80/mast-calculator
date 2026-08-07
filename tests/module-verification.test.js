import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCompleteMast, DEFAULT_PARAMETERS } from '../packages/application/index.js'
import { augmentVerificationWithModuleChecks } from '../packages/structural-analysis/index.js'

test('модульный паспорт добавляет topology, interface equilibrium и Schur/global cross-check', () => {
  const result = calculateCompleteMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 3,
    heightSearchMaxModules: 8,
    windEnvelopeEnabled: false,
  })
  const verification = augmentVerificationWithModuleChecks(result.verification, result)
  assert.equal(verification.method, 'layered-layperson-verification-v2')
  for (const id of ['module-legs-down-topology', 'module-interface-equilibrium', 'module-schur-vs-global']) {
    const check = verification.checks.find((item) => item.id === id)
    assert.ok(check, `нет проверки ${id}`)
    assert.equal(check.status, 'pass')
  }
  assert.equal(verification.status, 'internal-passed-external-pending')
  assert.equal(verification.counts.failed, 0)
  assert.equal(verification.counts.notVerified, 3)
  assert.equal(verification.counts.internal, result.verification.counts.internal + 3)
})

test('искусственное нарушение modular/global agreement не остаётся зелёным', () => {
  const result = calculateCompleteMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    heightSearchMaxModules: 6,
    windEnvelopeEnabled: false,
  })
  result.cases[0].analysis.modular.relativeDisplacementDifference = 1e-3
  const verification = augmentVerificationWithModuleChecks(result.verification, result)
  const check = verification.checks.find((item) => item.id === 'module-schur-vs-global')
  assert.equal(check.status, 'fail')
  assert.equal(verification.status, 'failed')
})
