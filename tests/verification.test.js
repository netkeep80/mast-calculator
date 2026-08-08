import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCompleteMast } from '../packages/application/index.js'
import { buildVerificationPassport } from '../packages/engineering/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const result = calculateCompleteMast(resolvedProject({
  moduleCount: 1,
  windEnvelopeEnabled: false,
  lateralCapacityStepDeg: 60,
}))

const checkById = (passport, id) => passport.checks.find((check) => check.id === id)

test('паспорт верификации разделяет внутренние доказательства и внешние неподтверждённые уровни', () => {
  const passport = result.verification
  assert.equal(passport.method, 'layered-layperson-verification-v1')
  assert.equal(passport.status, 'internal-passed-external-pending')
  assert.equal(passport.counts.failed, 0)
  assert.ok(passport.counts.passed >= 10)
  assert.equal(passport.counts.notVerified, 3)

  for (const level of passport.levels.filter((item) => item.number <= 4)) {
    assert.equal(level.status, 'pass', `уровень ${level.number} должен быть пройден`)
  }
  assert.equal(passport.levels.find((item) => item.number === 5).status, 'not-verified')
  assert.equal(passport.levels.find((item) => item.number === 6).status, 'not-verified')
})

test('ручные шаги содержат формулу, численную подстановку и инструкцию', () => {
  for (const id of ['cut-length', 'octahedron-height', 'mast-height', 'steel-mass', 'self-weight', 'wind-pressure']) {
    const check = checkById(result.verification, id)
    assert.ok(check)
    assert.equal(check.status, 'pass')
    assert.ok(check.formula.length > 0)
    assert.ok(check.substitution.length > 0)
    assert.ok(check.howToCheck.length > 20)
    assert.ok(Number.isFinite(check.actual))
    assert.ok(Number.isFinite(check.expected))
  }
})

test('физическое равновесие и численные residual проходят заданные пороги', () => {
  for (const id of [
    'global-force-equilibrium',
    'global-moment-equilibrium',
    'linear-system-residual',
    'free-dof-equilibrium',
    'buckling-residual',
  ]) {
    assert.equal(checkById(result.verification, id).status, 'pass', id)
  }
})

test('runtime self-test решает классические задачи с известным ответом', () => {
  for (const id of [
    'reference-axial-bar',
    'reference-cantilever-deflection',
    'reference-cantilever-rotation',
  ]) {
    const check = checkById(result.verification, id)
    assert.equal(check.status, 'pass', id)
    assert.ok(check.relativeError <= check.tolerance)
  }
})

test('оптимизированные численные методы перекрёстно проверяются reference-алгоритмами', () => {
  assert.equal(checkById(result.verification, 'dense-vs-banded').status, 'pass')
  assert.equal(checkById(result.verification, 'known-buckling-eigenvalue').status, 'pass')
})

test('паспорт не скрывает намеренную порчу контролируемой величины', () => {
  const tampered = {
    ...result,
    analysis: {
      ...result.analysis,
      totalMassKg: result.analysis.totalMassKg * 1.05,
    },
  }
  const passport = buildVerificationPassport(tampered)
  assert.equal(checkById(passport, 'steel-mass').status, 'fail')
  assert.equal(passport.status, 'failed')
  assert.ok(passport.counts.failed >= 1)
})
