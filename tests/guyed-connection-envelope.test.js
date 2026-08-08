import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateProjectWithGuys,
  createEngineeringSummary,
} from '../packages/application/index.js'
import {
  DEFAULT_GUY_WIRE_ID,
  createProjectInput,
} from '../packages/domain/index.js'

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
      tighteningTorqueNm: 110,
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
      pretensionN: 13000,
    }],
  }
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
  assert.equal(guyedResult.passes, false)

  const summary = createEngineeringSummary(result, guyedResult)
  const criterion = summary.criteria.find((item) => item.id === 'guyed-connection-envelope')
  assert.equal(criterion?.status, 'fail')
  assert.equal(summary.overallStatus, 'fail')
  assert.equal(summary.governingCriterionId, 'guyed-connection-envelope')
})
