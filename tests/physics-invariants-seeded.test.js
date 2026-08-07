import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PARAMETERS,
  calculateMast,
  resolveCalculationParameters,
} from '../packages/application/index.js'
import { generateMastModel } from '../packages/structural-analysis/index.js'
import { buildLoadCase } from '../packages/structural-analysis/index.js'
import { assertClose } from './helpers/regression-tolerances.js'

const SEED = 0x51A7E2
const GRAVITY = 9.80665

function seededRandom(seed = SEED) {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (random, values) => values[Math.floor(random() * values.length)]

function memberLength(model, member, positions = model.nodes.map((node) => node.position)) {
  const a = positions[member.nodeA]
  const b = positions[member.nodeB]
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

function rotateZ(position, angleRad) {
  const [x, y, z] = position
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return [c * x - s * y, s * x + c * y, z]
}

function scenario(random, index) {
  return resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1 + Math.floor(random() * 6),
    barDiameterMm: pick(random, [10, 12, 14, 16, 18]),
    windPresetId: 'custom',
    windPressurePa: Math.round(random() * 850),
    windEnvelopeEnabled: false,
    windDirectionDeg: random() * 120,
    equipmentMassKg: Math.round(random() * 120),
    equipmentWindAreaM2: random() * 1.2,
    iceThicknessMm: Math.round(random() * 10),
    heightSearchMaxModules: 12,
    _seedCase: index,
  })
}

test(`seeded physical invariants remain valid (seed=${SEED})`, () => {
  const random = seededRandom()
  for (let index = 0; index < 6; index += 1) {
    const parameters = scenario(random, index)
    const label = `seed=${SEED}, case=${index}, modules=${parameters.moduleCount}, d=${parameters.barDiameterMm}`
    const model = generateMastModel(parameters)

    assert.equal(model.members.length, parameters.moduleCount * 9, `${label}: требуется 9 рёбер на модуль`)
    assert.equal(model.modules.length, parameters.moduleCount, `${label}: неверное число физических модулей`)
    for (const module of model.modules) {
      assert.equal(module.memberIds.length, 9, `${label}: module ${module.index} имеет не 9 рёбер`)
    }

    const loads = buildLoadCase(model, parameters)
    const independentSteelMassKg = model.members.reduce((sum, member) => {
      const areaM2 = Math.PI * member.diameterM ** 2 / 4
      return sum + memberLength(model, member) * areaM2 * member.densityKgM3
    }, 0)
    assertClose(
      loads.selfWeightN,
      independentSteelMassKg * GRAVITY * parameters.deadLoadFactor,
      'force',
      `${label}: self-weight = ρALgγg`,
    )

    const rotation = random() * 2 * Math.PI
    const rotated = model.nodes.map((node) => rotateZ(node.position, rotation))
    for (const member of model.members) {
      assertClose(
        memberLength(model, member, rotated) * 1000,
        memberLength(model, member) * 1000,
        'geometryMm',
        `${label}: rigid rotation preserves member ${member.id} length`,
      )
    }

    const result = calculateMast(parameters)
    const reactions = result.analysis.reactions.reduce(
      (sum, value) => [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]],
      [0, 0, 0],
    )
    for (let axis = 0; axis < 3; axis += 1) {
      assertClose(
        reactions[axis],
        -result.loads.totalAppliedLoad[axis],
        'force',
        `${label}: global force equilibrium axis ${axis}`,
      )
    }
    assert.ok(
      result.analysis.modular.relativeDisplacementDifference < 1e-8,
      `${label}: global↔Schur displacement difference=${result.analysis.modular.relativeDisplacementDifference}`,
    )
    assert.ok(
      result.analysis.modular.interfaceEquilibriumResidual < 1e-8,
      `${label}: Schur interface residual=${result.analysis.modular.interfaceEquilibriumResidual}`,
    )
  }
})

test(`elastic circular-section properties grow with diameter (seed=${SEED})`, () => {
  const random = seededRandom(SEED ^ 0xBADC0DE)
  for (let index = 0; index < 24; index += 1) {
    const d1 = 6 + random() * 20
    const d2 = d1 + 0.01 + random() * 20
    const area = (d) => Math.PI * d ** 2 / 4
    const inertia = (d) => Math.PI * d ** 4 / 64
    assert.ok(area(d2) > area(d1), `seed=${SEED}, pair=${index}: A(d) must increase`)
    assert.ok(inertia(d2) > inertia(d1), `seed=${SEED}, pair=${index}: I(d) must increase`)
  }
})
