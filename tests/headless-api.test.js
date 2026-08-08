import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateGuyedProject,
  calculateProject,
  createProjectInput,
  createVerification,
  getJointClearanceNutOptions,
  getJointConfigurationOptions,
  optimizeAndCalculateProject,
  optimizeProject,
  previewJointConfiguration,
  previewProjectConfiguration,
} from '../packages/application/index.js'

const compactInput = createProjectInput({
  geometry: {
    moduleCount: 1,
  },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 250,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  },
  equipment: {
    massKg: 10,
    windAreaM2: 0.2,
  },
  criteria: {
    heightSearchMaxModules: 2,
  },
})

test('public application API calculates a complete immutable project in a plain Node process', () => {
  const result = calculateProject(compactInput)
  assert.equal(result.model.moduleCount, 1)
  assert.equal(result.model.members.length, 9)
  assert.ok(result.lateralCapacity)
  assert.ok(result.staticPayloadCapacity)
  assert.ok(result.heightCapacity)
  assert.ok(result.craneBoomCapacity)
  assert.ok(result.assemblyMass)
  assert.equal(result.verification.counts.internal, result.performance.verificationInternalCheckCount)
  assert.equal(createVerification(result).counts.failed, 0)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.analysis), true)
  assert.equal(Object.isFrozen(result.verification.checks), true)
  assert.throws(() => { result.parameters.moduleCount = 999 }, TypeError)
})

test('public application API exposes optimization and guyed calculation without Web adapters', () => {
  const optimization = optimizeProject(compactInput, { diameters: [12], stopAtFirstPassing: false })
  assert.equal(optimization.evaluatedCount, 1)
  assert.equal(optimization.variants[0].diameter, 12)
  assert.equal(Object.isFrozen(optimization), true)

  const guyed = calculateGuyedProject(compactInput, [])
  assert.equal(guyed.model.moduleCount, 1)
  assert.equal(guyed.cableSystem.cables.length, 0)
  assert.ok(Number.isFinite(guyed.envelope.maxTopDisplacementM))
  assert.equal(Object.isFrozen(guyed), true)
})

test('application owns optimize-then-calculate job semantics used by adapters', () => {
  const progress = []
  const output = optimizeAndCalculateProject(compactInput, {
    diameters: [12],
    onProgress: (event) => progress.push(event),
  })

  assert.equal(output.optimization.evaluatedCount, 1)
  assert.equal(output.optimization.recommendedDiameter, 12)
  assert.equal(output.optimization.variants[0].diameter, 12)
  assert.ok(output.result)
  assert.equal(output.result.parameters.barDiameterMm, 12)
  assert.equal(output.result.parameters.jointConfiguratorMode, 'auto')
  assert.equal(Object.isFrozen(output), true)
  assert.equal(progress.at(-1).phase, 'done')
  assert.equal(progress.at(-1).fraction, 1)
})

test('application owns form-derived fabrication, material and weather preview', () => {
  const preview = previewProjectConfiguration(compactInput)
  const result = calculateProject(compactInput)

  assert.equal(preview.geometry.ribCutLengthMm, result.parameters.ribCutLengthMm)
  assert.equal(preview.geometry.moduleHeightMm, result.parameters.moduleHeightMm)
  assert.equal(preview.geometry.mastHeightM, result.parameters.moduleHeightMm / 1000)
  assert.equal(preview.material.id, result.parameters.reinforcementClass)
  assert.equal(preview.material.standard, result.parameters.reinforcementStandard)
  assert.equal(preview.material.yieldStrengthMPa, result.parameters.yieldStrengthMPa)
  assert.equal(preview.weather.pressurePa, result.parameters.windPressurePa)
  assert.equal(preview.weather.speedMs, result.parameters.windSpeedMs)
  assert.equal(preview.weather.custom, true)
  assert.equal(Object.isFrozen(preview), true)
})

test('application owns joint configuration options and physical preview', () => {
  const options = getJointConfigurationOptions()
  const preview = previewJointConfiguration(compactInput)
  const clearance = getJointClearanceNutOptions(preview.geometry.bolt.diameterMm)

  assert.ok(options.boltLengthsMm.length > 0)
  assert.ok(clearance.some((item) => item.threadDiameterMm === preview.geometry.bottomClearanceNut.threadDiameterMm))
  assert.ok(preview.strength.maximumPreloadN > 0)
  assert.ok(preview.strength.minimumNutSectionRatio > 0)
  assert.equal(Object.isFrozen(preview), true)
})
