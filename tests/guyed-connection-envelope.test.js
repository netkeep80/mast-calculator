import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateProject,
  calculateProjectWithGuys,
  createEngineeringSummary,
} from '../packages/application/index.js'
import {
  DEFAULT_GUY_WIRE_ID,
  createProjectInput,
} from '../packages/domain/index.js'
import {
  calculateConnectionChecks,
  calculateGuyedMast,
} from '../packages/engineering/index.js'
import { analyzeIndependentDenseFrame } from '../packages/structural-analysis/testing.js'

const approximately = (actual, expected, relative = 1e-8, absolute = 1e-8) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`)
}

function failureProject() {
  return createProjectInput({
    geometry: {
      moduleCount: 3,
      barDiameterMm: 12,
    },
    environment: {
      windPresetId: 'custom',
      windPressurePa: 0,
      windDirectionDeg: 0,
      windEnvelopeEnabled: false,
      lateralCapacityStepDeg: 60,
    },
    equipment: {
      massKg: 0,
      windAreaM2: 0,
    },
    connection: {
      configuratorMode: 'manual',
      boltDiameterMm: 16,
      boltClass: '5.6',
      clearanceNutThreadMm: 30,
      boltLengthMm: 80,
      threadEngagementFactor: 2,
      tighteningTorqueNm: 112,
      preloadVariation: 0,
    },
    criteria: {
      displacementLimitMm: 1000,
      minimumBucklingFactor: 1,
      heightSearchMaxModules: 4,
    },
  })
}

function highPretensionGuys(project) {
  const moduleHeightM = project.geometry.stockBarLengthMm / project.geometry.stockBarPieces * Math.sqrt(2 / 3) / 1000
  return {
    safetyFactor: 1,
    terminationEfficiency: 0.8,
    tiers: [{
      heightM: project.geometry.moduleCount * moduleHeightM,
      anchorRadiusM: 6,
      guyCount: 3,
      azimuthOffsetDeg: 0,
      wireId: DEFAULT_GUY_WIRE_ID,
      pretensionN: 10000,
    }],
  }
}

function independentReferenceProject() {
  return createProjectInput({
    geometry: {
      moduleCount: 2,
      barDiameterMm: 16,
    },
    environment: {
      windPresetId: 'custom',
      windPressurePa: 220,
      windDirectionDeg: 20,
      windEnvelopeEnabled: false,
      lateralCapacityStepDeg: 60,
    },
    equipment: {
      massKg: 8,
      windAreaM2: 0.35,
    },
    criteria: {
      displacementLimitMm: 1000,
      minimumBucklingFactor: 1,
      heightSearchMaxModules: 3,
    },
  })
}

function cloneLoadCase(base) {
  return {
    ...base,
    nodalLoads: base.nodalLoads.map((value) => [...value]),
    nodalMoments: base.nodalMoments.map((value) => [...value]),
    memberDistributedLoads: base.memberDistributedLoads.map((value) => [...value]),
    memberLoadDetails: base.memberLoadDetails.map((value) => value == null ? null : { ...value }),
    totalAppliedLoad: [...base.totalAppliedLoad],
    distributedResultant: [...base.distributedResultant],
    nodalResultant: [...base.nodalResultant],
  }
}

function addCableForcesToReferenceLoad(loadCase, cables) {
  const cableResultant = [0, 0, 0]
  for (const cable of cables) {
    const target = loadCase.nodalLoads[cable.attachmentNodeId]
    assert.ok(target, `missing reference node ${cable.attachmentNodeId}`)
    for (let axis = 0; axis < 3; axis += 1) {
      target[axis] += cable.forceOnMastN[axis]
      cableResultant[axis] += cable.forceOnMastN[axis]
    }
  }
  for (let axis = 0; axis < 3; axis += 1) {
    loadCase.nodalResultant[axis] += cableResultant[axis]
    loadCase.totalAppliedLoad[axis] += cableResultant[axis]
  }
  return loadCase
}

test('issue #88: guyed member/cable envelope can pass while the same fixed physical connection fails', () => {
  const project = failureProject()
  const { result, guyedResult } = calculateProjectWithGuys(project, highPretensionGuys(project))
  assert.ok(guyedResult)

  const observed = {
    bareConnectionPasses: result.connections.passes,
    bareBoltUtilization: result.connections.bolt.selected.utilization,
    structuralAndCablePasses: guyedResult.structuralAndCablePasses,
    guyedConnectionPasses: guyedResult.connectionEnvelope.passes,
    guyedBoltUtilization: guyedResult.connectionEnvelope.maximumBoltUtilization,
    memberUtilization: guyedResult.envelope.maxUtilization,
    cableUtilization: guyedResult.envelope.maximumCableUtilization,
    minimumBucklingFactor: guyedResult.envelope.minimumBucklingFactor,
    maximumTopDisplacementM: guyedResult.envelope.maxTopDisplacementM,
  }
  const diagnostic = JSON.stringify(observed)

  assert.equal(result.connections.passes, true, `bare connection must pass: ${diagnostic}`)
  assert.equal(guyedResult.structuralAndCablePasses, true, `members/cables must pass: ${diagnostic}`)
  assert.equal(guyedResult.connectionEnvelope.passes, false, `fixed guyed connection must fail: ${diagnostic}`)
  assert.ok(guyedResult.connectionEnvelope.maximumBoltUtilization > 1, `bolt must govern this fixture: ${diagnostic}`)
  assert.equal(guyedResult.connectionEnvelope.statusReason, 'configured-bolt-capacity')
  assert.deepEqual(guyedResult.connectionEnvelope.failureReasons, ['configured-bolt-capacity'])
  assert.equal(guyedResult.connectionEnvelope.selectedJoint.tighteningTorqueNm, 112)
  assert.equal(guyedResult.connectionEnvelope.selectedJoint.preloadVariation, 0)
  assert.equal(guyedResult.passes, false)

  const summary = createEngineeringSummary(result, guyedResult)
  const criterion = summary.criteria.find((item) => item.id === 'guyed-connection-envelope')
  assert.equal(criterion?.status, 'fail')
  assert.equal(summary.overallStatus, 'fail')
  assert.equal(summary.governingCriterionId, 'guyed-connection-envelope')
})

test('issue #88: zero-guy connection demand reproduces the bare fixed-joint demand', () => {
  const result = calculateProject(failureProject())
  const zeroGuy = calculateGuyedMast(result.parameters, [])
  const fixed = {
    ...result.parameters,
    jointConfiguratorMode: 'manual',
  }
  const recovered = calculateConnectionChecks({
    parameters: fixed,
    model: zeroGuy.model,
    cases: zeroGuy.cases,
  })

  assert.equal(recovered.passes, result.connections.passes)
  approximately(recovered.bolt.selected.utilization, result.connections.bolt.selected.utilization, 2e-9, 1e-10)
  assert.equal(recovered.jointDemands.length, result.connections.jointDemands.length)
  for (let index = 0; index < recovered.jointDemands.length; index += 1) {
    const left = recovered.jointDemands[index]
    const right = result.connections.jointDemands[index]
    assert.equal(left.level, right.level)
    assert.equal(left.nodeId, right.nodeId)
    approximately(left.tensionN, right.tensionN, 2e-9, 1e-7)
    approximately(left.shearN, right.shearN, 2e-9, 1e-7)
    approximately(left.bendingMomentNm, right.bendingMomentNm, 2e-9, 1e-8)
    approximately(left.torsionNm, right.torsionNm, 2e-9, 1e-8)
  }
})

test('issue #88: independent dense solver recovers the same guyed member-end N/V/T/M actions', () => {
  const result = calculateProject(independentReferenceProject())
  const topHeightM = result.parameters.moduleCount * result.parameters.moduleHeightMm / 1000
  const guyed = calculateGuyedMast(result.parameters, [{
    heightM: topHeightM,
    anchorRadiusM: 5,
    guyCount: 3,
    azimuthOffsetDeg: 10,
    wireId: DEFAULT_GUY_WIRE_ID,
    pretensionN: 650,
  }], { maximumIterations: 40 })
  const loadCase = guyed.cases[0]
  assert.ok(loadCase.nonlinear.converged)

  const referenceLoads = addCableForcesToReferenceLoad(cloneLoadCase(loadCase.baseLoads), loadCase.cables)
  const independent = analyzeIndependentDenseFrame(
    guyed.model,
    referenceLoads,
    loadCase.parameters,
    null,
    { includeBuckling: false },
  )

  let maximumDifference = 0
  let forceScale = 1
  for (const member of guyed.model.members) {
    const production = loadCase.analysis.memberResults[member.id].localEndForces
    const reference = independent.memberLocalEndForces[member.id]
    assert.equal(production.length, reference.length)
    for (let index = 0; index < production.length; index += 1) {
      maximumDifference = Math.max(maximumDifference, Math.abs(production[index] - reference[index]))
      forceScale = Math.max(forceScale, Math.abs(production[index]), Math.abs(reference[index]))
    }
  }
  const relativeDifference = maximumDifference / forceScale
  assert.ok(
    relativeDifference < 2e-5,
    `independent guyed end-force recovery differs by ${relativeDifference}; production residual=${loadCase.analysis.diagnostics.maximumGuyCorrectedFreeResidualN}`,
  )
  assert.ok(independent.diagnostics.relativeResidual < 1e-9)
})
