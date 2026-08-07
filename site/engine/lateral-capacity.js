import { buildLoadCase } from './loads.js'
import { analyzeFrame } from './solver.js'

export const STANDARD_GRAVITY_M_S2 = 9.80665
export const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15
const ROTATIONAL_SYMMETRY_DEG = 120
const MIN_COMPRESSION_FOR_GLOBAL_BUCKLING_N = 1e-9

function lateralDirections(stepDeg) {
  const step = Number(stepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 60) {
    throw new Error('Шаг расчёта боковой нагрузки должен быть от 0 до 60°')
  }
  const values = []
  for (let angle = 0; angle < ROTATIONAL_SYMMETRY_DEG - step / 1000; angle += step) {
    values.push(angle)
  }
  return values
}

function pureUnitLateralParameters(parameters, directionDeg) {
  return {
    ...parameters,
    // Отдельный проверяемый испытательный случай: только горизонтальная сила
    // 1 Н в геометрической вершине. Нормирование позволяет сразу получить
    // предельную силу из линейного расчёта без итерационного наращивания.
    deadLoadFactor: 0,
    windPressurePa: 0,
    windPresetId: 'custom',
    windDirectionDeg: directionDeg,
    windEnvelopeEnabled: false,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 1,
    extraVerticalLoadN: 0,
    iceThicknessMm: 0,
  }
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

function evaluateDirection(model, parameters, directionDeg) {
  const unitParameters = pureUnitLateralParameters(parameters, directionDeg)
  const loads = buildLoadCase(model, unitParameters)
  const analysis = analyzeFrame(model, loads, unitParameters)
  const memberLimit = governingMemberLimit(analysis)
  const unitCompressionN = meaningfulCompressionN(analysis)

  // K_G имеет физический смысл для потери устойчивости от предварительного
  // сжатия. У чистой поперечно нагруженной консоли осевое сжатие теоретически
  // равно нулю, но машинное округление может создать ~1e-15 Н и затем ложное
  // конечное собственное значение. В таком случае глобальный buckling здесь
  // неприменим и считается бесконечным; для решётчатой мачты боковая сила
  // создаёт реальные растянутые/сжатые раскосы, поэтому eigen-check остаётся.
  const globalBucklingForceN = unitCompressionN > MIN_COMPRESSION_FOR_GLOBAL_BUCKLING_N
    ? analysis.buckling.criticalLoadFactor
    : Number.POSITIVE_INFINITY
  const criticalForceN = Math.min(memberLimit.forceN, globalBucklingForceN)
  const governingMode = globalBucklingForceN <= memberLimit.forceN
    ? 'global-buckling'
    : memberLimit.mode

  return {
    directionDeg,
    criticalForceN,
    criticalForceKgf: criticalForceN / STANDARD_GRAVITY_M_S2,
    memberLimitForceN: memberLimit.forceN,
    memberLimitForceKgf: memberLimit.forceN / STANDARD_GRAVITY_M_S2,
    memberLimitMode: memberLimit.mode,
    globalBucklingForceN,
    globalBucklingForceKgf: globalBucklingForceN / STANDARD_GRAVITY_M_S2,
    governingMode,
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
  const cases = directions.map((direction) => evaluateDirection(model, parameters, direction))

  // Это три разные огибающие. Худшее направление по первому отказу может не
  // совпасть с направлением минимального eigen-buckling, поэтому нельзя брать
  // Fglobal из общего governing case.
  const governing = minimumCaseBy(cases, (item) => item.criticalForceN)
  const memberGoverning = minimumCaseBy(cases, (item) => item.memberLimitForceN)
  const globalBucklingGoverning = minimumCaseBy(cases, (item) => item.globalBucklingForceN)

  return {
    method: 'unit-horizontal-tip-load-linear-v1',
    stepDeg,
    symmetrySectorDeg: ROTATIONAL_SYMMETRY_DEG,
    forceApplication: '1 Н горизонтально, поровну между тремя узлами верхней треугольной грани',
    excludedLoads: 'ветер, лёд, собственный вес, оборудование и дополнительные нагрузки',
    cases,
    governing,
    memberGoverning,
    globalBucklingGoverning,

    // Первый из всех рассматриваемых пределов, независимо от механизма.
    criticalForceN: governing.criticalForceN,
    criticalForceKgf: governing.criticalForceKgf,
    governingMode: governing.governingMode,
    directionDeg: governing.directionDeg,
    criticalMemberId: governing.criticalMemberId,

    // Отдельная огибающая по прочности/локальной устойчивости ребра.
    memberLimitForceN: memberGoverning.memberLimitForceN,
    memberLimitForceKgf: memberGoverning.memberLimitForceKgf,
    memberLimitMode: memberGoverning.memberLimitMode,
    memberLimitDirectionDeg: memberGoverning.directionDeg,
    memberLimitCriticalMemberId: memberGoverning.criticalMemberId,

    // Отдельная огибающая именно по общей линейной потере устойчивости.
    globalBucklingForceN: globalBucklingGoverning.globalBucklingForceN,
    globalBucklingForceKgf: globalBucklingGoverning.globalBucklingForceKgf,
    globalBucklingDirectionDeg: globalBucklingGoverning.directionDeg,
  }
}
