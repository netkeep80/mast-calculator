import assert from 'node:assert/strict'
import test from 'node:test'
import {
  choleskyDecomposition,
  getBandValue,
  invertLowerTriangular,
  largestEigenpairSymmetric,
  matrixMultiply,
  transpose,
} from '../packages/numerics/index.js'
import {
  assembleModalMass,
  calculateNaturalModes,
  compileFrameSystem,
  generateMastModel,
} from '../packages/structural-analysis/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

function bandToDense(matrix) {
  return Array.from({ length: matrix.size }, (_, row) => (
    Array.from({ length: matrix.size }, (_, column) => getBandValue(matrix, row, column))
  ))
}

function firstDenseGeneralizedMu(stiffnessBand, massBand) {
  const stiffness = bandToDense(stiffnessBand)
  const mass = bandToDense(massBand)
  const lower = choleskyDecomposition(stiffness)
  const inverseLower = invertLowerTriangular(lower)
  const transformed = matrixMultiply(
    matrixMultiply(inverseLower, mass),
    transpose(inverseLower),
  )
  return largestEigenpairSymmetric(transformed, { tolerance: 1e-11 }).eigenvalue
}

test('modal mass uses physical steel/ice/equipment mass without reliability factors', () => {
  const base = resolvedProject({
    moduleCount: 2,
    equipmentMassKg: 123,
    iceThicknessMm: 6,
    deadLoadFactor: 1,
    equipmentLoadFactor: 1,
  })
  const factored = resolvedProject({
    moduleCount: 2,
    equipmentMassKg: 123,
    iceThicknessMm: 6,
    deadLoadFactor: 2.5,
    equipmentLoadFactor: 2.7,
  })
  const baseModel = generateMastModel(base)
  const baseAssembly = assembleModalMass(baseModel, base)
  const baseMass = baseAssembly.model
  const baseSystem = compileFrameSystem(baseModel, base)
  const factoredMass = assembleModalMass(generateMastModel(factored), factored).model

  assert.equal(baseMass.id, 'frame-lumped-translational-v1')
  assert.equal(baseMass.reliabilityFactorsApplied, false)
  assert.equal(baseMass.rotationalInertiaIncluded, false)
  assert.equal(baseMass.connectionHardwareMassIncluded, false)
  assert.equal(baseMass.physicalMassKg.equipmentKg, 123)
  assert.ok(baseMass.physicalMassKg.steelKg > 0)
  assert.ok(baseMass.physicalMassKg.iceKg > 0)
  assert.ok(Math.abs(baseMass.physicalMassKg.steelKg - baseSystem.totalMassKg) < 1e-10)
  assert.ok(Math.abs(
    baseMass.physicalMassKg.totalKg
      - baseMass.physicalMassKg.steelKg
      - baseMass.physicalMassKg.iceKg
      - baseMass.physicalMassKg.equipmentKg,
  ) < 1e-10)
  for (const activeMassKg of baseMass.activeTranslationalMassKg) {
    assert.ok(activeMassKg > 0)
    assert.ok(activeMassKg <= baseMass.physicalMassKg.totalKg)
  }
  assert.deepEqual(factoredMass.physicalMassKg, baseMass.physicalMassKg)
  assert.deepEqual(factoredMass.activeTranslationalMassKg, baseMass.activeTranslationalMassKg)
})

test('first mast natural frequency matches an independent dense generalized eigen reference', () => {
  const parameters = resolvedProject({ moduleCount: 1, equipmentMassKg: 40 })
  const model = generateMastModel(parameters)
  const system = compileFrameSystem(model, parameters)
  const mass = assembleModalMass(model, parameters)
  const denseMu = firstDenseGeneralizedMu(system.reducedStiffness, mass.matrix)
  const modal = calculateNaturalModes(model, parameters, {
    modeCount: 3,
    tolerance: 1e-8,
    maxIterations: 100,
  })

  assert.ok(denseMu > 0)
  assert.ok(modal.modes.length >= 3)
  assert.ok(Math.abs(1 / modal.modes[0].omegaSquared - denseMu) / denseMu < 1e-6)
  assert.ok(modal.modes[0].dynamicEquationResidual < 1e-6)
  assert.ok(modal.modes[0].generalizedEigenResidual < 1e-6)
})

test('natural modes are finite, positive, ordered and mass-normalized for a production mast', () => {
  const parameters = resolvedProject({ moduleCount: 4, equipmentMassKg: 25 })
  const result = calculateNaturalModes(generateMastModel(parameters), parameters, { modeCount: 6 })

  assert.equal(result.massModel.id, 'frame-lumped-translational-v1')
  assert.equal(result.modes.length, 6)
  for (let index = 0; index < result.modes.length; index += 1) {
    const mode = result.modes[index]
    assert.ok(Number.isFinite(mode.frequencyHz) && mode.frequencyHz > 0)
    assert.ok(Number.isFinite(mode.angularFrequencyRadS) && mode.angularFrequencyRadS > 0)
    assert.ok(mode.dynamicEquationResidual < 1e-5)
    assert.equal(mode.normalization, 'mass-normalized')
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(mode.participation[axis].effectiveMassKg >= 0)
      assert.ok(mode.participation[axis].activeMassRatio >= 0)
      assert.ok(mode.participation[axis].activeMassRatio <= 1 + 1e-9)
    }
    if (index > 0) assert.ok(mode.frequencyHz >= result.modes[index - 1].frequencyHz)
  }
})

test('adding physical top equipment mass lowers the first natural frequency', () => {
  const light = resolvedProject({ moduleCount: 4, equipmentMassKg: 0 })
  const heavy = resolvedProject({ moduleCount: 4, equipmentMassKg: 300 })
  const lightFrequency = calculateNaturalModes(generateMastModel(light), light, { modeCount: 2 }).modes[0].frequencyHz
  const heavyFrequency = calculateNaturalModes(generateMastModel(heavy), heavy, { modeCount: 2 }).modes[0].frequencyHz
  assert.ok(heavyFrequency < lightFrequency)
})

test('load reliability factors do not alter inertia frequencies', () => {
  const normal = resolvedProject({
    moduleCount: 3,
    equipmentMassKg: 80,
    iceThicknessMm: 4,
    deadLoadFactor: 1,
    equipmentLoadFactor: 1,
    windLoadFactor: 1,
  })
  const factored = resolvedProject({
    moduleCount: 3,
    equipmentMassKg: 80,
    iceThicknessMm: 4,
    deadLoadFactor: 2.2,
    equipmentLoadFactor: 2.4,
    windLoadFactor: 2.6,
  })
  const normalModes = calculateNaturalModes(generateMastModel(normal), normal, { modeCount: 3 }).modes
  const factoredModes = calculateNaturalModes(generateMastModel(factored), factored, { modeCount: 3 }).modes
  for (let index = 0; index < normalModes.length; index += 1) {
    assert.ok(Math.abs(normalModes[index].frequencyHz - factoredModes[index].frequencyHz) < 1e-10)
  }
})
