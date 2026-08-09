import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateErectionEnvelope,
  calculateErectionState,
  frameMemberActionMagnitudes,
  generateMastModel,
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

function stablePath(parameters, midpointAngleDeg = 35) {
  const model = generateMastModel(parameters)
  const hingeNodeIds = [model.baseNodeIds[0], model.baseNodeIds[1]]
  const attachmentNodeId = model.topNodeIds[0]
  const probe = calculateErectionState(model, parameters, {
    angleDeg: midpointAngleDeg,
    hingeNodeIds,
    attachmentNodeId,
    anchorPointM: [50, 50, 50],
  })
  const hingePoint = model.nodes[hingeNodeIds[0]].position
  const radius = sub(probe.geometry.attachmentPointM, hingePoint)
  const maximumMomentDirection = unit(cross(probe.geometry.hingeAxis, radius))
  const cableDirection = scale(
    maximumMomentDirection,
    probe.gravityMomentAboutHingeNm > 0 ? -1 : 1,
  )
  const anchorPointM = add(probe.geometry.attachmentPointM, scale(cableDirection, 30))
  return {
    model,
    input: {
      hingeNodeIds,
      attachmentNodeId,
      anchorPointM,
      startAngleDeg: midpointAngleDeg - 5,
      endAngleDeg: midpointAngleDeg + 5,
    },
  }
}

test('member N/V/T/M envelope extraction follows the 12-DOF local end-force convention', () => {
  const action = frameMemberActionMagnitudes({
    localEndForces: [
      100, 3, 4, 5, 6, 8,
      -120, 5, 12, -7, 9, 12,
    ],
  })

  assert.deepEqual(action, {
    axialN: 120,
    shearN: 13,
    torsionNm: 7,
    bendingNm: 15,
  })
})

test('adaptive erection envelope keeps the anchor fixed in world coordinates and every feasible state in equilibrium', () => {
  const parameters = resolvedProject({ moduleCount: 1, equipmentMassKg: 35 })
  const { model, input } = stablePath(parameters)
  const envelope = calculateErectionEnvelope(model, parameters, input, {
    initialSegments: 2,
    relativeTolerance: 0.02,
    minimumStep: 0.5,
    maximumEvaluations: 25,
  })

  assert.equal(envelope.model, 'tilt-up-quasi-static-envelope-v1')
  assert.ok(envelope.feasibleSampleCount > 0)
  assert.ok(envelope.maximumCableTensionN)
  assert.ok(envelope.maximumCableTensionN.value > 0)
  assert.ok(envelope.memberActions.length === model.members.length)

  for (const sample of envelope.samples) {
    assert.deepEqual(sample.result.geometry.anchorPointM, input.anchorPointM)
    if (sample.result.status !== 'ok') continue
    assert.ok(sample.result.normalizedGaugeReaction < 1e-8)
    assert.ok(sample.result.analysis.diagnostics.maximumNodeEquilibriumResidual < 1e-8)
    assert.ok(sample.result.analysis.diagnostics.globalMomentResidual < 1e-8)
  }

  const governingSample = envelope.samples[envelope.maximumCableTensionN.sampleIndex]
  assert.equal(governingSample.angleDeg, envelope.maximumCableTensionN.angleDeg)
  assert.equal(governingSample.result.status, 'ok')
  assert.equal(governingSample.result.requiredCableTensionN, envelope.maximumCableTensionN.value)
})

test('tighter adaptive sweep retains or increases every sampled member-action envelope', () => {
  const parameters = resolvedProject({ moduleCount: 1, equipmentMassKg: 45 })
  const { model, input } = stablePath(parameters, 40)
  const coarse = calculateErectionEnvelope(model, parameters, input, {
    initialSegments: 2,
    relativeTolerance: 0.04,
    minimumStep: 1,
    maximumEvaluations: 17,
  })
  const tight = calculateErectionEnvelope(model, parameters, input, {
    initialSegments: 2,
    relativeTolerance: 0.008,
    minimumStep: 0.25,
    maximumEvaluations: 49,
  })

  assert.ok(coarse.maximumCableTensionN)
  assert.ok(tight.maximumCableTensionN)
  assert.ok(tight.maximumCableTensionN.value + 1e-8 >= coarse.maximumCableTensionN.value)
  assert.ok(Math.abs(tight.maximumCableTensionN.value - coarse.maximumCableTensionN.value) / tight.maximumCableTensionN.value < 0.05)

  for (let index = 0; index < coarse.memberActions.length; index += 1) {
    const loose = coarse.memberActions[index]
    const refined = tight.memberActions[index]
    for (const field of ['axialN', 'shearN', 'torsionNm', 'bendingNm']) {
      assert.ok(refined[field].value + 1e-8 >= loose[field].value)
    }
  }
})

test('path with a fixed anchor on the hinge remains explicitly singular instead of fabricating an envelope', () => {
  const parameters = resolvedProject({ moduleCount: 1, equipmentMassKg: 20 })
  const model = generateMastModel(parameters)
  const hingeNodeIds = [model.baseNodeIds[0], model.baseNodeIds[1]]
  const anchorPointM = [...model.nodes[hingeNodeIds[0]].position]
  const envelope = calculateErectionEnvelope(model, parameters, {
    hingeNodeIds,
    attachmentNodeId: model.topNodeIds[0],
    anchorPointM,
    startAngleDeg: 20,
    endAngleDeg: 50,
  }, {
    initialSegments: 2,
    minimumStep: 1,
    maximumEvaluations: 15,
  })

  assert.equal(envelope.feasibleSampleCount, 0)
  assert.equal(envelope.infeasibleSampleCount, envelope.samples.length)
  assert.equal(envelope.maximumCableTensionN, null)
  assert.equal(envelope.maximumDisplacementM, null)
  assert.ok(envelope.samples.every((sample) => (
    sample.result.status === 'infeasible' && sample.result.reason === 'singular-cable-geometry'
  )))
})
