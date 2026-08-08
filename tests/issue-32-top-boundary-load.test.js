import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { calculateMast } from '../packages/application/index.js'
import { buildLoadCase } from '../packages/structural-analysis/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const GRAVITY = 9.80665
const norm3 = (value) => Math.hypot(...value)

function approximately(actual, expected, relative = 1e-9, absolute = 1e-7) {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `ожидалось ${expected}, получено ${actual}`)
}

function quietParameters(overrides = {}) {
  return resolvedProject({
    windEnvelopeEnabled: false,
    windPressurePa: 0,
    equipmentWindAreaM2: 0,
    iceThicknessMm: 0,
    ...overrides,
  })
}

test('issue #32: один модуль с 1000 кг показывает полную нагрузку на верхнюю грань, а не 0 Н', () => {
  const parameters = quietParameters({ moduleCount: 1, equipmentMassKg: 1000 })
  const result = calculateMast(parameters)
  const state = result.analysis.moduleResults[0]
  const expectedWeightN = 1000 * GRAVITY * parameters.equipmentLoadFactor

  assert.ok(norm3(state.topStructuralResultantFromAbove.forceN) < 1e-6)
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

test('issue #36: масса оборудования остаётся единственной пользовательской вертикальной нагрузкой', () => {
  const model = {
    nodes: [0, 1, 2].map((id) => ({ id, position: [id, 0, 1], restrained: new Array(6).fill(false) })),
    members: [],
    topNodeIds: [0, 1, 2],
  }
  assert.throws(
    () => quietParameters({ equipmentMassKg: 100, equipmentLoadFactor: 1.25, extraVerticalLoadN: 500 }),
    /derived\/internal ResolvedProject field: extraVerticalLoadN/,
  )
  const parameters = quietParameters({
    equipmentMassKg: 100,
    equipmentLoadFactor: 1.25,
  })
  const loads = buildLoadCase(model, parameters)
  const expectedEquipmentWeightN = 100 * GRAVITY * 1.25

  approximately(loads.equipmentWeightN, expectedEquipmentWeightN)
  approximately(loads.topVerticalLoadN, expectedEquipmentWeightN)
  approximately(loads.nodalResultant[2], -expectedEquipmentWeightN)
  assert.equal('extraVerticalLoadN' in loads, false)

  const fixture = buildLoadCase(model, {
    ...parameters,
    equipmentMassKg: 0,
  }, { topPointLoadN: [0, 0, -500] })
  approximately(fixture.topVerticalLoadN, 500)
  approximately(fixture.nodalResultant[2], -500)
})

test('issue #36: UI физически содержит только массу и не требует runtime-переименования legacy полей', () => {
  const viewer = fs.readFileSync(new URL('../apps/web/module-viewer.js', import.meta.url), 'utf8')
  const usage = fs.readFileSync(new URL('../apps/web/usage-scenarios.js', import.meta.url), 'utf8')
  const html = fs.readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8')

  assert.match(viewer, /нагрузка на верхнюю грань/i)
  assert.doesNotMatch(viewer, /нагрузка от стека сверху/i)
  assert.doesNotMatch(html, /name=["']extraHorizontalLoadN["']/)
  assert.doesNotMatch(html, /name=["']extraVerticalLoadN["']/)
  assert.match(html, /Уже установленная масса на вершине, кг/)
  assert.match(html, /Поперечный unit-load и горизонтальная стрела/)
  assert.doesNotMatch(usage, /removeLegacyForceControl|installIssue36Ui|setMetricLabel|page-header|прототип\s+1\./i)
  assert.match(usage, /unit-load/i)
  assert.match(usage, /горизонтальн.*стрел/i)
  assert.match(usage, /boomSelfMassEquivalentKg/)
  assert.match(usage, /renderStaticLoadDetails/)
})