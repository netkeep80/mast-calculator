import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOLT_SIZES,
} from '../site/engine/connection-catalog.js'
import {
  clearanceNutOptionsForBolt,
  minimumClearanceNutForBolt,
} from '../site/engine/joint-hardware-catalog.js'
import {
  AUTO_MAX_PRELOAD_UTILIZATION,
  configureIntermoduleJoint,
} from '../site/engine/joint-configurator.js'
import {
  METRIC_COARSE_THREADS,
  getMetricCoarseThread,
} from '../site/engine/metric-thread-catalog.js'
import { calculateMinimumWeldLength } from '../site/engine/weld-check.js'
import { calculateWeldServiceDegradation } from '../site/engine/weld-service-degradation.js'
import { calculateEquivalentMemberWeldZoneStiffness } from '../site/engine/weld-zone-stiffness.js'
import {
  DEFAULT_PARAMETERS,
  resolveCalculationParameters,
} from '../site/engine/calculate.js'
import { generateMastModel } from '../site/engine/geometry.js'

const baseJointParameters = {
  ...DEFAULT_PARAMETERS,
  barDiameterMm: 12,
  jointBoltShearPlanes: 1,
  connectionConditionFactor: 1,
  jointBaseMetalTensileStrengthMPa: 490,
  jointNutSectionAreaRatio: 2,
  weldToRibAreaRatio: 2.5,
  jointNutFactor: 0.2,
  jointPreloadVariation: 0.25,
}

const smallDemand = [{
  nodeId: 3,
  level: 1,
  forceGlobalN: [0, 0, -10_000],
  momentGlobalNm: [0, 0, 0],
}]

test('issue #19: каталог содержит полный выбранный коммерческий coarse-thread ряд ISO 262:2023 M1…M100', () => {
  const expected = [
    1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12,
    14, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 42, 45, 48, 52, 56, 60,
    64, 68, 72, 76, 80, 85, 90, 95, 100,
  ]
  assert.deepEqual(METRIC_COARSE_THREADS.map((item) => item.diameterMm), expected)
  assert.equal(getMetricCoarseThread(18).pitchMm, 2.5)
  assert.equal(getMetricCoarseThread(27).pitchMm, 3)
  assert.equal(getMetricCoarseThread(52).pitchMm, 5)
  assert.equal(getMetricCoarseThread(68).pitchMm, 6)
  assert.equal(getMetricCoarseThread(100).pitchMm, 6)
})

test('issue #19: промежуточные M18/M22/M27 возвращены в расчётный ряд болтов', () => {
  const diameters = BOLT_SIZES.map((item) => item.diameterMm)
  assert.deepEqual(diameters, [16, 18, 20, 22, 24, 27, 30, 36, 42, 48])
  assert.ok(BOLT_SIZES.find((item) => item.diameterMm === 18)?.scopeNote)
  assert.ok(BOLT_SIZES.find((item) => item.diameterMm === 22)?.scopeNote)
  assert.ok(BOLT_SIZES.find((item) => item.diameterMm === 27)?.scopeNote)
})

test('issue #19: проходная гайка выбирается по фактическому minor diameter из полного ряда', () => {
  assert.equal(minimumClearanceNutForBolt(18)?.threadDiameterMm, 22)
  assert.equal(minimumClearanceNutForBolt(22)?.threadDiameterMm, 27)
  assert.equal(minimumClearanceNutForBolt(27)?.threadDiameterMm, 33)
  assert.ok(clearanceNutOptionsForBolt(22)[0].diametralClearanceMm >= 0.5)
})

test('issue #19: auto не отбрасывает M16 только из-за универсальных 200 Нм', () => {
  const automatic = configureIntermoduleJoint(smallDemand, {
    ...baseJointParameters,
    jointConfiguratorMode: 'auto',
    jointTighteningTorqueNm: 200,
  }, { baseMetalRunMPa: 490 })

  assert.equal(automatic.selected.boltClass, '8.8')
  assert.equal(automatic.selected.diameterMm, 16)
  assert.equal(automatic.selected.requestedTighteningTorqueNm, 200)
  assert.ok(automatic.selected.tighteningTorqueNm < 200)
  assert.equal(automatic.selected.torqueWasLimited, true)
  assert.ok(automatic.selected.evaluation.governingCheck.preloadUtilization <= AUTO_MAX_PRELOAD_UTILIZATION + 1e-12)
  assert.equal(automatic.passes, true)
})

