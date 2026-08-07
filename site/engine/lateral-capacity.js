import {
  evaluateBoltSystemForAnalysis,
  selectedBoltUtilizationForAnalysis,
} from './connection-check.js'
import { buildLoadCase } from './loads.js'
import { analyzeFrame, compileFrameSystem } from './solver.js'

export const STANDARD_GRAVITY_M_S2 = 9.80665
export const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15
const ROTATIONAL_SYMMETRY_DEG = 120
const MIN_COMPRESSION_FOR_GLOBAL_BUCKLING_N = 1e-9

export function lateralDirections(stepDeg) {
  const step = Number(stepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 60) {
    throw new Error('Шаг расчёта боковой нагрузки должен быть от 0 до 60°')
  }
  const values = []
  for (let angle = 0; angle < ROTATIONAL_SYMMETRY_DEG - step / 1000; angle += step) values.push(angle)
  return values
}

function pureUnitLateralParameters(parameters, directionDeg) {
  return {
    ...parameters,
    deadLoadFactor: 0,
    windPressurePa: 0,
    windPresetId: 'custom',
    windDirectionDeg: directionDeg,
    windEnvelopeEnabled: false,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    iceThicknessMm: 0,
  }
}

function unitTopPointLoad(directionDeg) {
  const radians = directionDeg * Math.PI / 180
  return [Math.cos(radians), Math.sin(radians), 0]
}

function governingMemberLimit(analysis) {
  const critical = analysis.memberResults.reduce((best, candidate) => (
    candidate.utilization > best.utilization ? candidate : best
  ), analysis.memberResults[0])
  if (!(critical?.utilization > Number.EPSILON)) {
    return {
      forceN: Number.POSITIVE_INFINITY,
      memberId: critical?.memberId ?? null,
      mode: 'none',
      unitUtilization: critical?.utilization ?? 0,
    }
  }
  const mode = critical.bucklingUtilization >= critical.stressUtilization
    ? 'local-member-buckling'
    : 'material-strength'
  return {
    forceN: 1 / critical.utilization,
    memberId: critical.memberId,
    mode,
    unitUtilization: critical.utilization,
  }
}

function meaningfulCompressionN(analysis) {
  return Math.max(
    0,
    ...analysis.memberResults.map((member) => Math.max(0, -(member.maxCompressionN ?? 0))),
  )
}

function selectedBoltExternalLoadFactor(model, analysis, parameters) {
  const evaluation = evaluateBoltSystemForAnalysis(model, analysis, parameters)
  if (!evaluation.applicable) return Number.POSITIVE_INFINITY
  if (evaluation.geometry?.passes === false || evaluation.nutSections?.passes === false) return 0
  return Math.min(...evaluation.checks.map(({ check }) => check.loadFactorToDesignLimit))
}

function governingMode(memberLimitN, globalBucklingN, boltLimitN) {
  const minimum = Math.min(memberLimitN, globalBucklingN, boltLimitN)
  if (boltLimitN <= minimum + 1e-12) return 'bolt-connection'
  if (globalBucklingN <= minimum + 1e-12) return 'global-buckling'
  return null
}

function evaluateDirection(model, parameters, directionDeg, frameSystem) {
  const unitParameters = pureUnitLateralParameters(parameters, directionDeg)
  const loads = buildLoadCase(model, unitParameters, {
    topPointLoadN: unitTopPointLoad(directionDeg),
  })
  const analysis = analyzeFrame(model, loads, unitParameters, frameSystem)
  const memberLimit = governingMemberLimit(analysis)
  const unitCompressionN = meaningfulCompressionN(analysis)
  const globalBucklingForceN = unitCompressionN > MIN_COMPRESSION_FOR_GLOBAL_BUCKLING_N
    ? analysis.buckling.criticalLoadFactor
    : Number.POSITIVE_INFINITY
  const boltUnitUtilization = selectedBoltUtilizationForAnalysis(model, analysis, unitParameters)
  const boltLimitForceN = selectedBoltExternalLoadFactor(model, analysis, unitParameters)
  const criticalForceN = Math.min(memberLimit.forceN, globalBucklingForceN, boltLimitForceN)
  const connectionOrBucklingMode = governingMode(
    memberLimit.forceN,
    globalBucklingForceN,
    boltLimitForceN,
  )
  const mode = connectionOrBucklingMode ?? memberLimit.mode

  return {
    directionDeg,
    criticalForceN,
    criticalForceKgf: criticalForceN / STANDARD_GRAVITY_M_S2,
    idealizedCraneBoomPayloadKg: criticalForceN / STANDARD_GRAVITY_M_S2,
    memberLimitForceN: memberLimit.forceN,
    memberLimitForceKgf: memberLimit.forceN / STANDARD_GRAVITY_M_S2,
    memberLimitMode: memberLimit.mode,
    globalBucklingForceN,
    globalBucklingForceKgf: globalBucklingForceN / STANDARD_GRAVITY_M_S2,
    boltLimitForceN,
    boltLimitForceKgf: boltLimitForceN / STANDARD_GRAVITY_M_S2,
    boltUnitUtilization,
    governingMode: mode,
    criticalMemberId: memberLimit.memberId,
    unitUtilization: memberLimit.unitUtilization,
    unitCompressionN,
    unitTopDisplacementM: analysis.maxTopDisplacementM,
    estimatedTopDisplacementAtLimitM: Number.isFinite(criticalForceN)
      ? analysis.maxTopDisplacementM * criticalForceN
      : Number.POSITIVE_INFINITY,
    eigenResidual: analysis.buckling.residual,
  }
}

