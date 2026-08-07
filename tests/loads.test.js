import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { buildLoadCase } from '../site/engine/loads.js'

const approximately = (actual, expected, relative = 1e-10, absolute = 1e-10) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `ожидалось ${expected}, получено ${actual}`)
}

function oneMemberModel(axis = [1, 0, 0], lengthM = 2, diameterM = 0.012) {
  return {
    nodes: [
      { id: 0, position: [0, 0, 0], restrained: [true, true, true, true, true, true] },
      { id: 1, position: axis.map((value) => value * lengthM), restrained: [false, false, false, false, false, false] },
    ],
    members: [{
      id: 0,
      nodeA: 0,
      nodeB: 1,
      diameterM,
      youngModulusPa: 200e9,
      yieldStrengthPa: 390e6,
      poissonRatio: 0.3,
      densityKgM3: 7850,
      effectiveLengthFactor: 0.5,
    }],
    topNodeIds: [1],
  }
}

const quietEquipment = {
  equipmentMassKg: 0,
  equipmentWindAreaM2: 0,
  extraHorizontalLoadN: 0,
  extraVerticalLoadN: 0,
}

test('ветер вдоль оси цилиндрического ребра не создаёт аэродинамической нагрузки', () => {
  const model = oneMemberModel([1, 0, 0])
  const loads = buildLoadCase(model, {
    ...DEFAULT_PARAMETERS,
    ...quietEquipment,
    windDirectionDeg: 0,
    iceThicknessMm: 0,
  })
  approximately(loads.memberWindN, 0)
  approximately(loads.memberDistributedLoads[0][0], 0)
  approximately(loads.memberDistributedLoads[0][1], 0)
})

test('ветер перпендикулярно ребру даёт q = p·cd·d·γw', () => {
  const lengthM = 2
  const diameterM = 0.012
  const model = oneMemberModel([1, 0, 0], lengthM, diameterM)
  const parameters = {
    ...DEFAULT_PARAMETERS,
    ...quietEquipment,
    windDirectionDeg: 90,
    iceThicknessMm: 0,
  }
  const loads = buildLoadCase(model, parameters)
  const expectedPerM = parameters.windPressurePa
    * parameters.dragCoefficient
    * diameterM
    * parameters.windLoadFactor

  approximately(Math.abs(loads.memberDistributedLoads[0][1]), expectedPerM)
  approximately(loads.memberWindN, expectedPerM * lengthM)
})

test('наклон ребра уменьшает ветер согласно нормальной пространственной проекции', () => {
  const invSqrt2 = 1 / Math.sqrt(2)
  const lengthM = 1.5
  const diameterM = 0.012
  const model = oneMemberModel([invSqrt2, invSqrt2, 0], lengthM, diameterM)
  const parameters = {
    ...DEFAULT_PARAMETERS,
    ...quietEquipment,
    windDirectionDeg: 0,
  }
  const loads = buildLoadCase(model, parameters)
  const fullPerM = parameters.windPressurePa
    * parameters.dragCoefficient
    * diameterM
    * parameters.windLoadFactor
  approximately(loads.memberWindN, fullPerM * invSqrt2 * lengthM)
})

test('собственный вес стержня совпадает с ρA L g γg', () => {
  const lengthM = 1.8
  const diameterM = 0.016
  const model = oneMemberModel([1, 0, 0], lengthM, diameterM)
  const parameters = {
    ...DEFAULT_PARAMETERS,
    ...quietEquipment,
    windPressurePa: 0,
    iceThicknessMm: 0,
  }
  const loads = buildLoadCase(model, parameters)
  const areaM2 = Math.PI * diameterM ** 2 / 4
  const expectedN = 7850 * areaM2 * lengthM * 9.80665 * parameters.deadLoadFactor

  approximately(loads.selfWeightN, expectedN)
  approximately(loads.totalAppliedLoad[2], -expectedN)
  approximately(loads.memberDistributedLoads[0][2], -expectedN / lengthM)
})

test('слой льда увеличивает наружный диаметр, массу и ветровую нагрузку', () => {
  const model = oneMemberModel([1, 0, 0], 2, 0.012)
  const common = {
    ...DEFAULT_PARAMETERS,
    ...quietEquipment,
    windDirectionDeg: 90,
  }
  const clean = buildLoadCase(model, { ...common, iceThicknessMm: 0 })
  const iced = buildLoadCase(model, { ...common, iceThicknessMm: 8 })

  assert.ok(iced.iceWeightN > 0)
  assert.ok(iced.memberWindN > clean.memberWindN)
  assert.ok(Math.abs(iced.totalAppliedLoad[2]) > Math.abs(clean.totalAppliedLoad[2]))
})

test('вес и ветер оборудования распределяются поровну между верхними узлами', () => {
  const model = {
    nodes: [0, 1, 2].map((id) => ({ id, position: [id, 0, 1], restrained: new Array(6).fill(false) })),
    members: [],
    topNodeIds: [0, 1, 2],
  }
  const parameters = {
    ...DEFAULT_PARAMETERS,
    equipmentMassKg: 30,
    equipmentWindAreaM2: 1,
    windDirectionDeg: 0,
    extraHorizontalLoadN: 0,
    extraVerticalLoadN: 0,
  }
  const loads = buildLoadCase(model, parameters)
  const expectedWind = parameters.windPressurePa * parameters.equipmentDragCoefficient * parameters.windLoadFactor
  const expectedWeight = parameters.equipmentMassKg * 9.80665 * parameters.equipmentLoadFactor

  for (const load of loads.nodalLoads) {
    approximately(load[0], expectedWind / 3)
    approximately(load[2], -expectedWeight / 3)
  }
})
