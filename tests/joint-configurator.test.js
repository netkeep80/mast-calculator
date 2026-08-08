import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCompleteMast } from '../packages/application/index.js'
import { calculateCompleteMastWithConfiguredJoint } from '../packages/application/index.js'
import {
  buildJointHardwareGeometry,
  clearanceNutOptionsForBolt,
  metricInternalThreadMinorDiameterMm,
  minimumClearanceNutForBolt,
} from '../packages/domain/index.js'
import { configureIntermoduleJoint } from '../packages/engineering/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const baseParameters = resolvedProject({
  jointBoltShearPlanes: 1,
  connectionConditionFactor: 1,
  weldConsumableId: 'electrode-e50a-uoni-13-55',
  weldLegMm: 4,
  weldSegmentsPerEnd: 3,
  barDiameterMm: 12,
})

test('для болта M24 минимальная проходная обычная гайка — M30', () => {
  const options = clearanceNutOptionsForBolt(24)
  const minimum = minimumClearanceNutForBolt(24)
  assert.equal(minimum?.threadDiameterMm, 30)
  assert.ok(minimum.basicMinorDiameterMm > 24)
  assert.ok(minimum.diametralClearanceMm >= 0.5)
  assert.equal(options[0].threadDiameterMm, 30)
  assert.ok(metricInternalThreadMinorDiameterMm(30, 3.5) > 24)
})

test('сборка M24 воспроизводит практическую схему M30 + длинная M24 + болт 80 мм', () => {
  const geometry = buildJointHardwareGeometry({
    boltDiameterMm: 24,
    boltClass: '8.8',
    threadEngagementFactor: 2,
  })
  assert.equal(geometry.bottomClearanceNut.threadDiameterMm, 30)
  assert.equal(geometry.bottomClearanceNut.ribCount, 2)
  assert.equal(geometry.topCouplingNut.threadDiameterMm, 24)
  assert.equal(geometry.topCouplingNut.lengthMm, 72)
  assert.equal(geometry.topCouplingNut.ribCount, 4)
  assert.equal(geometry.threadEngagementMm, 48)
  assert.equal(geometry.engagedThreadTurns, 16)
  assert.equal(geometry.bolt.minimumRequiredLengthMm, 75.6)
  assert.equal(geometry.bolt.lengthMm, 80)
  assert.equal(geometry.effectiveRadiusMm, 18)
  assert.equal(geometry.passes, true)
})

test('слишком короткий вручную выбранный болт блокирует геометрию узла', () => {
  const geometry = buildJointHardwareGeometry({
    boltDiameterMm: 24,
    boltClass: '8.8',
    clearanceNutThreadMm: 30,
    boltLengthMm: 70,
    threadEngagementFactor: 2,
  })
  assert.equal(geometry.boltLengthPasses, false)
  assert.equal(geometry.passes, false)
})

test('без преднатяга автоконфигуратор для 100 кН растяжения сохраняет эталонный минимум M20 класса 8.8', () => {
  const configurator = configureIntermoduleJoint([{
    nodeId: 3,
    level: 1,
    forceGlobalN: [0, 0, -100_000],
    momentGlobalNm: [100, 0, 0],
  }], {
    ...baseParameters,
    jointConfiguratorMode: 'auto',
    jointTighteningTorqueNm: 0,
  }, { baseMetalRunMPa: 490 })

  assert.equal(configurator.mode, 'auto')
  assert.equal(configurator.selected.boltClass, '8.8')
  assert.equal(configurator.selected.diameterMm, 20)
  assert.equal(configurator.geometry.bottomClearanceNut.threadDiameterMm, 24)
  assert.equal(configurator.geometry.topCouplingNut.threadDiameterMm, 20)
  assert.equal(configurator.geometry.topCouplingNut.lengthMm, 60)
  assert.equal(configurator.geometry.bolt.lengthMm, 65)
  assert.equal(configurator.passes, true)
})

test('ручной режим не заменяет выбранные пользователем M24/M30/80', () => {
  const configurator = configureIntermoduleJoint([{
    nodeId: 3,
    level: 1,
    forceGlobalN: [10_000, 0, -20_000],
    momentGlobalNm: [100, 0, 0],
  }], {
    ...baseParameters,
    jointConfiguratorMode: 'manual',
    jointBoltDiameterMm: 24,
    jointBoltClass: '8.8',
    jointClearanceNutThreadMm: 30,
    jointBoltLengthMm: 80,
    jointThreadEngagementFactor: 2,
  }, { baseMetalRunMPa: 490 })

  assert.equal(configurator.mode, 'manual')
  assert.equal(configurator.geometry.bolt.diameterMm, 24)
  assert.equal(configurator.geometry.bolt.lengthMm, 80)
  assert.equal(configurator.geometry.bottomClearanceNut.threadDiameterMm, 30)
  assert.equal(configurator.geometry.topCouplingNut.threadDiameterMm, 24)
  assert.equal(configurator.passes, true)
})

