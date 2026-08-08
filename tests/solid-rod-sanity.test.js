import assert from 'node:assert/strict'
import test from 'node:test'
import { generateMastModel } from '../packages/structural-analysis/index.js'
import { calculateLateralCapacity } from '../packages/engineering/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

function solidCantileverFromMast(parameters) {
  const edgeM = parameters.ribCutLengthMm / 1000
  const heightM = parameters.moduleCount * parameters.moduleHeightMm / 1000
  const outerDiameterM = 2 * edgeM / Math.sqrt(3)
  return {
    moduleCount: 1,
    topNodeIds: [1],
    nodes: [
      { id: 0, position: [0, 0, 0], restrained: [true, true, true, true, true, true] },
      { id: 1, position: [0, 0, heightM], restrained: [false, false, false, false, false, false] },
    ],
    members: [{
      id: 0,
      nodeA: 0,
      nodeB: 1,
      diameterM: outerDiameterM,
      youngModulusPa: parameters.youngModulusGPa * 1e9,
      yieldStrengthPa: parameters.yieldStrengthMPa * 1e6,
      poissonRatio: parameters.poissonRatio,
      densityKgM3: parameters.densityKgM3,
      effectiveLengthFactor: 0.5,
    }],
  }
}

test('dребра = a/2 даёт сопоставимое количество стали с цельным прутком диаметром мачты', () => {
  const edgeM = 0.3
  const ribDiameterM = edgeM / 2
  const mastDiameterM = 2 * edgeM / Math.sqrt(3)
  const sixRibArea = 6 * Math.PI * ribDiameterM ** 2 / 4
  const solidArea = Math.PI * mastDiameterM ** 2 / 4

  // 6·π(a/2)²/4 / [π(2a/√3)²/4] = 9/8.
  assert.ok(Math.abs(sixRibArea / solidArea - 9 / 8) < 1e-12)
})

test('толсторёберная frame-модель мачты и цельный пруток того же габарита имеют один порядок боковой прочности', () => {
  // Это sanity-check именно глобального frame/member solver, а не реального
  // межмодульного болта. Поэтому сравниваем memberLimitForceN, а не новый
  // общий criticalForceN=min(member, global buckling, bolt). Иначе слабый
  // штатный M24 закономерно ломает предельную толсторёберную геометрию и
  // перестаёт проверяться исходный инвариант масштабов FEM.
  const parameters = resolvedProject({
    stockBarLengthMm: 1200,
    stockBarPieces: 4,
    moduleCount: 4,
    barDiameterMm: 150,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  })
  assert.equal(parameters.ribCutLengthMm, 300)
  assert.equal(parameters.barDiameterMm, parameters.ribCutLengthMm / 2)

  const mast = calculateLateralCapacity(generateMastModel(parameters), parameters)
  const solid = calculateLateralCapacity(solidCantileverFromMast(parameters), parameters)
  const capacityRatio = mast.memberLimitForceN / solid.memberLimitForceN
  const mastStiffness = 1 / mast.governing.unitTopDisplacementM
  const solidStiffness = 1 / solid.governing.unitTopDisplacementM
  const stiffnessRatio = mastStiffness / solidStiffness

  assert.ok(
    capacityRatio > 0.5 && capacityRatio < 2.5,
    `боковая прочность frame/member должна быть сопоставима: Pмачты/Pпрутка = ${capacityRatio}`,
  )
  assert.ok(
    stiffnessRatio > 0.3 && stiffnessRatio < 3,
    `боковая жёсткость должна быть одного порядка: Kмачты/Kпрутка = ${stiffnessRatio}`,
  )
})
