import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, calculateMast } from '../site/engine/calculate.js'
import { analyzeTruss } from '../site/engine/solver.js'

test('одиночный стержень совпадает с аналитическим решением', () => {
  const diameterM = 0.01
  const areaM2 = Math.PI * diameterM ** 2 / 4
  const model = {
    moduleCount: 1,
    topNodeIds: [1],
    nodes: [
      { id: 0, position: [0, 0, 0], restrained: [true, true, true] },
      { id: 1, position: [2, 0, 0], restrained: [false, true, true] },
    ],
    members: [{
      id: 0,
      nodeA: 0,
      nodeB: 1,
      diameterM,
      youngModulusPa: 200e9,
      yieldStrengthPa: 400e6,
      densityKgM3: 7850,
      effectiveLengthFactor: 1,
    }],
  }
  const loads = {
    nodalLoads: [[0, 0, 0], [10_000, 0, 0]],
    totalAppliedLoad: [10_000, 0, 0],
    selfWeightN: 0,
    iceWeightN: 0,
    memberWindN: 0,
    equipmentWindN: 0,
  }
  const result = analyzeTruss(model, loads, { ...DEFAULT_PARAMETERS, materialSafetyFactor: 1 })
  const expectedDisplacementM = 10_000 * 2 / (200e9 * areaM2)
  assert.ok(Math.abs(result.displacements[1][0] - expectedDisplacementM) < 1e-12)
  assert.ok(Math.abs(result.memberResults[0].axialForceN - 10_000) < 1e-6)
  assert.ok(result.diagnostics.relativeResidual < 1e-12)
  assert.ok(result.diagnostics.maximumNodeEquilibriumResidual < 1e-12)
})

test('глобальное и локальное равновесие мачты соблюдается', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 3,
    windEnvelopeEnabled: false,
  })
  const reaction = result.analysis.reactions.reduce(
    (sum, value) => [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]],
    [0, 0, 0],
  )
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(reaction[axis] + result.loads.totalAppliedLoad[axis]) < 1e-8)
  }
  assert.ok(result.analysis.diagnostics.relativeResidual < 1e-9)
  assert.ok(result.analysis.diagnostics.maximumNodeEquilibriumResidual < 1e-9)
  assert.ok(result.analysis.buckling.criticalLoadFactor > 0)
})

test('обледенение увеличивает вертикальную и ветровую нагрузку', () => {
  const base = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: false,
    iceThicknessMm: 0,
  })
  const iced = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: false,
    iceThicknessMm: 10,
  })
  assert.ok(iced.loads.iceWeightN > 0)
  assert.ok(Math.abs(iced.loads.totalAppliedLoad[2]) > Math.abs(base.loads.totalAppliedLoad[2]))
  assert.ok(iced.loads.memberWindN > base.loads.memberWindN)
})

test('огибающая перебирает заданные направления ветра', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 90,
  })
  assert.equal(result.envelope.caseCount, 4)
  assert.equal(result.cases.length, 4)
  assert.ok(result.envelope.maxUtilization >= result.analysis.maxUtilization || result.envelope.maxTopDisplacementM >= result.analysis.maxTopDisplacementM)
})