test('полный расчёт фиксирует один автоматически выбранный физический узел для боковой, статической и высотной проверок', { timeout: 30_000 }, () => {
  const input = resolvedProject({
    moduleCount: 2,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
    heightSearchMaxModules: 4,
    jointConfiguratorMode: 'auto',
    jointTighteningTorqueNm: 200,
    jointNutFactor: 0.2,
    jointPreloadVariation: 0.25,
    jointNutSectionAreaRatio: 2,
    weldToRibAreaRatio: 2.5,
  })
  const result = calculateCompleteMastWithConfiguredJoint(input)
  const canonical = calculateCompleteMast(input)
  const geometry = result.connections.configurator.geometry
  const selected = result.connections.configurator.selected

  assert.equal(result.connections.configurator.mode, 'auto')
  assert.equal(result.connections.capacityChecksUseFixedSelectedJoint, true)
  assert.equal(result.parameters.jointBoltDiameterMm, geometry.bolt.diameterMm)
  assert.equal(result.parameters.jointBoltLengthMm, geometry.bolt.lengthMm)
  assert.equal(result.parameters.jointClearanceNutThreadMm, geometry.bottomClearanceNut.threadDiameterMm)
  assert.equal(selected.requestedTighteningTorqueNm, 200)
  assert.equal(result.parameters.jointTighteningTorqueNm, selected.tighteningTorqueNm)
  assert.ok(result.parameters.jointTighteningTorqueNm <= 200)
  assert.equal(result.parameters.jointNutFactor, 0.2)
  assert.equal(result.parameters.jointPreloadVariation, 0.25)
  assert.equal(result.parameters.jointNutSectionAreaRatio, 2)
  assert.equal(result.parameters.weldToRibAreaRatio, 2.5)
  assert.equal(result.connections.nutSections.passes, true)
  assert.ok(result.connections.bolt.selected.governingCheck.preload.maximumPreloadN > 0)
  assert.equal(result.heightCapacity.fixedJointConfiguration.diameterMm, geometry.bolt.diameterMm)
  assert.equal(result.heightCapacity.fixedJointConfiguration.boltLengthMm, geometry.bolt.lengthMm)
  assert.ok(Number.isFinite(result.lateralCapacity.boltLimitForceN))
  assert.ok(Number.isFinite(result.staticPayloadCapacity.boltUtilizationAtLimit))

  assert.equal(canonical.parameters.jointBoltDiameterMm, result.parameters.jointBoltDiameterMm)
  assert.equal(canonical.parameters.jointBoltLengthMm, result.parameters.jointBoltLengthMm)
  assert.equal(canonical.parameters.jointTighteningTorqueNm, result.parameters.jointTighteningTorqueNm)
  assert.equal(canonical.lateralCapacity.criticalForceN, result.lateralCapacity.criticalForceN)
  assert.equal(canonical.heightCapacity.design.maximumModules, result.heightCapacity.design.maximumModules)
})

test('невалидный вручную заданный короткий болт блокирует конструкции, где межмодульный стык действительно существует', { timeout: 30_000 }, () => {
  const result = calculateCompleteMast(resolvedProject({
    moduleCount: 2,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
    heightSearchMaxModules: 3,
    jointConfiguratorMode: 'manual',
    jointBoltDiameterMm: 24,
    jointBoltClass: '8.8',
    jointClearanceNutThreadMm: 30,
    jointBoltLengthMm: 70,
    jointThreadEngagementFactor: 2,
  }))

  assert.equal(result.connections.passesJointGeometry, false)
  assert.equal(result.connections.configurator.geometry.boltLengthPasses, false)
  assert.equal(result.lateralCapacity.boltLimitForceN, 0)
  assert.equal(result.staticPayloadCapacity.maximumTotalTopMassKg, 0)

  assert.equal(result.heightCapacity.design.maximumModules, 1)
  assert.equal(result.heightCapacity.design.firstFailModules, 2)
  assert.equal(result.heightCapacity.ultimateResistance.maximumModules, 1)
  assert.equal(result.heightCapacity.ultimateResistance.firstFailModules, 2)
})
