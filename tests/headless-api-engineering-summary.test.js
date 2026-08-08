import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ENGINEERING_SUMMARY_SCHEMA,
  calculateGuyedProject,
  calculateProject,
  createBareResultSummary,
  createEngineeringSummary,
  createProjectInput,
  createProjectPackage,
} from '../packages/application/index.js'

const input = createProjectInput({
  geometry: { moduleCount: 2 },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 80,
    windEnvelopeEnabled: false,
    windDirectionDeg: 15,
    lateralCapacityStepDeg: 60,
  },
  equipment: { massKg: 2, windAreaM2: 0.05 },
  criteria: { heightSearchMaxModules: 3, displacementLimitMm: 100 },
})

const guys = Object.freeze({
  tiers: Object.freeze([Object.freeze({
    id: 'summary-tier',
    heightM: 0.8,
    anchorRadiusM: 5,
    guyCount: 3,
    pretensionN: 700,
    wireId: 'galv-6x19-iwrc-6',
  })]),
  safetyFactor: 3,
  terminationEfficiency: 0.8,
})

const bare = calculateProject(input)
const guyed = calculateGuyedProject(input, guys.tiers, {
  safetyFactor: guys.safetyFactor,
  terminationEfficiency: guys.terminationEfficiency,
})

const criterion = (summary, id) => summary.criteria.find((item) => item.id === id)

test('bare engineering summary is the single PASS/FAIL projection for current normal criteria', () => {
  const summary = createEngineeringSummary(bare)
  assert.equal(summary.schema, ENGINEERING_SUMMARY_SCHEMA)
  assert.equal(summary.mode, 'bare')
  assert.equal(summary.overallStatus, 'pass')
  assert.deepEqual(summary.pendingCriterionIds, [])
  assert.equal(criterion(summary, 'bare-member-utilization').status, 'pass')
  assert.equal(criterion(summary, 'bare-global-buckling').status, 'pass')
  assert.equal(criterion(summary, 'bare-top-displacement').status, 'pass')
  assert.equal(criterion(summary, 'bare-connection').status, 'pass')
  assert.equal(criterion(summary, 'internal-verification').status, 'pass')
})

test('known normal connection failure remains a hard veto for a guyed project', () => {
  const failedConnection = {
    ...bare,
    connections: { ...bare.connections, passes: false },
  }
  const summary = createEngineeringSummary(failedConnection, guyed)
  assert.equal(summary.mode, 'guyed')
  assert.equal(summary.overallStatus, 'fail')
  assert.equal(criterion(summary, 'bare-connection').required, true)
  assert.equal(criterion(summary, 'bare-connection').status, 'fail')
})

test('passing guy envelope cannot claim project PASS until guyed connection envelope is verified', () => {
  assert.equal(guyed.passes, true, 'fixture must pass the implemented nonlinear guy criteria')
  const summary = createEngineeringSummary(bare, guyed)
  assert.equal(summary.mode, 'guyed')
  assert.equal(summary.overallStatus, 'incomplete')
  assert.deepEqual(summary.pendingCriterionIds, ['guyed-connection-envelope'])
  assert.equal(criterion(summary, 'guyed-connection-envelope').status, 'not-verified')
  assert.equal(criterion(summary, 'guyed-connection-envelope').required, true)
  assert.equal(summary.capacities.guyedCapacitiesAvailable, false)
})

test('a failed implemented guy criterion dominates pending checks and produces overall FAIL', () => {
  const failedGuyed = {
    ...guyed,
    envelope: { ...guyed.envelope, maximumCableUtilization: 1.25 },
  }
  const summary = createEngineeringSummary(bare, failedGuyed)
  assert.equal(summary.overallStatus, 'fail')
  assert.equal(criterion(summary, 'guy-cable-utilization').status, 'fail')
  assert.equal(summary.governingCriterionId, 'guy-cable-utilization')
  assert.ok(summary.pendingCriterionIds.includes('guyed-connection-envelope'))
})

test('bare special capacities remain explicitly bare when a guyed envelope is present', () => {
  const summary = createEngineeringSummary(bare, guyed)
  assert.equal(summary.capacities.lateralCriticalForceKgf, bare.lateralCapacity.criticalForceKgf)
  assert.equal(summary.capacities.staticMaximumTopMassKg, bare.staticPayloadCapacity.maximumTopEquipmentMassKg)
  assert.equal(summary.capacities.heightDesignMaximumM, bare.heightCapacity.design.maximumHeightM)
  assert.equal(summary.capacities.craneMaximumEndPayloadMassKg, bare.craneBoomCapacity.maximumEndPayloadMassKg)
  assert.equal(summary.capacities.guyedCapacitiesAvailable, false)
})

test('result-summary/v1 keeps its historical four-criterion passes meaning', () => {
  const expectedLegacyPasses = bare.envelope.maxUtilization <= 1
    && bare.envelope.minimumBucklingFactor >= bare.parameters.minimumBucklingFactor
    && bare.envelope.maxTopDisplacementM * 1000 <= bare.parameters.displacementLimitMm
    && bare.connections?.passes !== false
  const machine = createBareResultSummary(createProjectPackage(input), bare, {
    provenance: {
      toolVersion: 'test',
      coreVersion: 'test',
      command: 'calculate',
    },
  })
  assert.equal(machine.result.passes, expectedLegacyPasses)
})
