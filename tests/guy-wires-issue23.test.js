import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMast,
  calculateProjectStages,
  createEngineeringSummary,
} from '../packages/application/index.js'
import { generateMastModel } from '../packages/structural-analysis/index.js'
import {
  DEFAULT_GUY_WIRE_ID,
  calculateGuyWireCapacity,
  createProjectInput,
  getGuyWireSpec,
} from '../packages/domain/index.js'
import {
  buildGuyWireSystem,
  calculateGuyedMast,
  guyWindDirections,
} from '../packages/engineering/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const approximately = (actual, expected, relative = 1e-8, absolute = 1e-8) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`)
}

function parameters(overrides = {}) {
  return resolvedProject({
    moduleCount: 12,
    windPresetId: 'custom',
    windPressurePa: 0,
    windEnvelopeEnabled: false,
    windDirectionDeg: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    iceThicknessMm: 0,
    ...overrides,
  })
}

function compactProject(overrides = {}) {
  const project = createProjectInput({
    geometry: {
      moduleCount: 4,
      barDiameterMm: 16,
    },
    environment: {
      windPresetId: 'custom',
      windPressurePa: 280,
      windDirectionDeg: 0,
      windEnvelopeEnabled: false,
      lateralCapacityStepDeg: 60,
    },
    equipment: {
      massKg: 10,
      windAreaM2: 0.5,
    },
    criteria: {
      displacementLimitMm: 500,
      minimumBucklingFactor: 1,
      heightSearchMaxModules: 5,
    },
  })
  return {
    ...project,
    ...overrides,
  }
}

function compactGuys(project) {
  const moduleHeightM = project.geometry.stockBarLengthMm / project.geometry.stockBarPieces * Math.sqrt(2 / 3) / 1000
  return {
    tiers: [{
      heightM: project.geometry.moduleCount * moduleHeightM,
      anchorRadiusM: 6,
      guyCount: 3,
      azimuthOffsetDeg: 0,
      wireId: DEFAULT_GUY_WIRE_ID,
      pretensionN: 700,
    }],
  }
}

test('issue #23: galvanized 6x19 catalog uses EN 12385-4 class factors', () => {
  const rope = getGuyWireSpec('galv-6x19-iwrc-6')
  approximately(rope.metallicAreaMm2, 0.449 * 36, 0, 1e-3)
  approximately(rope.massKgM, 0.400 * 36 / 100, 0, 1e-4)
  approximately(rope.minimumBreakingLoadKn, 0.356 * 36 * 1770 / 1000, 0, 0.01)
  const capacity = calculateGuyWireCapacity(rope, { terminationEfficiency: 0.8, safetyFactor: 3 })
  approximately(capacity.designWorkingLoadN, rope.minimumBreakingLoadKn * 1000 * 0.8 / 3, 1e-12)
})

test('issue #23: tier height maps to a real module interface', () => {
  const p = parameters({ moduleCount: 10 })
  const model = generateMastModel(p)
  const requestedHeightM = 3.14
  const system = buildGuyWireSystem(model, p, [{
    heightM: requestedHeightM,
    anchorRadiusM: 6,
    guyCount: 3,
    wireId: DEFAULT_GUY_WIRE_ID,
    pretensionN: 1200,
  }])
  const tier = system.tiers[0]
  assert.ok(tier.level >= 1 && tier.level <= p.moduleCount)
  approximately(tier.actualHeightM, tier.level * p.moduleHeightMm / 1000, 1e-12)
  approximately(tier.heightSnapM, tier.actualHeightM - requestedHeightM, 1e-12)
  assert.equal(system.cables.length, 3)
  assert.equal(new Set(system.cables.map((cable) => cable.attachmentNodeId)).size, 3)
})

test('issue #23: 3..6 guys are balanced over three attachment nodes', () => {
  const p = parameters({ moduleCount: 9 })
  const model = generateMastModel(p)
  for (const guyCount of [3, 4, 5, 6]) {
    const system = buildGuyWireSystem(model, p, [{
      heightM: 5 * p.moduleHeightMm / 1000,
      anchorRadiusM: 7,
      guyCount,
      azimuthOffsetDeg: 0,
      pretensionN: 800,
    }])
    const counts = new Map()
    for (const cable of system.cables) counts.set(cable.attachmentNodeId, (counts.get(cable.attachmentNodeId) ?? 0) + 1)
    assert.equal(counts.size, 3)
    const distribution = [...counts.values()].sort((left, right) => left - right)
    assert.ok(distribution.at(-1) - distribution[0] <= 1)
  }
})

test('issue #23: guyed wind envelope evaluates the complete circle', () => {
  const p = parameters({ windEnvelopeEnabled: true, windEnvelopeStepDeg: 30 })
  assert.deepEqual(guyWindDirections(p), [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])
})

test('issue #23: empty guy system reproduces the existing frame calculation', () => {
  const p = parameters({
    moduleCount: 6,
    windPressurePa: 300,
    equipmentWindAreaM2: 0.4,
    equipmentMassKg: 20,
    windDirectionDeg: 17,
  })
  const reference = calculateMast(p)
  const guyed = calculateGuyedMast(p, [])
  approximately(guyed.envelope.maxUtilization, reference.envelope.maxUtilization, 2e-10, 1e-10)
  approximately(guyed.envelope.maxTopDisplacementM, reference.envelope.maxTopDisplacementM, 2e-10, 1e-12)
  approximately(guyed.envelope.minimumBucklingFactor, reference.envelope.minimumBucklingFactor, 2e-9, 1e-8)
})

