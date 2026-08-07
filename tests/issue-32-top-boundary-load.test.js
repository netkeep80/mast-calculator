import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { calculateMast, DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { buildLoadCase } from '../site/engine/loads.js'

const GRAVITY = 9.80665
const norm3 = (value) => Math.hypot(...value)

function approximately(actual, expected, relative = 1e-9, absolute = 1e-7) {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `ожидалось ${expected}, получено ${actual}`)
}

function quietParameters(overrides = {}) {
  return {
    ...DEFAULT_PARAMETERS,
    windEnvelopeEnabled: false,
    windPressurePa: 0,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 0,
    extraVerticalLoadN: 0,
    iceThicknessMm: 0,
    ...overrides,
  }
}

test('issue #32: один модуль с 1000 кг показывает полную нагрузку на верхнюю грань, а не 0 Н', () => {
  const parameters = quietParameters({ moduleCount: 1, equipmentMassKg: 1000 })
  const result = calculateMast(parameters)
  const state = result.analysis.moduleResults[0]
  const expectedWeightN = 1000 * GRAVITY * parameters.equipmentLoadFactor

  // Структурных модулей выше действительно нет.
  assert.ok(norm3(state.topStructuralResultantFromAbove.forceN) < 1e-6)

  // Но непосредственная нагрузка оборудования обязана присутствовать на грани.
  approximately(state.topDirectResultant.forceN[2], -expectedWeightN)
  approximately(state.topResultantFromAbove.forceN[2], -expectedWeightN)
  approximately(norm3(state.topResultantFromAbove.forceN), expectedWeightN)

  for (const action of state.topDirectApplied) {
    approximately(action.forceN[2], -expectedWeightN / 3)
  }
})

test('issue #32: верхняя масса передаётся через стек на нижний модуль', () => {
  const parameters = quietParameters({
    moduleCount: 3,
    equipmentMassKg: 1000,
    deadLoadFactor: 0,
  })
  const result = calculateMast(parameters)
  const expectedWeightN = 1000 * GRAVITY * parameters.equipmentLoadFactor
  const bottom = result.analysis.moduleResults[0]
  const top = result.analysis.moduleResults.at(-1)

  approximately(top.topResultantFromAbove.forceN[2], -expectedWeightN)
  approximately(bottom.topStructuralResultantFromAbove.forceN[2], -expectedWeightN)
  approximately(bottom.topResultantFromAbove.forceN[2], -expectedWeightN)
  assert.ok(result.analysis.modular.interfaceEquilibriumResidual < 1e-8)
})

test('масса оборудования и дополнительная вертикальная сила не дублируются по смыслу', () => {
  const model = {
    nodes: [0, 1, 2].map((id) => ({ id, position: [id, 0, 1], restrained: new Array(6).fill(false) })),
    members: [],
    topNodeIds: [0, 1, 2],
  }
  const parameters = quietParameters({
    equipmentMassKg: 100,
    equipmentLoadFactor: 1.25,
    extraVerticalLoadN: 500,
  })
  const loads = buildLoadCase(model, parameters)
  const expectedEquipmentWeightN = 100 * GRAVITY * 1.25
  const expectedTotalVerticalN = expectedEquipmentWeightN + 500

  approximately(loads.equipmentWeightN, expectedEquipmentWeightN)
  approximately(loads.extraVerticalLoadN, 500)
  approximately(loads.topVerticalLoadN, expectedTotalVerticalN)
  approximately(loads.nodalResultant[2], -expectedTotalVerticalN)

  // extraVerticalLoadN уже задан в Н и не должен повторно умножаться на γ оборудования.
  approximately(loads.topVerticalLoadN - loads.equipmentWeightN, 500)
})

test('UI объясняет суммарную нагрузку верхней грани и различие массы и силы', () => {
  const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8')
  const viewer = fs.readFileSync(new URL('../site/module-viewer.js', import.meta.url), 'utf8')

  assert.match(viewer, /нагрузка на верхнюю грань/i)
  assert.doesNotMatch(viewer, /нагрузка от стека сверху/i)
  assert.match(html, /не задавайте одну и ту же нагрузку/i)
  assert.match(html, /m·g·γ/i)
  assert.match(html, /уже как сила/i)
})
