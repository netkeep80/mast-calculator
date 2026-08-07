import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateAssemblyMass } from '../site/engine/assembly-mass.js'
import {
  calculateMast,
  DEFAULT_PARAMETERS,
  resolveCalculationParameters,
} from '../site/engine/calculate.js'
import {
  buildDiameterTiers,
  resolveModuleDiameters,
} from '../site/engine/diameter-profile.js'
import { generateMastModel } from '../site/engine/geometry.js'
import { buildLoadCase } from '../site/engine/loads.js'
import { repairMixedDiameterVerificationPassport } from '../site/engine/mixed-diameter-verification.js'
import { selectUniformDiameter } from '../site/engine/optimize.js'
import { buildMaterialSummary } from '../site/engine/report.js'
import { buildVerificationPassport } from '../site/engine/verification.js'

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)
}

function parameters(overrides = {}) {
  return resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 3,
    barDiameterMm: 8,
    moduleDiametersMm: [16, 12, 8],
    windEnvelopeEnabled: false,
    windDirectionDeg: 30,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 0,
    extraVerticalLoadN: 0,
    iceThicknessMm: 0,
    ...overrides,
  })
}

test('профиль диаметров задаётся снизу вверх и верхний диаметр продолжается при height-search', () => {
  assert.deepEqual(resolveModuleDiameters({ moduleCount: 5, barDiameterMm: 10, moduleDiametersMm: [20, 16, 12] }), [20, 16, 12, 12, 12])
  assert.deepEqual(resolveModuleDiameters({ moduleCount: 2, barDiameterMm: 10, moduleDiametersMm: [20, 16, 12] }), [20, 16])
  assert.deepEqual(resolveModuleDiameters({ moduleCount: 3, barDiameterMm: 14 }), [14, 14, 14])
  assert.deepEqual(buildDiameterTiers([20, 20, 16, 12, 12]), [
    { fromModule: 1, toModule: 2, moduleCount: 2, diameterMm: 20 },
    { fromModule: 3, toModule: 3, moduleCount: 1, diameterMm: 16 },
    { fromModule: 4, toModule: 5, moduleCount: 2, diameterMm: 12 },
  ])
})

test('каждые девять рёбер физического модуля получают его собственный диаметр', () => {
  const p = parameters()
  const model = generateMastModel(p)
  assert.deepEqual(model.moduleDiametersMm, [16, 12, 8])
  assert.equal(model.members.length, 27)
  for (const module of model.modules) {
    assert.equal(module.memberIds.length, 9)
    assert.equal(module.diameterMm, [16, 12, 8][module.index])
    for (const memberId of module.memberIds) {
      close(model.members[memberId].diameterM * 1000, module.diameterMm, 1e-12)
    }
  }
})

test('собственный вес использует фактическое сечение каждого яруса', () => {
  const p = parameters({ windPressurePa: 0 })
  const model = generateMastModel(p)
  const loads = buildLoadCase(model, p)
  const expectedMassKg = model.members.reduce((sum, member) => {
    const a = model.nodes[member.nodeA].position
    const b = model.nodes[member.nodeB].position
    const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    return sum + lengthM * Math.PI * member.diameterM ** 2 / 4 * member.densityKgM3
  }, 0)
  close(loads.selfWeightN, expectedMassKg * 9.80665 * p.deadLoadFactor, 1e-10)

  const uniform16 = generateMastModel({ ...p, moduleDiametersMm: [16, 16, 16] })
  const uniformLoads = buildLoadCase(uniform16, p)
  assert.ok(loads.selfWeightN < uniformLoads.selfWeightN)
})

test('global FEM и помодульный Schur совпадают для модулей разной жёсткости', () => {
  const result = calculateMast(parameters({ equipmentMassKg: 15, windPressurePa: 250 }))
  assert.ok(result.analysis.modular)
  assert.ok(result.analysis.modular.relativeDisplacementDifference < 1e-8)
  assert.ok(result.analysis.modular.interfaceEquilibriumResidual < 1e-8)
  assert.deepEqual(result.model.moduleDiametersMm, [16, 12, 8])
})

test('ведомость материалов группирует реальные диаметры, а не глобальный fallback', () => {
  const result = calculateMast(parameters({ windPressurePa: 100 }))
  const material = buildMaterialSummary(result)
  const byDiameter = new Map()
  for (const group of material.groups) {
    byDiameter.set(group.diameterMm, (byDiameter.get(group.diameterMm) ?? 0) + group.count)
  }
  assert.equal(byDiameter.get(16), 9)
  assert.equal(byDiameter.get(12), 9)
  assert.equal(byDiameter.get(8), 9)
  assert.equal(material.totalCount, 27)
})

test('единый физический узел выбирается с запасом по самому толстому ребру', () => {
  const result = calculateMast(parameters({ moduleCount: 2, moduleDiametersMm: [18, 8], windPressurePa: 150 }))
  assert.equal(result.connections.referenceBarDiameterMm, 18)
  assert.equal(result.connections.nutSections.barDiameterMm, 18)
  assert.equal(result.connections.configurator.referenceBarDiameterMm, 18)
  assert.equal(result.connections.configurator.selected.referenceBarDiameterMm, 18)
})

test('сварная огибающая хранит фактический диаметр каждого конца ребра', () => {
  const result = calculateMast(parameters({ moduleCount: 2, moduleDiametersMm: [16, 8], windPressurePa: 200 }))
  const diameters = new Set(result.connections.weld.envelope.map((item) => item.memberDiameterMm))
  assert.deepEqual([...diameters].sort((a, b) => b - a), [16, 8])
})

test('паспорт верификации независимо пересчитывает массу смешанного профиля', () => {
  const result = calculateMast(parameters({ windPressurePa: 120 }))
  result.verification = buildVerificationPassport(result)
  repairMixedDiameterVerificationPassport(result.verification, result)
  assert.equal(result.verification.checks.find((check) => check.id === 'steel-mass')?.status, 'pass')
  assert.equal(result.verification.checks.find((check) => check.id === 'self-weight')?.status, 'pass')
  assert.equal(result.verification.counts.failed, 0)
})

test('оценка сборочной массы суммирует модули по фактическим диаметрам и показывает экономию', () => {
  const result = calculateMast(parameters({ windPressurePa: 180 }))
  const mass = calculateAssemblyMass(result)
  assert.deepEqual(mass.moduleDiametersMm, [16, 12, 8])
  assert.equal(mass.module.profiles.length, 3)
  close(
    mass.mastFabricationEstimate.profiledModulesMassKg,
    mass.module.profiles.reduce((sum, module) => sum + module.totalMassKg, 0),
    1e-12,
  )
  assert.ok(mass.mastFabricationEstimate.savingsVsUniformMaximumDiameterKg > 0)
  assert.ok(mass.mastFabricationEstimate.profiledModulesMassKg < mass.mastFabricationEstimate.uniformMaximumDiameterMassKg)
})

test('uniform optimizer не наследует внешний смешанный профиль', () => {
  const p = parameters({ moduleDiametersMm: [40, 36, 32], displacementLimitMm: 1e9, minimumBucklingFactor: 0.01 })
  const optimization = selectUniformDiameter(p, [10], { stopAtFirstPassing: false })
  assert.equal(optimization.variants.length, 1)
  assert.deepEqual(optimization.variants[0].result.model.moduleDiametersMm, [10, 10, 10])
})
