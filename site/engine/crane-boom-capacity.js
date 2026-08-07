import { selectedBoltUtilizationForAnalysis } from './connection-check.js'
import { STANDARD_GRAVITY_M_S2 } from './lateral-capacity.js'
import { buildLoadCase } from './loads.js'
import { analyzeFrame, compileFrameSystem } from './solver.js'

export const CRANE_BOOM_BISECTION_ITERATIONS = 16
export const CRANE_BOOM_MAX_PAYLOAD_KG = 1e7
const ROTATIONAL_SYMMETRY_DEG = 120

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale3 = (a, factor) => [a[0] * factor, a[1] * factor, a[2] * factor]

function directions(stepDeg) {
  const step = Number(stepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 60) {
    throw new Error('Шаг расчёта стрелы должен быть от 0 до 60°')
  }
  const result = []
  for (let angle = 0; angle < ROTATIONAL_SYMMETRY_DEG - step / 1000; angle += step) result.push(angle)
  return result
}

function horizontalUnit(directionDeg) {
  const radians = directionDeg * Math.PI / 180
  return [Math.cos(radians), Math.sin(radians), 0]
}

function memberLengthM(model, member) {
  const a = model.nodes[member.nodeA].position
  const b = model.nodes[member.nodeB].position
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

/**
 * Строит special load case для той же геометрии мачты, мысленно повёрнутой
 * горизонтально. Вместо реального поворота всей модели мы поворачиваем вектор
 * гравитации в плоскость XY. Для линейной изотропной frame-модели это
 * эквивалентная смена ориентации относительно gravity.
 */
export function buildHorizontalBoomLoadCase(model, parameters, payloadMassKg, directionDeg) {
  const direction = horizontalUnit(directionDeg)
  const payloadKg = Math.max(0, Number(payloadMassKg) || 0)
  const payloadForceN = payloadKg
    * STANDARD_GRAVITY_M_S2
    * Math.max(0, Number(parameters.equipmentLoadFactor ?? 1))

  // Base load case нужен для согласованной формы объекта и распределения
  // point load по трём top nodes. Все обычные gravity/weather loads выключены.
  const baseParameters = {
    ...parameters,
    deadLoadFactor: 0,
    windPressurePa: 0,
    windPresetId: 'custom',
    windEnvelopeEnabled: false,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    iceThicknessMm: 0,
    windDirectionDeg: directionDeg,
  }
  const loadCase = buildLoadCase(model, baseParameters, {
    topPointLoadN: scale3(direction, payloadForceN),
  })

  const gammaDead = Math.max(0, Number(parameters.deadLoadFactor ?? 1))
  let boomSelfWeightN = 0
  let distributedResultant = [0, 0, 0]

  for (const member of model.members) {
    const lengthM = memberLengthM(model, member)
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const weightPerLengthN = member.densityKgM3
      * areaM2
      * STANDARD_GRAVITY_M_S2
      * gammaDead
    const distributed = scale3(direction, weightPerLengthN)
    const weightN = weightPerLengthN * lengthM
    boomSelfWeightN += weightN
    loadCase.memberDistributedLoads[member.id] = distributed
    loadCase.memberLoadDetails[member.id] = {
      memberId: member.id,
      lengthM,
      steelWeightPerLengthN: weightPerLengthN,
      iceWeightPerLengthN: 0,
      windForcePerLengthN: [0, 0, 0],
      resultantForcePerLengthN: [...distributed],
      horizontalBoomGravity: true,
    }
    distributedResultant = add3(distributedResultant, scale3(distributed, lengthM))
  }

  loadCase.selfWeightN = boomSelfWeightN
  loadCase.distributedResultant = distributedResultant
  loadCase.totalAppliedLoad = add3(distributedResultant, loadCase.nodalResultant)
  loadCase.memberWindN = 0
  loadCase.iceWeightN = 0
  loadCase.equipmentWeightN = 0
  loadCase.equipmentWindN = 0
  loadCase.horizontalBoom = true
  loadCase.horizontalBoomPayloadMassKg = payloadKg
  loadCase.horizontalBoomPayloadForceN = payloadForceN
  loadCase.horizontalBoomDirectionDeg = directionDeg
  return loadCase
}

function memberLimitMode(analysis) {
  const member = analysis.memberResults[analysis.criticalMemberId]
  if (!member) return 'none'
  return member.bucklingUtilization >= member.stressUtilization
    ? 'local-member-buckling'
    : 'material-strength'
}

function ratios(model, parameters, analysis) {
  const memberRatio = analysis.maxUtilization
  const globalRatio = Number.isFinite(analysis.buckling.criticalLoadFactor)
    ? 1 / Math.max(analysis.buckling.criticalLoadFactor, Number.EPSILON)
    : 0
  const boltRatio = selectedBoltUtilizationForAnalysis(model, analysis, parameters)
  const governingRatio = Math.max(memberRatio, globalRatio, boltRatio)
  let governingMode = memberLimitMode(analysis)
  if (globalRatio >= memberRatio && globalRatio >= boltRatio) governingMode = 'global-buckling'
  if (boltRatio >= memberRatio && boltRatio >= globalRatio) governingMode = 'bolt-connection'
  return {
    memberRatio,
    globalRatio,
    boltRatio,
    governingRatio,
    governingMode,
    passes: governingRatio <= 1,
  }
}

function evaluate(model, parameters, frameSystem, payloadMassKg, directionDeg) {
  const loads = buildHorizontalBoomLoadCase(model, parameters, payloadMassKg, directionDeg)
  const analysis = analyzeFrame(model, loads, parameters, frameSystem)
  return {
    payloadMassKg,
    directionDeg,
    loads,
    analysis,
    ratios: ratios(model, parameters, analysis),
  }
}

function findDirectionalLimit(model, parameters, frameSystem, directionDeg, options = {}) {
  const baseline = evaluate(model, parameters, frameSystem, 0, directionDeg)
  if (!baseline.ratios.passes) {
    return {
      directionDeg,
      maximumEndPayloadMassKg: 0,
      governingMode: 'boom-self-weight-overlimit',
      baselineUtilization: baseline.ratios.governingRatio,
      utilizationAtLimit: baseline.ratios.governingRatio,
      memberUtilizationAtLimit: baseline.ratios.memberRatio,
      boltUtilizationAtLimit: baseline.ratios.boltRatio,
      bucklingFactorAtLimit: baseline.analysis.buckling.criticalLoadFactor,
      boomSelfWeightN: baseline.loads.selfWeightN,
      bounded: true,
      iterations: 0,
    }
  }

  let lowMassKg = 0
  let low = baseline
  let highMassKg = 1
  let high = evaluate(model, parameters, frameSystem, highMassKg, directionDeg)

  while (high.ratios.passes && highMassKg < CRANE_BOOM_MAX_PAYLOAD_KG) {
    lowMassKg = highMassKg
    low = high
    highMassKg = Math.min(CRANE_BOOM_MAX_PAYLOAD_KG, highMassKg * 2)
    high = evaluate(model, parameters, frameSystem, highMassKg, directionDeg)
    if (highMassKg >= CRANE_BOOM_MAX_PAYLOAD_KG) break
  }

  const bounded = !high.ratios.passes
  if (!bounded) {
    return {
      directionDeg,
      maximumEndPayloadMassKg: highMassKg,
      governingMode: high.ratios.governingMode,
      baselineUtilization: baseline.ratios.governingRatio,
      utilizationAtLimit: high.ratios.governingRatio,
      memberUtilizationAtLimit: high.ratios.memberRatio,
      boltUtilizationAtLimit: high.ratios.boltRatio,
      bucklingFactorAtLimit: high.analysis.buckling.criticalLoadFactor,
      boomSelfWeightN: baseline.loads.selfWeightN,
      bounded: false,
      iterations: 0,
    }
  }

  for (let iteration = 0; iteration < CRANE_BOOM_BISECTION_ITERATIONS; iteration += 1) {
    const middleMassKg = (lowMassKg + highMassKg) / 2
    const middle = evaluate(model, parameters, frameSystem, middleMassKg, directionDeg)
    if (middle.ratios.passes) {
      lowMassKg = middleMassKg
      low = middle
    } else {
      highMassKg = middleMassKg
    }
    options.onProgress?.({
      stage: 'crane-boom',
      directionDeg,
      iteration: iteration + 1,
      totalIterations: CRANE_BOOM_BISECTION_ITERATIONS,
      payloadMassKg: middleMassKg,
    })
  }

  return {
    directionDeg,
    maximumEndPayloadMassKg: lowMassKg,
    governingMode: low.ratios.governingMode,
    baselineUtilization: baseline.ratios.governingRatio,
    utilizationAtLimit: low.ratios.governingRatio,
    memberUtilizationAtLimit: low.ratios.memberRatio,
    boltUtilizationAtLimit: low.ratios.boltRatio,
    bucklingFactorAtLimit: low.analysis.buckling.criticalLoadFactor,
    boomSelfWeightN: baseline.loads.selfWeightN,
    bounded: true,
    iterations: CRANE_BOOM_BISECTION_ITERATIONS,
  }
}

export function calculateCraneBoomCapacity(model, parameters, options = {}) {
  if (!model?.members?.length || !model?.topNodeIds?.length) {
    throw new Error('Для расчёта стрелы нужна frame-модель с вершиной')
  }
  const stepDeg = Number(options.stepDeg ?? parameters.lateralCapacityStepDeg ?? 15)
  const frameSystem = options.frameSystem ?? compileFrameSystem(model, parameters)
  const cases = directions(stepDeg).map((directionDeg) => (
    findDirectionalLimit(model, parameters, frameSystem, directionDeg, options)
  ))
  const governing = cases.reduce((best, candidate) => (
    candidate.maximumEndPayloadMassKg < best.maximumEndPayloadMassKg ? candidate : best
  ), cases[0])
  const configuredEndPayloadMassKg = Math.max(0, Number(parameters.equipmentMassKg ?? 0))
  const additionalEndPayloadMassKg = Math.max(
    0,
    governing.maximumEndPayloadMassKg - configuredEndPayloadMassKg,
  )

  return {
    method: 'horizontal-boom-self-weight-plus-end-payload-v1',
    interpretation: 'Та же frame-модель мысленно повернута горизонтально: собственный вес арматурных рёбер действует поперёк оси стрелы, а груз приложен к трём узлам её конца. Ветер, лёд, hardware/weld fabrication mass и динамика подъёма исключены.',
    stepDeg,
    symmetrySectorDeg: ROTATIONAL_SYMMETRY_DEG,
    cases,
    governing,
    maximumEndPayloadMassKg: governing.maximumEndPayloadMassKg,
    configuredEndPayloadMassKg,
    additionalEndPayloadMassKg,
    governingDirectionDeg: governing.directionDeg,
    governingMode: governing.governingMode,
    boomSelfWeightN: governing.boomSelfWeightN,
    boomSelfMassEquivalentKg: governing.boomSelfWeightN / STANDARD_GRAVITY_M_S2,
    bounded: governing.bounded,
  }
}
