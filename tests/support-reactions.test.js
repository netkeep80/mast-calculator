import assert from 'node:assert/strict'
import test from 'node:test'
import { generateMastModel } from '../packages/structural-analysis/index.js'
import { buildLoadCase } from '../packages/structural-analysis/index.js'
import { analyzeIndependentDenseFrame } from '../packages/structural-analysis/testing.js'
import { analyzeFrame } from '../packages/structural-analysis/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const GRAVITY_M_S2 = 9.80665

const approximately = (actual, expected, relative = 1e-8, absolute = 1e-7) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `ожидалось ${expected}, получено ${actual}, допуск ${tolerance}`,
  )
}

const averagePosition = (nodes) => nodes.reduce(
  (sum, node) => sum.map((value, axis) => value + node.position[axis] / nodes.length),
  [0, 0, 0],
)

const midpoint = (left, right) => left.map((value, axis) => (value + right[axis]) / 2)

function staticsParameters(overrides = {}) {
  return resolvedProject({
    moduleCount: 4,
    deadLoadFactor: 1,
    windPresetId: 'custom',
    windPressurePa: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    iceThicknessMm: 0,
    windEnvelopeEnabled: false,
    ...overrides,
  })
}

function pointSupportModel(parameters) {
  const generated = generateMastModel(parameters)
  const base = new Set(generated.baseNodeIds)
  return {
    ...generated,
    nodes: generated.nodes.map((node) => ({
      ...node,
      // Issue #26 задаёт статически определимые реакции трёх ТОЧЕЧНЫХ опор.
      // Поэтому в verification fixture запрещены три перемещения основания,
      // но отпущены три вращения. В production-модели фундамент остаётся
      // полной заделкой; этот fixture является аналитическим oracle решателя.
      restrained: base.has(node.id)
        ? [true, true, true, false, false, false]
        : [...node.restrained],
    })),
  }
}

function independentSelfWeightOracle(model, parameters) {
  let weightN = 0
  const firstMoment = [0, 0, 0]

  for (const member of model.members) {
    const a = model.nodes[member.nodeA].position
    const b = model.nodes[member.nodeB].position
    const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const memberWeightN = member.densityKgM3 * areaM2 * lengthM
      * GRAVITY_M_S2 * parameters.deadLoadFactor
    const center = midpoint(a, b)
    weightN += memberWeightN
    for (let axis = 0; axis < 3; axis += 1) firstMoment[axis] += center[axis] * memberWeightN
  }

  return {
    weightN,
    center: firstMoment.map((value) => value / weightN),
  }
}

function forceToMoveReactionResultant(weightN, gravityCenter, target, topHeightM) {
  const dx = target[0] - gravityCenter[0]
  const dy = target[1] - gravityCenter[1]
  const eccentricityM = Math.hypot(dx, dy)
  if (!(eccentricityM > 0) || !(topHeightM > 0)) throw new Error('Некорректная геометрия рычага')
  const directionDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360
  return {
    eccentricityM,
    topHeightM,
    directionDeg,
    forceN: weightN * eccentricityM / topHeightM,
  }
}

function solveOracleCase(model, parameters, horizontalForceN = 0, directionDeg = 0) {
  const radians = directionDeg * Math.PI / 180
  const topPointLoadN = [
    horizontalForceN * Math.cos(radians),
    horizontalForceN * Math.sin(radians),
    0,
  ]
  const loadCase = buildLoadCase(model, {
    ...parameters,
    windDirectionDeg: directionDeg,
  }, { topPointLoadN })
  const global = analyzeFrame(model, loadCase, parameters)
  const reference = analyzeIndependentDenseFrame(
    model,
    loadCase,
    parameters,
    null,
    { includeBuckling: false },
  )
  return { loadCase, global, reference }
}

const verticalBaseReactions = (analysis, model) => (
  model.baseNodeIds.map((nodeId) => analysis.reactions[nodeId][2])
)

function assertReactionPattern(actual, expected, weightN) {
  assert.equal(actual.length, expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    approximately(actual[index], expected[index], 2e-7, weightN * 2e-8)
  }
  approximately(actual.reduce((sum, value) => sum + value, 0), weightN, 2e-8, weightN * 2e-9)
}

function assertReactionBarycenter(actual, model, expectedPoint) {
  const total = actual.reduce((sum, value) => sum + value, 0)
  const point = [0, 1].map((axis) => model.baseNodeIds.reduce(
    (sum, nodeId, index) => sum + model.nodes[nodeId].position[axis] * actual[index] / total,
    0,
  ))
  approximately(point[0], expectedPoint[0], 2e-7, 2e-8)
  approximately(point[1], expectedPoint[1], 2e-7, 2e-8)
}

function assertTwoSolversMatch(global, reference, model, weightN) {
  const globalReactions = verticalBaseReactions(global, model)
  const referenceReactions = verticalBaseReactions(reference, model)
  for (let index = 0; index < globalReactions.length; index += 1) {
    approximately(globalReactions[index], referenceReactions[index], 2e-7, weightN * 2e-8)
  }
  assert.ok(global.diagnostics.relativeResidual < 1e-8)
  assert.ok(reference.diagnostics.relativeResidual < 1e-8)
  assert.ok(reference.diagnostics.maximumFreeEquilibriumResidual < 1e-8)
}

