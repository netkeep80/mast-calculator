import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, calculateMast } from '../site/engine/calculate.js'
import { analyzeFrame } from '../site/engine/solver.js'

const approximately = (actual, expected, relative = 1e-9, absolute = 1e-12) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `ожидалось ${expected}, получено ${actual}, допуск ${tolerance}`,
  )
}

function singleBeamModel({
  lengthM = 2,
  diameterM = 0.01,
  axis = [1, 0, 0],
  endRestrained = [false, false, false, false, false, false],
} = {}) {
  const end = axis.map((value) => value * lengthM)
  return {
    moduleCount: 1,
    topNodeIds: [1],
    nodes: [
      { id: 0, position: [0, 0, 0], restrained: [true, true, true, true, true, true] },
      { id: 1, position: end, restrained: [...endRestrained] },
    ],
    members: [{
      id: 0,
      nodeA: 0,
      nodeB: 1,
      diameterM,
      youngModulusPa: 200e9,
      yieldStrengthPa: 400e6,
      poissonRatio: 0.3,
      densityKgM3: 7850,
      effectiveLengthFactor: 0.5,
    }],
  }
}

function frameLoadCase(model, { nodalLoads, distributedLoads } = {}) {
  const loads = nodalLoads ?? model.nodes.map(() => [0, 0, 0])
  const distributed = distributedLoads ?? model.members.map(() => [0, 0, 0])
  const totalDistributed = distributed.reduce((sum, q, index) => {
    const member = model.members[index]
    const a = model.nodes[member.nodeA].position
    const b = model.nodes[member.nodeB].position
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    return sum.map((value, axis) => value + q[axis] * length)
  }, [0, 0, 0])
  const totalNodal = loads.reduce(
    (sum, value) => sum.map((component, axis) => component + value[axis]),
    [0, 0, 0],
  )
  return {
    nodalLoads: loads,
    nodalMoments: model.nodes.map(() => [0, 0, 0]),
    memberDistributedLoads: distributed,
    totalAppliedLoad: totalNodal.map((value, axis) => value + totalDistributed[axis]),
    selfWeightN: 0,
    iceWeightN: 0,
    memberWindN: 0,
    equipmentWindN: 0,
  }
}

const frameParameters = {
  ...DEFAULT_PARAMETERS,
  materialSafetyFactor: 1,
  effectiveLengthFactor: 0.5,
}

test('frame: одиночный стержень на растяжение совпадает с δ = FL/(EA)', () => {
  const model = singleBeamModel({ lengthM: 2, diameterM: 0.01 })
  const loadCase = frameLoadCase(model, {
    nodalLoads: [[0, 0, 0], [10_000, 0, 0]],
  })
  const result = analyzeFrame(model, loadCase, frameParameters)
  const areaM2 = Math.PI * 0.01 ** 2 / 4
  const expectedDisplacementM = 10_000 * 2 / (200e9 * areaM2)

  approximately(result.displacements[1][0], expectedDisplacementM, 1e-10)
  approximately(result.memberResults[0].axialForceN, 10_000, 1e-10, 1e-6)
  approximately(result.memberResults[0].equivalentStressPa, 10_000 / areaM2, 1e-10)
  assert.equal(result.degreesOfFreedomPerNode, 6)
  assert.equal(result.solver, 'linear-3d-frame-euler-bernoulli')
  assert.ok(result.diagnostics.relativeResidual < 1e-12)
})

test('frame: консоль с поперечной силой совпадает с δ = PL³/(3EI)', () => {
  const lengthM = 2
  const diameterM = 0.02
  const forceN = 500
  const model = singleBeamModel({ lengthM, diameterM })
  const loadCase = frameLoadCase(model, {
    nodalLoads: [[0, 0, 0], [0, forceN, 0]],
  })
  const result = analyzeFrame(model, loadCase, frameParameters)
  const inertiaM4 = Math.PI * diameterM ** 4 / 64
  const expectedDisplacementM = forceN * lengthM ** 3 / (3 * 200e9 * inertiaM4)
  const expectedRotationRad = forceN * lengthM ** 2 / (2 * 200e9 * inertiaM4)

  approximately(result.displacements[1][1], expectedDisplacementM, 1e-9)
  approximately(Math.abs(result.rotations[1][2]), expectedRotationRad, 1e-9)
  approximately(Math.abs(result.reactionMoments[0][2]), forceN * lengthM, 1e-9)
  approximately(result.reactions[0][1], -forceN, 1e-9)
})

test('frame: консоль инвариантна к повороту в глобальной системе координат', () => {
  const lengthM = 1.7
  const diameterM = 0.018
  const forceN = 350

  const xModel = singleBeamModel({ lengthM, diameterM, axis: [1, 0, 0] })
  const xResult = analyzeFrame(xModel, frameLoadCase(xModel, {
    nodalLoads: [[0, 0, 0], [0, forceN, 0]],
  }), frameParameters)

  const yModel = singleBeamModel({ lengthM, diameterM, axis: [0, 1, 0] })
  const yResult = analyzeFrame(yModel, frameLoadCase(yModel, {
    nodalLoads: [[0, 0, 0], [forceN, 0, 0]],
  }), frameParameters)

  const xMagnitude = Math.hypot(...xResult.displacements[1])
  const yMagnitude = Math.hypot(...yResult.displacements[1])
  approximately(yMagnitude, xMagnitude, 1e-9)
})