test('issue #19: manual сохраняет 200 Нм и честно показывает перегрузку M16', () => {
  const manual = configureIntermoduleJoint(smallDemand, {
    ...baseJointParameters,
    jointConfiguratorMode: 'manual',
    jointBoltDiameterMm: 16,
    jointBoltClass: '8.8',
    jointClearanceNutThreadMm: 20,
    jointBoltLengthMm: 55,
    jointThreadEngagementFactor: 2,
    jointTighteningTorqueNm: 200,
  }, { baseMetalRunMPa: 490 })

  assert.equal(manual.selected.tighteningTorqueNm, 200)
  assert.equal(manual.selected.torqueWasLimited, false)
  assert.equal(manual.passesGeometry, true)
  assert.ok(manual.selected.evaluation.governingCheck.preloadUtilization > 1)
  assert.equal(manual.passesBolt, false)
})

test('issue #19: service reserve монотонно уменьшает эффективное горло и увеличивает требуемую длину шва', () => {
  const common = {
    consumableId: 'electrode-e50a-uoni-13-55',
    weldLegMm: 4,
    segmentCount: 3,
    betaF: 0.7,
    betaZ: 1,
    connectionConditionFactor: 1,
    baseMetalRunMPa: 490,
    weldGroupRadiusMm: 6,
    memberAreaMm2: Math.PI * 12 ** 2 / 4,
    minimumAreaRatio: 2.5,
  }
  const fresh = calculateMinimumWeldLength({ axialForceN: 20_000 }, {
    ...common,
    serviceYears: 0,
    initialStiffnessRetention: 1,
    annualStiffnessLossRate: 0,
    minimumStiffnessRetention: 0.5,
  })
  const aged = calculateMinimumWeldLength({ axialForceN: 20_000 }, {
    ...common,
    serviceYears: 50,
    initialStiffnessRetention: 0.97,
    annualStiffnessLossRate: 0.0015,
    minimumStiffnessRetention: 0.85,
  })

  assert.equal(fresh.serviceDegradation.stiffnessRetentionFactor, 1)
  assert.ok(aged.serviceDegradation.stiffnessRetentionFactor < 1)
  assert.ok(aged.serviceAdjustedEffectiveThroatMm < fresh.serviceAdjustedEffectiveThroatMm)
  assert.ok(aged.requiredPhysicalLengthMm > fresh.requiredPhysicalLengthMm)
})

test('issue #19: две околошовные зоны дают эквивалентную податливость всего FEM-ребра', () => {
  const fresh = calculateEquivalentMemberWeldZoneStiffness({
    memberLengthM: 0.75,
    memberDiameterMm: 12,
    serviceYears: 0,
    initialStiffnessRetention: 1,
    annualStiffnessLossRate: 0,
    minimumStiffnessRetention: 0.5,
  })
  const aged = calculateEquivalentMemberWeldZoneStiffness({
    memberLengthM: 0.75,
    memberDiameterMm: 12,
    serviceYears: 50,
    initialStiffnessRetention: 0.97,
    annualStiffnessLossRate: 0.0015,
    minimumStiffnessRetention: 0.85,
  })

  assert.equal(fresh.equivalentStiffnessRetentionFactor, 1)
  assert.ok(aged.zoneLengthMm >= 4 * 12)
  assert.ok(aged.equivalentStiffnessRetentionFactor < 1)
  assert.ok(aged.equivalentStiffnessRetentionFactor > aged.zoneStiffnessRetentionFactor)
})

test('issue #19: возраст сварных зон реально уменьшает E, используемый frame/FEM, но сохраняет номинальный E отдельно', () => {
  const freshParameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    weldServiceYears: 0,
    weldInitialStiffnessRetention: 1,
    weldAnnualStiffnessLossRate: 0,
    weldMinimumStiffnessRetention: 0.5,
  })
  const agedParameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    weldServiceYears: 50,
    weldInitialStiffnessRetention: 0.97,
    weldAnnualStiffnessLossRate: 0.0015,
    weldMinimumStiffnessRetention: 0.85,
  })
  const fresh = generateMastModel(freshParameters)
  const aged = generateMastModel(agedParameters)

  assert.equal(fresh.members[0].youngModulusPa, fresh.members[0].nominalYoungModulusPa)
  assert.equal(aged.members[0].nominalYoungModulusPa, fresh.members[0].nominalYoungModulusPa)
  assert.ok(aged.members[0].youngModulusPa < aged.members[0].nominalYoungModulusPa)
  assert.ok(aged.stiffnessModel.representativeRetentionFactor < 1)
})

test('issue #19: service reserve имеет явный нижний предел и не стремится к нулю', () => {
  const degradation = calculateWeldServiceDegradation({
    serviceYears: 1000,
    initialStiffnessRetention: 0.97,
    annualStiffnessLossRate: 0.01,
    minimumStiffnessRetention: 0.85,
  })
  assert.equal(degradation.stiffnessRetentionFactor, 0.85)
  assert.ok(degradation.sourceStatus.includes('не нормативный'))
})
