import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeFrame,
  analyzeFrameStatic,
  buildLoadCase,
  generateMastModel,
} from '../packages/structural-analysis/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

function assertStaticSubsetEqual(staticResult, fullResult) {
  assert.equal(staticResult.analysisScope, 'linear-static')
  assert.equal(Object.hasOwn(staticResult, 'buckling'), false)
  assert.equal(Object.hasOwn(staticResult, 'maxUtilization'), false)
  assert.equal(Object.hasOwn(staticResult, 'criticalMemberId'), false)

  assert.equal(staticResult.solver, fullResult.solver)
  assert.equal(staticResult.linearSystemSolver, fullResult.linearSystemSolver)
  assert.equal(staticResult.degreesOfFreedomPerNode, fullResult.degreesOfFreedomPerNode)
  assert.deepEqual(staticResult.displacements, fullResult.displacements)
  assert.deepEqual(staticResult.rotations, fullResult.rotations)
  assert.deepEqual(staticResult.reactions, fullResult.reactions)
  assert.deepEqual(staticResult.reactionMoments, fullResult.reactionMoments)
  assert.deepEqual(staticResult.memberResults, fullResult.memberResults)
  assert.equal(staticResult.maxDisplacementM, fullResult.maxDisplacementM)
  assert.equal(staticResult.maxTopDisplacementM, fullResult.maxTopDisplacementM)
  assert.equal(staticResult.totalMassKg, fullResult.totalMassKg)
  assert.deepEqual(staticResult.diagnostics, fullResult.diagnostics)

  assert.ok(Number.isFinite(fullResult.buckling.criticalLoadFactor))
  assert.ok(fullResult.buckling.criticalLoadFactor > 0)
}

for (const moduleCount of [1, 2, 4, 12]) {
  test(`static-only frame solve is exactly the static subset of full analysis for ${moduleCount} modules`, () => {
    const parameters = resolvedProject({
      moduleCount,
      equipmentMassKg: 35,
      windPressurePa: 420,
      windDirectionDeg: 37,
    })
    const model = generateMastModel(parameters)
    const loadCase = buildLoadCase(model, parameters)
    const staticResult = analyzeFrameStatic(model, loadCase, parameters)
    const fullResult = analyzeFrame(model, loadCase, parameters)

    assertStaticSubsetEqual(staticResult, fullResult)
    assert.equal(staticResult.diagnostics.stiffnessFactorizationCount, 1)
  })
}

test('static-only frame solve preserves mixed diameters, ice and oblique wind exactly', () => {
  const parameters = resolvedProject({
    moduleCount: 4,
    moduleDiametersMm: [20, 18, 16, 14],
    equipmentMassKg: 65,
    windPressurePa: 730,
    windDirectionDeg: 23,
    iceThicknessMm: 8,
    iceDensityKgM3: 900,
  })
  const model = generateMastModel(parameters)
  const loadCase = buildLoadCase(model, parameters)
  const staticResult = analyzeFrameStatic(model, loadCase, parameters)
  const fullResult = analyzeFrame(model, loadCase, parameters)

  assertStaticSubsetEqual(staticResult, fullResult)
  assert.ok(staticResult.diagnostics.maximumNodeEquilibriumResidual < 1e-8)
  assert.ok(staticResult.diagnostics.globalMomentResidual < 1e-8)
})