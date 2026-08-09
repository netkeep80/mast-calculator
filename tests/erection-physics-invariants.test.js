import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateErectionState,
  generateMastModel,
  projectedMomentAboutAxis,
} from '../packages/structural-analysis/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const add = (a, b) => a.map((value, index) => value + b[index])
const sub = (a, b) => a.map((value, index) => value - b[index])
const scale = (a, factor) => a.map((value) => value * factor)
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a) => Math.hypot(...a)
const unit = (a) => scale(a, 1 / norm(a))

function optimizedCableState(parameters, angleDeg = 35) {
  const model = generateMastModel(parameters)
  const hingeNodeIds = [model.baseNodeIds[0], model.baseNodeIds[1]]
  const attachmentNodeId = model.topNodeIds[0]
  const probe = calculateErectionState(model, parameters, {
    angleDeg,
    hingeNodeIds,
    attachmentNodeId,
    anchorPointM: [50, 50, 50],
  })
  const hingePoint = model.nodes[hingeNodeIds[0]].position
  const radius = sub(probe.geometry.attachmentPointM, hingePoint)
  const bestCableForceDirection = unit(cross(probe.geometry.hingeAxis, radius))
  const desiredSign = probe.gravityMomentAboutHingeNm > 0 ? -1 : 1
  const cableDirection = scale(bestCableForceDirection, desiredSign)
  const input = {
    angleDeg,
    hingeNodeIds,
    attachmentNodeId,
    anchorPointM: add(probe.geometry.attachmentPointM, scale(cableDirection, 10)),
  }
  return {
    model,
    input,
    result: calculateErectionState(model, parameters, input),
    expectedLeverArmM: norm(cross(probe.geometry.hingeAxis, radius)),
  }
}

test('projected hinge moment reproduces a hand-checkable point-mass and cable oracle', () => {
  const gravityMomentNm = projectedMomentAboutAxis(
    [0, 0, 0],
    [1, 0, 0],
    [0, 4, 0],
    [0, 0, -100],
  )
  const cableUnitMomentM = projectedMomentAboutAxis(
    [0, 0, 0],
    [1, 0, 0],
    [0, 4, 0],
    [0, -4 / 5, 3 / 5],
  )
  assert.equal(gravityMomentNm, -400)
  assert.equal(cableUnitMomentM, 2.4)
  assert.ok(Math.abs(-gravityMomentNm / cableUnitMomentM - 500 / 3) < 1e-12)
})

test('tilt-up tension is derived from hinge equilibrium and artificial gauge reaction vanishes', () => {
  const parameters = resolvedProject({ moduleCount: 2, equipmentMassKg: 45 })
  const { result, expectedLeverArmM } = optimizedCableState(parameters)
  assert.equal(result.status, 'ok')
  assert.ok(result.requiredCableTensionN > 0)
  assert.ok(Math.abs(Math.abs(result.cableMomentArmM) - expectedLeverArmM) < 1e-10)
  const expectedTensionN = Math.abs(result.gravityMomentAboutHingeNm) / expectedLeverArmM
  assert.ok(Math.abs(result.requiredCableTensionN - expectedTensionN) / expectedTensionN < 1e-10)
  assert.ok(result.normalizedGaugeReaction < 1e-8)
  assert.ok(result.analysis.diagnostics.maximumNodeEquilibriumResidual < 1e-8)
  assert.ok(result.analysis.diagnostics.globalMomentResidual < 1e-8)
  assert.equal(result.analysis.diagnostics.stiffnessFactorizationCount, 1)
  assert.equal(result.analysis.analysisScope, 'linear-static')
  assert.equal(Object.hasOwn(result.analysis, 'buckling'), false)
})

test('erection inertia load is physical and does not reuse operational reliability factors', () => {
  const base = resolvedProject({
    moduleCount: 2,
    equipmentMassKg: 80,
    deadLoadFactor: 1,
    equipmentLoadFactor: 1,
    windLoadFactor: 1,
  })
  const factored = resolvedProject({
    moduleCount: 2,
    equipmentMassKg: 80,
    deadLoadFactor: 2.7,
    equipmentLoadFactor: 2.9,
    windLoadFactor: 3.1,
  })
  const reference = optimizedCableState(base, 42)
  assert.equal(reference.result.status, 'ok')
  const factoredModel = generateMastModel(factored)
  const factoredResult = calculateErectionState(factoredModel, factored, reference.input)
  assert.equal(factoredResult.status, 'ok')
  assert.ok(Math.abs(reference.result.physicalSteelWeightN - factoredResult.physicalSteelWeightN) < 1e-9)
  assert.ok(Math.abs(reference.result.physicalEquipmentWeightN - factoredResult.physicalEquipmentWeightN) < 1e-9)
  assert.ok(Math.abs(reference.result.requiredCableTensionN - factoredResult.requiredCableTensionN) < 1e-8)
})

test('cable line through the hinge is reported as singular instead of regularized', () => {
  const parameters = resolvedProject({ moduleCount: 1, equipmentMassKg: 25 })
  const model = generateMastModel(parameters)
  const hingeNodeIds = [model.baseNodeIds[0], model.baseNodeIds[1]]
  const result = calculateErectionState(model, parameters, {
    angleDeg: 30,
    hingeNodeIds,
    attachmentNodeId: model.topNodeIds[0],
    anchorPointM: model.nodes[hingeNodeIds[0]].position,
  })
  assert.equal(result.status, 'infeasible')
  assert.equal(result.reason, 'singular-cable-geometry')
  assert.equal(result.requiredCableTensionN, null)
})

test('cable geometry demanding compression is explicitly infeasible', () => {
  const parameters = resolvedProject({ moduleCount: 2, equipmentMassKg: 50 })
  const feasible = optimizedCableState(parameters, 50)
  assert.equal(feasible.result.status, 'ok')
  const attachment = feasible.result.geometry.attachmentPointM
  const workingDirection = feasible.result.geometry.cableDirection
  const oppositeAnchor = add(attachment, scale(workingDirection, -10))
  const result = calculateErectionState(feasible.model, parameters, {
    ...feasible.input,
    anchorPointM: oppositeAnchor,
  })
  assert.equal(result.status, 'infeasible')
  assert.equal(result.reason, 'cable-would-need-compression')
  assert.ok(result.requiredCableTensionN < 0)
})