test('статика опор: без ветра три нижних узла несут ровно по 1/3 собственного веса', () => {
  const parameters = staticsParameters()
  const model = pointSupportModel(parameters)
  const oracle = independentSelfWeightOracle(model, parameters)
  const { loadCase, global, reference } = solveOracleCase(model, parameters)

  approximately(loadCase.selfWeightN, oracle.weightN, 1e-12, 1e-8)
  approximately(oracle.center[0], 0, 0, 1e-12)
  approximately(oracle.center[1], 0, 0, 1e-12)

  const expected = [oracle.weightN / 3, oracle.weightN / 3, oracle.weightN / 3]
  assertReactionPattern(verticalBaseReactions(global, model), expected, oracle.weightN)
  assertReactionPattern(verticalBaseReactions(reference, model), expected, oracle.weightN)
  assertTwoSolversMatch(global, reference, model, oracle.weightN)
})

test('статика опор: внутренняя сила F = W·e/H выводит результирующую на противоположное ребро и даёт 0, 1/2, 1/2', () => {
  const parameters = staticsParameters()
  const model = pointSupportModel(parameters)
  const oracle = independentSelfWeightOracle(model, parameters)
  const baseNodes = model.baseNodeIds.map((nodeId) => model.nodes[nodeId])
  const topNodes = model.topNodeIds.map((nodeId) => model.nodes[nodeId])
  const baseCenter = averagePosition(baseNodes)
  const topCenter = averagePosition(topNodes)
  const target = midpoint(baseNodes[1].position, baseNodes[2].position)
  const lever = forceToMoveReactionResultant(
    oracle.weightN,
    oracle.center,
    target,
    topCenter[2] - baseCenter[2],
  )

  const sideM = parameters.triangleSideMm / 1000
  approximately(lever.eccentricityM, sideM / (2 * Math.sqrt(3)), 1e-12, 1e-12)
  approximately(lever.forceN * lever.topHeightM, oracle.weightN * lever.eccentricityM, 1e-12, 1e-8)

  const { global, reference } = solveOracleCase(
    model,
    parameters,
    lever.forceN,
    lever.directionDeg,
  )
  const expected = [0, oracle.weightN / 2, oracle.weightN / 2]
  const globalReactions = verticalBaseReactions(global, model)
  const referenceReactions = verticalBaseReactions(reference, model)

  assertReactionPattern(globalReactions, expected, oracle.weightN)
  assertReactionPattern(referenceReactions, expected, oracle.weightN)
  assertReactionBarycenter(globalReactions, model, target)
  assertReactionBarycenter(referenceReactions, model, target)
  assertTwoSolversMatch(global, reference, model, oracle.weightN)
})

test('статика опор: внутренняя сила F = W·R/H выводит результирующую в один нижний узел и даёт W, 0, 0', () => {
  const parameters = staticsParameters()
  const model = pointSupportModel(parameters)
  const oracle = independentSelfWeightOracle(model, parameters)
  const baseNodes = model.baseNodeIds.map((nodeId) => model.nodes[nodeId])
  const topNodes = model.topNodeIds.map((nodeId) => model.nodes[nodeId])
  const baseCenter = averagePosition(baseNodes)
  const topCenter = averagePosition(topNodes)
  const target = baseNodes[0].position
  const vertexLever = forceToMoveReactionResultant(
    oracle.weightN,
    oracle.center,
    target,
    topCenter[2] - baseCenter[2],
  )
  const oppositeEdge = midpoint(baseNodes[1].position, baseNodes[2].position)
  const edgeLever = forceToMoveReactionResultant(
    oracle.weightN,
    oracle.center,
    oppositeEdge,
    topCenter[2] - baseCenter[2],
  )

  const sideM = parameters.triangleSideMm / 1000
  approximately(vertexLever.eccentricityM, sideM / Math.sqrt(3), 1e-12, 1e-12)
  approximately(vertexLever.forceN, 2 * edgeLever.forceN, 1e-12, 1e-8)
  approximately(
    vertexLever.forceN * vertexLever.topHeightM,
    oracle.weightN * vertexLever.eccentricityM,
    1e-12,
    1e-8,
  )

  const { global, reference } = solveOracleCase(
    model,
    parameters,
    vertexLever.forceN,
    vertexLever.directionDeg,
  )
  const expected = [oracle.weightN, 0, 0]
  const globalReactions = verticalBaseReactions(global, model)
  const referenceReactions = verticalBaseReactions(reference, model)

  assertReactionPattern(globalReactions, expected, oracle.weightN)
  assertReactionPattern(referenceReactions, expected, oracle.weightN)
  assertReactionBarycenter(globalReactions, model, target)
  assertReactionBarycenter(referenceReactions, model, target)
  assertTwoSolversMatch(global, reference, model, oracle.weightN)
})
