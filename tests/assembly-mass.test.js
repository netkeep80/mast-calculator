import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateAssemblyMass,
  estimateBoltMassKg,
  estimateFilletWeldMassKg,
  estimateNutMassKg,
  reinforcementMassPerMeterKg,
} from '../packages/design/index.js'
import { calculateMast } from '../packages/application/index.js'
import { buildJointHardwareGeometry } from '../packages/domain/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const approximately = (actual, expected, relative = 1e-10, absolute = 1e-12) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `ожидалось ${expected}, получено ${actual}`)
}

test('масса погонного метра арматуры совпадает с rho*pi*d^2/4', () => {
  const diameterMm = 12
  const densityKgM3 = 7850
  const expected = densityKgM3 * Math.PI * (diameterMm / 1000) ** 2 / 4
  approximately(reinforcementMassPerMeterKg(diameterMm, densityKgM3), expected)
})

test('масса углового шва масштабируется линейно с длиной и квадратично с катетом', () => {
  const base = estimateFilletWeldMassKg({ weldLegMm: 4, physicalLengthMm: 100 })
  const doubleLength = estimateFilletWeldMassKg({ weldLegMm: 4, physicalLengthMm: 200 })
  const doubleLeg = estimateFilletWeldMassKg({ weldLegMm: 8, physicalLengthMm: 100 })
  approximately(doubleLength.massKg, 2 * base.massKg)
  approximately(doubleLeg.massKg, 4 * base.massKg)
  approximately(base.areaMm2, 8)
})

test('геометрическая масса M24x80, проходной M30 и длинной M24 положительна и воспроизводима', () => {
  const geometry = buildJointHardwareGeometry({ boltDiameterMm: 24, boltClass: '8.8' })
  const bolt = estimateBoltMassKg(geometry.bolt)
  const clearance = estimateNutMassKg(geometry.bottomClearanceNut)
  const coupling = estimateNutMassKg(geometry.topCouplingNut)
  assert.equal(geometry.bolt.lengthMm, 80)
  assert.equal(geometry.bottomClearanceNut.threadDiameterMm, 30)
  assert.equal(geometry.topCouplingNut.threadDiameterMm, 24)
  assert.ok(bolt.massKg > 0)
  assert.ok(clearance.massKg > 0)
  assert.ok(coupling.massKg > clearance.massKg)
})

test('сборочная масса модуля состоит из 9 рёбер, 3 комплектов метизов и 18 сваренных концов', () => {
  const result = calculateMast(resolvedProject({
    moduleCount: 2,
    windEnvelopeEnabled: false,
    windDirectionDeg: 17,
  }))
  const mass = calculateAssemblyMass(result)
  const jointHardware = mass.hardware.bolt.massKg
    + mass.hardware.clearanceNut.massKg
    + mass.hardware.couplingNut.massKg
  approximately(mass.intermoduleJoint.hardwareMassKg, jointHardware)
  approximately(
    mass.intermoduleJoint.totalMassKg,
    jointHardware + 6 * mass.weld.massPerEndKg,
  )
  approximately(
    mass.module.totalMassKg,
    9 * mass.rib.massKg + 3 * jointHardware + 18 * mass.weld.massPerEndKg,
  )
  approximately(
    mass.mastFabricationEstimate.uniformModulesMassKg,
    2 * mass.module.totalMassKg,
  )
  assert.equal(mass.module.composition, '9 рёбер + 3 длинные гайки + 3 проходные гайки + 3 болта + 18 сваренных концов')
  assert.equal(mass.includesInGlobalFemSelfWeight, false)
})
