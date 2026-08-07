import { buildLoadCase } from './loads.js'
import { STANDARD_GRAVITY_M_S2 } from './lateral-capacity.js'
import { analyzeFrame, compileFrameSystem } from './solver.js'

export const WATER_DENSITY_KG_M3 = 1000
export const STATIC_PAYLOAD_BISECTION_ITERATIONS = 18
export const STATIC_PAYLOAD_PROGRESS_STEPS = STATIC_PAYLOAD_BISECTION_ITERATIONS + 3
const MAX_REFERENCE_PAYLOAD_KG = 1e9

function payloadParameters(parameters, payloadMassKg, includeSelfWeight) {
  return {
    ...parameters,
    deadLoadFactor: includeSelfWeight ? parameters.deadLoadFactor : 0,
    windPressurePa: 0,
    windPresetId: 'custom',
    windDirectionDeg: 0,
    windEnvelopeEnabled: false,
    equipmentMassKg: payloadMassKg,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 0,
    extraVerticalLoadN: 0,
    iceThicknessMm: 0,
  }
}

function evaluatePayload(model, parameters, frameSystem, payloadMassKg, includeSelfWeight = true) {
  const caseParameters = payloadParameters(parameters, payloadMassKg, includeSelfWeight)
  const loads = buildLoadCase(model, caseParameters)
  const analysis = analyzeFrame(model, loads, caseParameters, frameSystem)
  return { payloadMassKg, loads, analysis }
}

function memberLimitMode(analysis) {
  const member = analysis.memberResults[analysis.criticalMemberId]
  if (!member) return 'none'
  return member.bucklingUtilization >= member.stressUtilization
    ? 'local-member-buckling'
    : 'material-strength'
}

function stateRatios(analysis) {
  const memberRatio = analysis.maxUtilization
  const globalRatio = Number.isFinite(analysis.buckling.criticalLoadFactor)
    ? 1 / Math.max(analysis.buckling.criticalLoadFactor, Number.EPSILON)
    : 0
  const governingMode = globalRatio >= memberRatio
    ? 'global-buckling'
    : memberLimitMode(analysis)
  return {
    memberRatio,
    globalRatio,
    governingRatio: Math.max(memberRatio, globalRatio),
    governingMode,
    passes: memberRatio <= 1 && globalRatio <= 1,
  }
}

function purePayloadUpperBoundKg(unitAnalysis) {
  const memberLimitKg = unitAnalysis.maxUtilization > Number.EPSILON
    ? 1 / unitAnalysis.maxUtilization
    : Number.POSITIVE_INFINITY
  const globalLimitKg = Number.isFinite(unitAnalysis.buckling.criticalLoadFactor)
    ? unitAnalysis.buckling.criticalLoadFactor
    : Number.POSITIVE_INFINITY
  return {
    memberLimitKg,
    globalLimitKg,
    criticalLimitKg: Math.min(memberLimitKg, globalLimitKg),
  }
}

function topSettlementM(model, analysis) {
  return Math.max(
    0,
    ...model.topNodeIds.map((nodeId) => Math.max(0, -(analysis.displacements[nodeId]?.[2] ?? 0))),
  )
}

function reportProgress(options, completed, label, payloadMassKg = null) {
  options.onProgress?.({
    stage: 'static-payload',
    completed,
    total: STATIC_PAYLOAD_PROGRESS_STEPS,
    label,
    payloadMassKg,
  })
}

