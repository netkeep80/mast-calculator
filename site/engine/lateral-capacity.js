import { buildLoadCase } from './loads.js'
import { analyzeFrame } from './solver.js'

export const STANDARD_GRAVITY_M_S2 = 9.80665
export const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15
const ROTATIONAL_SYMMETRY_DEG = 120

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

function evaluateDirection(model, parameters, directionDeg) {
  const unitParameters = pureUnitLateralParameters(parameters, directionDeg)
  const loads = buildLoadCase(model, unitParameters)
  const analysis = analyzeFrame(model, loads, unitParameters)
  const memberLimit = governingMemberLimit(analysis)
  const globalBucklingForceN = analysis.buckling.criticalLoadFactor
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
    globalBucklingForceN,
    globalBucklingForceKgf: globalBucklingForceN / STANDARD_GRAVITY_M_S2,
    governingMode,
    criticalMemberId: memberLimit.memberId,
    unitUtilization: memberLimit.unitUtilization,
    unitTopDisplacementM: analysis.maxTopDisplacementM,
    estimatedTopDisplacementAtLimitM: Number.isFinite(criticalForceN)
      ? analysis.maxTopDisplacementM * criticalForceN
      : Number.POSITIVE_INFINITY,
    eigenResidual: analysis.buckling.residual,
  }
}

export function calculateLateralCapacity(model, parameters, options = {}) {
  if (!model?.members?.length || !model?.topNodeIds?.length) {
    throw new Error('Для расчёта боковой нагрузки нужна frame-модель с вершиной')
  }
  const stepDeg = options.stepDeg ?? parameters.lateralCapacityStepDeg
    ?? DEFAULT_LATERAL_CAPACITY_STEP_DEG
  const directions = lateralDirections(stepDeg)
  const cases = directions.map((direction) => evaluateDirection(model, parameters, direction))
  const governing = cases.reduce((best, candidate) => (
    candidate.criticalForceN < best.criticalForceN ? candidate : best
  ), cases[0])

  return {
    method: 'unit-horizontal-tip-load-linear-v1',
    stepDeg,
    symmetrySectorDeg: ROTATIONAL_SYMMETRY_DEG,
    forceApplication: '1 Н горизонтально, поровну между тремя узлами верхней треугольной грани',
    excludedLoads: 'ветер, лёд, собственный вес, оборудование и дополнительные нагрузки',
    cases,
    governing,
    criticalForceN: governing.criticalForceN,
    criticalForceKgf: governing.criticalForceKgf,
    globalBucklingForceN: governing.globalBucklingForceN,
    globalBucklingForceKgf: governing.globalBucklingForceKgf,
    memberLimitForceN: governing.memberLimitForceN,
    memberLimitForceKgf: governing.memberLimitForceKgf,
    governingMode: governing.governingMode,
    directionDeg: governing.directionDeg,
    criticalMemberId: governing.criticalMemberId,
  }
}