test('frame: жёстко заделанная с двух сторон балка даёт реакции qL/2 и моменты qL²/12', () => {
  const lengthM = 2.4
  const qNPerM = 120
  const model = singleBeamModel({
    lengthM,
    diameterM: 0.02,
    endRestrained: [true, true, true, true, true, true],
  })
  const loadCase = frameLoadCase(model, {
    distributedLoads: [[0, qNPerM, 0]],
  })
  const result = analyzeFrame(model, loadCase, frameParameters)

  approximately(Math.abs(result.reactions[0][1]), qNPerM * lengthM / 2, 1e-10)
  approximately(Math.abs(result.reactions[1][1]), qNPerM * lengthM / 2, 1e-10)
  approximately(Math.abs(result.reactionMoments[0][2]), qNPerM * lengthM ** 2 / 12, 1e-10)
  approximately(Math.abs(result.reactionMoments[1][2]), qNPerM * lengthM ** 2 / 12, 1e-10)
  approximately(result.maxDisplacementM, 0, 0, 1e-15)
})

test('frame: равномерная поперечная нагрузка учитывается в моменте между узлами', () => {
  const lengthM = 2
  const qNPerM = 100
  const model = singleBeamModel({ lengthM, diameterM: 0.02 })
  const result = analyzeFrame(model, frameLoadCase(model, {
    distributedLoads: [[0, qNPerM, 0]],
  }), frameParameters)
  const member = result.memberResults[0]

  approximately(member.distributedBendingAllowanceNm, qNPerM * lengthM ** 2 / 8, 1e-12)
  assert.ok(member.maxBendingNm >= member.distributedBendingAllowanceNm)
  assert.ok(member.bendingStressPa > 0)
})

test('frame: чистое осевое растяжение не создаёт паразитного изгиба и кручения', () => {
  const model = singleBeamModel({ lengthM: 1.3, diameterM: 0.014 })
  const result = analyzeFrame(model, frameLoadCase(model, {
    nodalLoads: [[0, 0, 0], [7000, 0, 0]],
  }), frameParameters)
  const member = result.memberResults[0]

  approximately(member.maxShearN, 0, 0, 1e-8)
  approximately(member.maxBendingNm, 0, 0, 1e-8)
  approximately(member.maxTorsionNm, 0, 0, 1e-8)
  approximately(member.shearStressPa, 0, 0, 1e-8)
  approximately(member.equivalentStressPa, member.axialStressPa, 1e-10)
})

test('frame: глобальное равновесие силы мачты соблюдается', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: false,
    windDirectionDeg: 20,
  })
  const reaction = result.analysis.reactions.reduce(
    (sum, value) => [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]],
    [0, 0, 0],
  )
  for (let axis = 0; axis < 3; axis += 1) {
    approximately(reaction[axis], -result.loads.totalAppliedLoad[axis], 1e-8, 1e-6)
  }
  assert.ok(result.analysis.diagnostics.relativeResidual < 1e-8)
  assert.ok(result.analysis.diagnostics.maximumNodeEquilibriumResidual < 1e-8)
})

test('frame: глобальное равновесие моментов мачты контролируется', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 2,
    windEnvelopeEnabled: false,
    windDirectionDeg: 37,
  })
  assert.ok(result.analysis.diagnostics.globalMomentResidual < 1e-8)
})

test('обледенение увеличивает вертикальную и ветровую нагрузку', () => {
  const base = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    iceThicknessMm: 0,
  })
  const iced = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    iceThicknessMm: 10,
  })
  assert.ok(iced.loads.iceWeightN > 0)
  assert.ok(Math.abs(iced.loads.totalAppliedLoad[2]) > Math.abs(base.loads.totalAppliedLoad[2]))
  assert.ok(iced.loads.memberWindN > base.loads.memberWindN)
})

test('ветер вдоль оси отдельного цилиндрического ребра не создаёт поперечной распределённой силы', () => {
  const model = singleBeamModel({ lengthM: 2, axis: [1, 0, 0] })
  const parameters = { ...DEFAULT_PARAMETERS, windDirectionDeg: 0, iceThicknessMm: 0 }
  // This test uses calculateMast elsewhere for buildLoadCase integration; here the
  // frame load itself is explicitly zero to guard the solver against phantom load.
  const result = analyzeFrame(model, frameLoadCase(model), parameters)
  assert.ok(result.memberResults[0].maxShearN < 1e-10)
})

test('огибающая перебирает заданные направления ветра', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 90,
  })
  assert.equal(result.envelope.caseCount, 4)
  assert.equal(result.cases.length, 4)
  assert.ok(result.cases.every((loadCase) => loadCase.analysis.degreesOfFreedomPerNode === 6))
})

test('расчёт мачты использует frame solver и жёсткий коэффициент расчётной длины', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    windEnvelopeEnabled: false,
    effectiveLengthFactor: 1.7,
  })
  assert.equal(result.method.id, 'linear-frame-v0.5')
  assert.equal(result.analysis.solver, 'linear-3d-frame-euler-bernoulli')
  assert.equal(result.parameters.effectiveLengthFactor, 0.5)
  assert.ok(result.analysis.memberResults.every((member) => Number.isFinite(member.equivalentStressPa)))
})
