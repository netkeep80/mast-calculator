import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_PARAMETERS,
  resolveCalculationParameters,
} from '../site/engine/calculate.js'
import { generateMastModel } from '../site/engine/geometry.js'
import { buildLoadCase } from '../site/engine/loads.js'
import { compileModuleStack, solveModuleStack } from '../site/engine/module-stack.js'
import {
  analyzeIndependentDenseFrame,
  compileIndependentDenseSystem,
} from '../site/engine/reference-frame.js'
import { analyzeFrame, compileFrameSystem } from '../site/engine/solver.js'

const flatten = (values) => values.flatMap((value) => value)
const maxAbs = (values) => Math.max(0, ...values.map((value) => Math.abs(value)))

function assertCloseVector(actual, expected, label, relativeTolerance, absoluteTolerance) {
  assert.equal(actual.length, expected.length, `${label}: разная длина векторов`)
  const difference = actual.map((value, index) => value - expected[index])
  const maximumDifference = maxAbs(difference)
  const scale = Math.max(maxAbs(actual), maxAbs(expected), absoluteTolerance)
  const tolerance = Math.max(absoluteTolerance, relativeTolerance * scale)
  assert.ok(
    maximumDifference <= tolerance,
    `${label}: max |Δ|=${maximumDifference}, scale=${scale}, tolerance=${tolerance}`,
  )
}

function globalDofVector(analysis) {
  return analysis.displacements.flatMap((displacement, nodeId) => [
    ...displacement,
    ...analysis.rotations[nodeId],
  ])
}

function baseReactionVector(analysis, model) {
  return model.baseNodeIds.flatMap((nodeId) => [
    ...analysis.reactions[nodeId],
    ...analysis.reactionMoments[nodeId],
  ])
}

function modularBaseReactionVector(modular) {
  return modular.modules[0].bottomReactionFromBelow.flatMap((action) => [
    ...action.forceN,
    ...action.momentNm,
  ])
}

function memberForceVector(globalAnalysis) {
  return globalAnalysis.memberResults.flatMap((member) => member.localEndForces)
}

function runThreeWays(overrides, { compareBuckling = false } = {}) {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    windPresetId: 'custom',
    windEnvelopeEnabled: false,
    ...overrides,
  })
  const model = generateMastModel(parameters)
  const loads = buildLoadCase(model, parameters)

  const globalSystem = compileFrameSystem(model, parameters)
  const global = analyzeFrame(model, loads, parameters, globalSystem)

  const moduleSystem = compileModuleStack(model, globalSystem.memberGeometry)
  const modular = solveModuleStack(model, moduleSystem, loads)

  const referenceSystem = compileIndependentDenseSystem(model)
  const reference = analyzeIndependentDenseFrame(
    model,
    loads,
    parameters,
    referenceSystem,
    { includeBuckling: compareBuckling },
  )

  return { parameters, model, loads, global, modular, reference }
}

function assertTripleStaticIdentity(state) {
  const globalVector = globalDofVector(state.global)
  const modularVector = Array.from(state.modular.displacementVector)
  const referenceVector = Array.from(state.reference.displacementVector)

  // Different assembly/storage/solution algorithms should agree far more
  // closely than any engineering accuracy requirement. The tolerances below
  // are numerical round-off tolerances, not structural-design allowances.
  assertCloseVector(modularVector, globalVector, 'Schur ↔ global DOF', 2e-9, 2e-12)
  assertCloseVector(referenceVector, globalVector, 'dense reference ↔ global DOF', 2e-9, 2e-12)
  assertCloseVector(referenceVector, modularVector, 'dense reference ↔ Schur DOF', 3e-9, 3e-12)

  const globalReactions = baseReactionVector(state.global, state.model)
  const denseReactions = state.model.baseNodeIds.flatMap((nodeId) => [
    ...state.reference.reactions[nodeId],
    ...state.reference.reactionMoments[nodeId],
  ])
  const modularReactions = modularBaseReactionVector(state.modular)
  assertCloseVector(denseReactions, globalReactions, 'dense reference ↔ global reactions', 3e-9, 2e-6)
  assertCloseVector(modularReactions, globalReactions, 'Schur ↔ global reactions', 3e-9, 2e-6)

  assertCloseVector(
    flatten(state.reference.memberLocalEndForces),
    memberForceVector(state.global),
    'dense reference ↔ global member end forces',
    5e-9,
    3e-6,
  )

  assert.ok(state.global.diagnostics.relativeResidual < 1e-8)
  assert.ok(state.modular.interfaceEquilibriumResidual < 1e-8)
  assert.ok(state.reference.diagnostics.relativeResidual < 1e-8)
  assert.ok(state.reference.diagnostics.maximumFreeEquilibriumResidual < 1e-8)
}