const minimumCaseBy = (cases, selector) => cases.reduce((best, candidate) => (
  selector(candidate) < selector(best) ? candidate : best
), cases[0])

export function calculateLateralCapacity(model, parameters, options = {}) {
  if (!model?.members?.length || !model?.topNodeIds?.length) {
    throw new Error('Для расчёта боковой нагрузки нужна frame-модель с вершиной')
  }
  const stepDeg = options.stepDeg ?? parameters.lateralCapacityStepDeg
    ?? DEFAULT_LATERAL_CAPACITY_STEP_DEG
  const directions = lateralDirections(stepDeg)
  const frameSystem = options.frameSystem ?? compileFrameSystem(model, parameters)
  const cases = []
  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index]
    cases.push(evaluateDirection(model, parameters, direction, frameSystem))
    options.onProgress?.({
      stage: 'lateral',
      completed: index + 1,
      total: directions.length,
      directionDeg: direction,
    })
  }

  const governing = minimumCaseBy(cases, (item) => item.criticalForceN)
  const memberGoverning = minimumCaseBy(cases, (item) => item.memberLimitForceN)
  const globalBucklingGoverning = minimumCaseBy(cases, (item) => item.globalBucklingForceN)
  const boltGoverning = minimumCaseBy(cases, (item) => item.boltLimitForceN)

  return {
    method: 'unit-horizontal-tip-load-linear-v4-fixed-preload-scaling',
    stepDeg,
    symmetrySectorDeg: ROTATIONAL_SYMMETRY_DEG,
    forceApplication: 'внутренняя нормированная сила 1 Н горизонтально, поровну между тремя узлами верхней треугольной грани',
    excludedLoads: 'ветер, лёд, собственный вес и оборудование',
    craneBoomInterpretation: 'Эквивалентная масса концевого груза для идеализированной консольной стрелы получается как Flim/g. Это поперечный unit-load предел без собственного веса горизонтально ориентированной стрелы и не является паспортной грузоподъёмностью крана.',
    cases,
    governing,
    memberGoverning,
    globalBucklingGoverning,
    boltGoverning,
    criticalForceN: governing.criticalForceN,
    criticalForceKgf: governing.criticalForceKgf,
    idealizedCraneBoomPayloadKg: governing.idealizedCraneBoomPayloadKg,
    governingMode: governing.governingMode,
    directionDeg: governing.directionDeg,
    criticalMemberId: governing.criticalMemberId,
    memberLimitForceN: memberGoverning.memberLimitForceN,
    memberLimitForceKgf: memberGoverning.memberLimitForceKgf,
    memberLimitMode: memberGoverning.memberLimitMode,
    memberLimitDirectionDeg: memberGoverning.directionDeg,
    memberLimitCriticalMemberId: memberGoverning.criticalMemberId,
    globalBucklingForceN: globalBucklingGoverning.globalBucklingForceN,
    globalBucklingForceKgf: globalBucklingGoverning.globalBucklingForceKgf,
    globalBucklingDirectionDeg: globalBucklingGoverning.directionDeg,
    boltLimitForceN: boltGoverning.boltLimitForceN,
    boltLimitForceKgf: boltGoverning.boltLimitForceKgf,
    boltLimitDirectionDeg: boltGoverning.directionDeg,
  }
}
