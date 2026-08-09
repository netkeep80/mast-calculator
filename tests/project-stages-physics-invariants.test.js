import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MastApplicationError,
  calculateProject,
  calculateProjectErection,
  calculateProjectGuys,
  calculateProjectStages,
  createProjectInput,
  resolveProjectInput,
} from '../packages/application/index.js'
import { DEFAULT_GUY_WIRE_ID } from '../packages/domain/index.js'
import {
  calculateErectionState,
  generateMastModel,
} from '../packages/structural-analysis/index.js'

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

function stableErectionInput(project, midpointAngleDeg = 35) {
  const parameters = resolveProjectInput(project)
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
  const momentDirection = unit(cross(probe.geometry.hingeAxis, radius))
  const cableDirection = scale(momentDirection, probe.gravityMomentAboutHingeNm > 0 ? -1 : 1)
  return {
    mode: 'tilt-up',
    hingeBaseEdgeIndex: 0,
    attachmentTopCornerIndex: 0,
    anchorPointM: add(probe.geometry.attachmentPointM, scale(cableDirection, 30)),
    rotationSense: 1,
    startAngleDeg: midpointAngleDeg - 4,
    endAngleDeg: midpointAngleDeg + 4,
    sampling: {
      initialSegments: 2,
      relativeTolerance: 0.02,
      minimumAngleStepDeg: 0.5,
      maximumEvaluations: 17,
      maximumDepth: 8,
    },
  }
}

function guyInput() {
  return {
    safetyFactor: 3,
    terminationEfficiency: 0.8,
    tiers: [{
      id: 'stage-test',
      heightM: 1,
      anchorRadiusM: 8,
      guyCount: 3,
      pretensionN: 500,
      azimuthOffsetDeg: 0,
      wireId: DEFAULT_GUY_WIRE_ID,
    }],
  }
}

test('all-stage job equals independent operational, guy and erection application calls', () => {
  const project = createProjectInput({ geometry: { moduleCount: 2 }, equipment: { massKg: 20 } })
  const guys = guyInput()
  const erection = stableErectionInput(project)
  const progress = []

  const operational = calculateProject(project)
  const directGuys = calculateProjectGuys(project, guys, operational)
  const directErection = calculateProjectErection(project, erection)
  const staged = calculateProjectStages(project, guys, erection, {
    onProgress: (item) => progress.push(item),
  })

  assert.deepEqual(staged.result, operational)
  assert.deepEqual(staged.guyedResult, directGuys)
  assert.deepEqual(staged.erectionResult, directErection)
  assert.ok(Object.isFrozen(staged))
  assert.ok(Object.isFrozen(staged.erectionResult))
  assert.ok(progress.some((item) => item.phase === 'guys'))
  assert.ok(progress.some((item) => item.phase === 'erection'))
  assert.equal(progress.at(-1).phase, 'complete')
  assert.equal(progress.at(-1).fraction, 1)
  for (let index = 1; index < progress.length; index += 1) {
    assert.ok(progress[index].fraction >= progress[index - 1].fraction - 1e-12)
  }
})

test('absent optional stages reproduce the operational application result exactly', () => {
  const project = createProjectInput({ geometry: { moduleCount: 2 } })
  const direct = calculateProject(project)
  const staged = calculateProjectStages(project, null, null)

  assert.deepEqual(staged.result, direct)
  assert.equal(staged.guyedResult, null)
  assert.equal(staged.erectionResult, null)
})

test('explicit disabled erection is a no-op sibling', () => {
  const project = createProjectInput({ geometry: { moduleCount: 1 } })
  const staged = calculateProjectStages(project, null, { mode: 'disabled' })
  assert.equal(staged.erectionResult, null)
  assert.deepEqual(staged.result, calculateProject(project))
})

test('erection stage cooperatively aborts between adaptive angle evaluations', () => {
  const project = createProjectInput({ geometry: { moduleCount: 1 }, equipment: { massKg: 25 } })
  const erection = stableErectionInput(project, 40)
  let completedErectionEvaluations = 0
  const signal = {
    get aborted() { return completedErectionEvaluations >= 2 },
    reason: 'stage-test-cancel',
  }

  assert.throws(
    () => calculateProjectStages(project, null, erection, {
      signal,
      onProgress: (progress) => {
        if (progress.phase === 'erection' && progress.label.startsWith('Монтаж: угол')) {
          completedErectionEvaluations += 1
        }
      },
    }),
    (error) => error instanceof MastApplicationError && error.category === 'cancelled',
  )
  assert.equal(completedErectionEvaluations, 2)
})