function assertBucklingIdentity(state) {
  assert.ok(state.reference.buckling, 'dense reference buckling должен быть рассчитан')
  const globalFactor = state.global.buckling.criticalLoadFactor
  const denseFactor = state.reference.buckling.factor
  if (!Number.isFinite(globalFactor) || !Number.isFinite(denseFactor)) {
    assert.equal(Number.isFinite(globalFactor), Number.isFinite(denseFactor))
    return
  }
  const relative = Math.abs(globalFactor - denseFactor) / Math.max(1, Math.abs(globalFactor), Math.abs(denseFactor))
  assert.ok(relative < 2e-5, `global/dense λcr расходятся: ${globalFactor} vs ${denseFactor}, relative=${relative}`)
  assert.ok(state.global.buckling.residual < 1e-5)
  assert.ok(state.reference.buckling.residual < 1e-5)
}

test('третий solver действительно независим от production global/Schur implementation', () => {
  const source = fs.readFileSync(new URL('../site/engine/reference-frame.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from ['"]\.\/solver\.js['"]/)
  assert.doesNotMatch(source, /from ['"]\.\/module-stack\.js['"]/)
  assert.doesNotMatch(source, /from ['"]\.\/banded\.js['"]/)
  assert.match(source, /independent-dense-gaussian-reference-v1/)
})

test('1 модуль: собственный вес совпадает тремя независимыми путями', () => {
  const state = runThreeWays({
    moduleCount: 1,
    windPressurePa: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 0,
    extraVerticalLoadN: 0,
    iceThicknessMm: 0,
  }, { compareBuckling: true })
  assertTripleStaticIdentity(state)
  assertBucklingIdentity(state)
})

test('2 модуля: косой ветер, оборудование и узловая нагрузка совпадают тремя путями', () => {
  const state = runThreeWays({
    moduleCount: 2,
    windDirectionDeg: 17,
    windPressurePa: 420,
    equipmentMassKg: 31,
    equipmentWindAreaM2: 0.47,
    equipmentDragCoefficient: 1.25,
    extraHorizontalLoadN: 730,
    extraVerticalLoadN: 260,
  }, { compareBuckling: true })
  assertTripleStaticIdentity(state)
  assertBucklingIdentity(state)
})

test('4 модуля: лёд + ветер + вертикальная нагрузка совпадают, включая λcr', () => {
  const state = runThreeWays({
    moduleCount: 4,
    windDirectionDeg: 43,
    windPressurePa: 610,
    iceThicknessMm: 9,
    iceDensityKgM3: 900,
    equipmentMassKg: 42,
    equipmentWindAreaM2: 0.58,
    extraHorizontalLoadN: 410,
    extraVerticalLoadN: 850,
  }, { compareBuckling: true })
  assertTripleStaticIdentity(state)
  assertBucklingIdentity(state)
})

test('7 модулей: чистая большая боковая сила совпадает по DOF, реакциям и N/V/T/M', () => {
  const state = runThreeWays({
    moduleCount: 7,
    windDirectionDeg: 71,
    windPressurePa: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 3200,
    extraVerticalLoadN: 0,
    iceThicknessMm: 0,
  })
  assertTripleStaticIdentity(state)
})

test('10 модулей: эксплуатационная комбинация совпадает тремя путями', () => {
  const state = runThreeWays({
    moduleCount: 10,
    windDirectionDeg: 29,
    windPressurePa: 380,
    iceThicknessMm: 4,
    equipmentMassKg: 20,
    equipmentWindAreaM2: 0.35,
    extraHorizontalLoadN: 180,
    extraVerticalLoadN: 120,
  })
  assertTripleStaticIdentity(state)
})

test('12 модулей: расчёт реального масштаба текущей мачты совпадает тремя путями', { timeout: 20_000 }, () => {
  const state = runThreeWays({
    moduleCount: 12,
    windDirectionDeg: 37,
    windPressurePa: 380,
    equipmentMassKg: 20,
    equipmentWindAreaM2: 0.35,
    extraHorizontalLoadN: 250,
    extraVerticalLoadN: 200,
  })
  assertTripleStaticIdentity(state)
})
