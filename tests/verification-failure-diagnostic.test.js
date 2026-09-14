import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateProject,
  createProjectInput,
  createVerification,
} from '../packages/application/index.js'
import {
  analyzeIndependentDenseFrame,
  compileIndependentDenseSystem,
} from '../packages/structural-analysis/testing.js'

const compactInput = createProjectInput({
  geometry: { moduleCount: 1 },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 250,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  },
  equipment: {
    massKg: 10,
    windAreaM2: 0.2,
  },
  criteria: { heightSearchMaxModules: 2 },
})

test('diagnostic: compact public calculation has no failed verification checks', () => {
  const result = calculateProject(compactInput)
  const verification = createVerification(result)
  const referenceSystem = compileIndependentDenseSystem(result.model)
  const cases = result.cases.map((item) => {
    const dense = analyzeIndependentDenseFrame(
      result.model,
      item.loads,
      result.parameters,
      referenceSystem,
      { includeBuckling: true },
    )
    const productionFactor = item.analysis.buckling.criticalLoadFactor
    const denseFactor = dense.buckling?.factor ?? null
    return {
      windDirectionDeg: item.windDirectionDeg,
      production: {
        factor: productionFactor,
        residual: item.analysis.buckling.residual,
        eigenResidual: item.analysis.buckling.eigenResidual,
        iterations: item.analysis.buckling.iterations,
      },
      dense: dense.buckling,
      factorRelativeDifference: Number.isFinite(productionFactor) && Number.isFinite(denseFactor)
        ? Math.abs(productionFactor - denseFactor) / Math.max(1, Math.abs(productionFactor), Math.abs(denseFactor))
        : null,
    }
  })
  const failed = verification.checks
    .filter((check) => check.status === 'fail')
    .map((check) => ({
      id: check.id,
      level: check.level,
      title: check.title,
      actual: check.actual,
      expected: check.expected,
      tolerance: check.tolerance,
      relativeError: check.relativeError,
      evidence: check.evidence,
    }))

  assert.deepEqual({ failed, cases }, { failed: [], cases: [] })
})