test('issue #23: three guys reduce wind displacement and redistribute tension', () => {
  const p = parameters({
    moduleCount: 12,
    windPressurePa: 380,
    equipmentWindAreaM2: 2,
    windDirectionDeg: 0,
    displacementLimitMm: 1000,
  })
  const bare = calculateGuyedMast(p, [])
  const guyed = calculateGuyedMast(p, [{
    heightM: p.moduleCount * p.moduleHeightMm / 1000,
    anchorRadiusM: 8,
    guyCount: 3,
    azimuthOffsetDeg: 0,
    wireId: 'galv-6x19-iwrc-6',
    pretensionN: 1200,
  }])
  assert.ok(guyed.cases[0].nonlinear.converged)
  assert.ok(guyed.envelope.maxTopDisplacementM < bare.envelope.maxTopDisplacementM)
  const tensions = guyed.cases[0].cables.map((cable) => cable.tensionN)
  assert.ok(Math.max(...tensions) - Math.min(...tensions) > 1)
  assert.ok(guyed.cases[0].cables.every((cable) => Number.isFinite(cable.angleToHorizontalDeg)))
  assert.ok(guyed.cases[0].cables.every((cable) => cable.moduleNodeReactionN.length === 3))
})

test('issue #23: strongly asymmetric wind can fully unload a low-pretension cable', () => {
  const p = parameters({
    moduleCount: 10,
    windPressurePa: 1500,
    equipmentWindAreaM2: 2.5,
    windDirectionDeg: 0,
    displacementLimitMm: 10000,
    barDiameterMm: 20,
  })
  const guyed = calculateGuyedMast(p, [{
    heightM: p.moduleCount * p.moduleHeightMm / 1000,
    anchorRadiusM: 6,
    guyCount: 3,
    azimuthOffsetDeg: 0,
    wireId: 'galv-6x19-iwrc-4',
    pretensionN: 50,
  }], { maximumIterations: 40 })
  assert.ok(guyed.cases[0].nonlinear.converged)
  assert.ok(guyed.cases[0].cables.some((cable) => cable.tensionN === 0))
  assert.ok(guyed.cases[0].cables.every((cable) => cable.tensionN >= 0))
})

test('issue #88: canonical guyed job reuses one selected physical joint for the whole nonlinear envelope', () => {
  const project = compactProject()
  const { result, guyedResult } = calculateProjectStages(project, compactGuys(project), null)
  assert.ok(guyedResult)
  assert.equal(guyedResult.connectionEnvelope.method, 'fixed-selected-joint-guyed-connection-envelope-v1')
  assert.equal(guyedResult.connectionEnvelope.physicalJointSource, 'bare-project-selected')
  assert.equal(guyedResult.connectionEnvelope.checkMode, 'manual')
  assert.equal(guyedResult.connections.configurator.mode, 'manual')
  assert.equal(guyedResult.connections.requestedMode, result.parameters.jointConfiguratorMode)
  assert.equal(guyedResult.connectionEnvelope.selectedJoint.boltDiameterMm, result.parameters.jointBoltDiameterMm)
  assert.equal(guyedResult.connectionEnvelope.selectedJoint.boltClass, result.parameters.jointBoltClass)
  assert.equal(guyedResult.connectionEnvelope.selectedJoint.boltLengthMm, result.parameters.jointBoltLengthMm)
  assert.equal(guyedResult.connectionEnvelope.selectedJoint.clearanceNutThreadMm, result.parameters.jointClearanceNutThreadMm)
  assert.equal(guyedResult.connectionEnvelope.selectedJoint.weldConsumableId, result.parameters.weldConsumableId)
  assert.equal(guyedResult.connectionEnvelope.caseCount, guyedResult.cases.length)
  assert.equal(guyedResult.passes, guyedResult.structuralAndCablePasses && guyedResult.connectionEnvelope.passes)
  assert.ok(guyedResult.connections.jointDemands.every((demand) => Number.isFinite(demand.windDirectionDeg)))
  if (guyedResult.connectionEnvelope.criticalWeld) {
    assert.ok(Number.isFinite(guyedResult.connectionEnvelope.criticalWeld.windDirectionDeg))
  }
})

test('issue #88: engineering summary resolves guyed connection only for the canonical composite result', () => {
  const project = compactProject()
  const { result, guyedResult } = calculateProjectStages(project, compactGuys(project), null)
  assert.ok(guyedResult)
  const compositeSummary = createEngineeringSummary(result, guyedResult)
  const compositeCriterion = compositeSummary.criteria.find((item) => item.id === 'guyed-connection-envelope')
  assert.ok(compositeCriterion)
  assert.equal(compositeCriterion.status, guyedResult.connectionEnvelope.passes ? 'pass' : 'fail')
  assert.equal(compositeCriterion.value, guyedResult.connectionEnvelope.maximumBoltUtilization)
  assert.ok(!compositeSummary.pendingCriterionIds.includes('guyed-connection-envelope'))

  const lowLevelGuyed = calculateGuyedMast(result.parameters, compactGuys(project).tiers)
  const lowLevelSummary = createEngineeringSummary(result, lowLevelGuyed)
  const lowLevelCriterion = lowLevelSummary.criteria.find((item) => item.id === 'guyed-connection-envelope')
  assert.equal(lowLevelCriterion?.status, 'not-verified')
  assert.ok(lowLevelSummary.pendingCriterionIds.includes('guyed-connection-envelope'))
})