function resultFromLimit(model, parameters, base, limit, ratios, reference, bounded, iterations) {
  const gammaPayload = Math.max(parameters.equipmentLoadFactor, Number.EPSILON)
  const configuredEquivalentTopMassKg = Math.max(0, parameters.equipmentMassKg ?? 0)
    + Math.max(0, parameters.extraVerticalLoadN ?? 0) / (STANDARD_GRAVITY_M_S2 * gammaPayload)
  const remainingAdditionalMassKg = Math.max(0, limit.payloadMassKg - configuredEquivalentTopMassKg)
  const waterVolumeM3 = remainingAdditionalMassKg / WATER_DENSITY_KG_M3

  return {
    method: 'gravity-only-top-payload-with-self-weight-v1',
    forceApplication: 'вертикальная сила вниз, поровну между тремя узлами верхней треугольной грани',
    includedLoads: 'собственный вес мачты с коэффициентом постоянной нагрузки и искомая масса на вершине с коэффициентом веса оборудования',
    excludedLoads: 'ветер, лёд, горизонтальные силы и прочие дополнительные нагрузки',
    waterDensityKgM3: WATER_DENSITY_KG_M3,
    maximumTotalTopMassKg: limit.payloadMassKg,
    maximumNominalTopForceN: limit.payloadMassKg * STANDARD_GRAVITY_M_S2,
    maximumDesignTopForceN: limit.payloadMassKg * STANDARD_GRAVITY_M_S2 * gammaPayload,
    configuredEquivalentTopMassKg,
    remainingAdditionalMassKg,
    remainingAdditionalNominalForceN: remainingAdditionalMassKg * STANDARD_GRAVITY_M_S2,
    equivalentWaterVolumeM3: waterVolumeM3,
    equivalentWaterVolumeLiters: waterVolumeM3 * 1000,
    governingMode: ratios.governingMode,
    criticalMemberId: limit.analysis.criticalMemberId,
    utilizationAtLimit: limit.analysis.maxUtilization,
    bucklingFactorAtLimit: limit.analysis.buckling.criticalLoadFactor,
    topSettlementAtLimitM: topSettlementM(model, limit.analysis),
    baseSelfWeightN: base.loads.selfWeightN,
    baseUtilization: base.analysis.maxUtilization,
    baseBucklingFactor: base.analysis.buckling.criticalLoadFactor,
    purePayloadReference: reference,
    bounded,
    iterations,
    diagnostics: {
      relativeResidual: limit.analysis.diagnostics.relativeResidual,
      maximumNodeEquilibriumResidual: limit.analysis.diagnostics.maximumNodeEquilibriumResidual,
      bucklingResidual: limit.analysis.buckling.residual,
      bucklingEigenResidual: limit.analysis.buckling.eigenResidual,
    },
  }
}

export function calculateStaticPayloadCapacity(model, parameters, options = {}) {
  if (!model?.members?.length || !model?.topNodeIds?.length) {
    throw new Error('Для расчёта статической нагрузки нужна frame-модель с вершиной')
  }
  const frameSystem = options.frameSystem ?? compileFrameSystem(model, parameters)

  const unit = evaluatePayload(model, parameters, frameSystem, 1, false)
  const reference = purePayloadUpperBoundKg(unit.analysis)
  reportProgress(options, 1, 'Оценка верхней границы по чистой нагрузке 1 кг', 1)

  const base = evaluatePayload(model, parameters, frameSystem, 0, true)
  const baseRatios = stateRatios(base.analysis)
  reportProgress(options, 2, 'Проверка мачты под собственным весом', 0)

  if (!baseRatios.passes) {
    for (let index = 0; index <= STATIC_PAYLOAD_BISECTION_ITERATIONS; index += 1) {
      reportProgress(options, 3 + index, 'Собственный вес уже достигает расчётного предела', 0)
    }
    return resultFromLimit(
      model,
      parameters,
      base,
      base,
      { ...baseRatios, governingMode: 'self-weight-overlimit' },
      reference,
      true,
      0,
    )
  }

  let upperMassKg = reference.criticalLimitKg
  if (!Number.isFinite(upperMassKg) || upperMassKg <= 0) upperMassKg = MAX_REFERENCE_PAYLOAD_KG
  upperMassKg = Math.min(upperMassKg, MAX_REFERENCE_PAYLOAD_KG)
  const upper = evaluatePayload(model, parameters, frameSystem, upperMassKg, true)
  const upperRatios = stateRatios(upper.analysis)
  reportProgress(options, 3, 'Проверка расчётной верхней границы', upperMassKg)

  let lowMassKg = 0
  let low = base
  let lowRatios = baseRatios
  let highMassKg = upperMassKg
  const bounded = !upperRatios.passes

  if (bounded) {
    for (let iteration = 0; iteration < STATIC_PAYLOAD_BISECTION_ITERATIONS; iteration += 1) {
      const middleMassKg = (lowMassKg + highMassKg) / 2
      const middle = evaluatePayload(model, parameters, frameSystem, middleMassKg, true)
      const middleRatios = stateRatios(middle.analysis)
      if (middleRatios.passes) {
        lowMassKg = middleMassKg
        low = middle
        lowRatios = middleRatios
      } else {
        highMassKg = middleMassKg
      }
      reportProgress(
        options,
        4 + iteration,
        `Уточнение предела ${iteration + 1}/${STATIC_PAYLOAD_BISECTION_ITERATIONS}`,
        middleMassKg,
      )
    }
  } else {
    lowMassKg = upperMassKg
    low = upper
    lowRatios = upperRatios
    for (let iteration = 0; iteration < STATIC_PAYLOAD_BISECTION_ITERATIONS; iteration += 1) {
      reportProgress(options, 4 + iteration, 'Достигнута программная верхняя граница поиска', upperMassKg)
    }
  }

  return resultFromLimit(
    model,
    parameters,
    base,
    { ...low, payloadMassKg: lowMassKg },
    lowRatios,
    reference,
    bounded,
    bounded ? STATIC_PAYLOAD_BISECTION_ITERATIONS : 0,
  )
}
