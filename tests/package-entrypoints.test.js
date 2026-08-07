import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import * as application from '../packages/application/index.js'
import * as design from '../packages/design/index.js'
import * as domain from '../packages/domain/index.js'
import * as engineering from '../packages/engineering/index.js'
import * as numerics from '../packages/numerics/index.js'
import * as reporting from '../packages/reporting/index.js'
import * as structural from '../packages/structural-analysis/index.js'
import * as structuralTesting from '../packages/structural-analysis/testing.js'

const packageContracts = [
  ['domain', domain, ['DEFAULT_PARAMETERS', 'resolveCalculationParameters', 'getReinforcementClass']],
  ['numerics', numerics, ['solveDenseSystem', 'norm3']],
  ['structural-analysis', structural, ['generateMastModel', 'analyzeFrame', 'compileFrameSystem']],
  ['engineering', engineering, ['analyzeCheckedFrame', 'calculateConnectionChecks', 'calculateGuyedMast', 'calculateLateralCapacity', 'buildVerificationPassport']],
  ['design', design, ['buildDesignPackage', 'buildDetailedMastModel', 'createMastObj']],
  ['reporting', reporting, ['createCalculationProjectHtml', 'buildReferenceData']],
  ['application', application, ['calculateProject', 'optimizeProject', 'calculateGuyedProject', 'createVerification']],
]

test('every production package public entrypoint imports in a plain Node process', () => {
  for (const [name, namespace, expected] of packageContracts) {
    assert.ok(Object.keys(namespace).length > 0, `${name}: public entrypoint is empty`)
    for (const symbol of expected) {
      assert.ok(symbol in namespace, `${name}: missing public export ${symbol}`)
    }
  }
})

test('structural response and engineering acceptance remain separate public contracts', () => {
  const structuralSource = fs.readFileSync(
    new URL('../packages/structural-analysis/src/solver.js', import.meta.url),
    'utf8',
  )
  const memberCheckSource = fs.readFileSync(
    new URL('../packages/engineering/src/member-check.js', import.meta.url),
    'utf8',
  )

  assert.equal('calculateGuyedMast' in structural, false)
  assert.equal(typeof engineering.calculateGuyedMast, 'function')
  assert.equal(typeof engineering.analyzeCheckedFrame, 'function')
  assert.doesNotMatch(structuralSource, /memberStrengthResult|designYieldPa|stressUtilization|bucklingUtilization/)
  assert.match(memberCheckSource, /memberStrengthResult/)
  assert.match(memberCheckSource, /designYieldPa/)
  assert.match(memberCheckSource, /stressUtilization/)
  assert.match(memberCheckSource, /bucklingUtilization/)
})

test('independent dense FEM is available only from structural verification entrypoint', () => {
  assert.equal(typeof structuralTesting.analyzeIndependentDenseFrame, 'function')
  assert.equal('analyzeIndependentDenseFrame' in structural, false)
})

test('pre-foundation site/engine implementation is physically absent', () => {
  assert.equal(fs.existsSync(new URL('../site/engine/', import.meta.url)), false)
})