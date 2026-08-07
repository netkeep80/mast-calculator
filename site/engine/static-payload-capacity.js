import { selectedBoltUtilizationForAnalysis } from './connection-check.js'
import { buildLoadCase } from './loads.js'
import { STANDARD_GRAVITY_M_S2 } from './lateral-capacity.js'
import { analyzeFrame, compileFrameSystem } from './solver.js'

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
    iceThicknessMm: 0,
  }
}

function evaluatePayload(model, parameters, frameSystem, payloadMassKg, includeSelfWeight = true) {
  const caseParameters = payloadParameters(parameters, payloadMassKg, includeSelfWeight)
  const loads = buildLoadCase(model, caseParameters)
  const analysis = analyzeFrame(model, loads, caseParameters, frameSystem)
  return { payloadMassKg, loads, analysis, parameters: caseParameters }
}

function memberLimitMode(analysis) {
  const member = analysis.memberResults[analysis.criticalMemberId]
  if (!member) return 'none'
  return member.bucklingUtilization >= member.stressUtilization
    ? 'local-member-buckling'
    : 'material-strength'
}

function stateRatios(model, parameters, analysis) {
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
    passes: memberRatio <= 1 && globalRatio <= 1 && boltRatio <= 1,
  }
}

function purePayloadUpperBoundKg(model, unit) {
  const unitRatios = stateRatios(model, unit.parameters, unit.analysis)
  const memberLimitKg = unitRatios.memberRatio > Number.EPSILON
    ? 1 / unitRatios.memberRatio
    : Number.POSITIVE_INFINITY
  const globalLimitKg = unitRatios.globalRatio > Number.EPSILON
    ? 1 / unitRatios.globalRatio
    : Number.POSITIVE_INFINITY
  const boltLimitKg = unitRatios.boltRatio > Number.EPSILON
    ? 1 / unitRatios.boltRatio
    : Number.POSITIVE_INFINITY
  return {
    memberLimitKg,
    globalLimitKg,
    boltLimitKg,
    criticalLimitKg: Math.min(memberLimitKg, globalLimitKg, boltLimitKg),
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
  const configuredTopEquipmentMassKg = Math.max(0, Number(parameters.equipmentMassKg ?? 0))
  const maximumTopEquipmentMassKg = limit.payloadMassKg
  const additionalTopEquipmentMassKg = Math.max(
    0,
    maximumTopEquipmentMassKg - configuredTopEquipmentMassKg,
  )
  const baseRatios = stateRatios(model, base.parameters, base.analysis)

  return {
    method: 'gravity-only-top-equipment-mass-with-self-weight-v3-with-bolt',
    forceApplication: 'масса оборудования/груза вертикально вниз, поровну между тремя узлами верхней треугольной грани',
    includedLoads: 'собственный вес мачты с коэффициентом постоянной нагрузки, искомая масса на вершине с коэффициентом веса оборудования и выбранный межмодульный болт',
    excludedLoads: 'ветер и лёд; это отдельный gravity-only предел массы вершины',
    maximumTopEquipmentMassKg,
    configuredTopEquipmentMassKg,
    additionalTopEquipmentMassKg,
    maximumNominalTopForceN: maximumTopEquipmentMassKg * STANDARD_GRAVITY_M_S2,
    maximumDesignTopForceN: maximumTopEquipmentMassKg * STANDARD_GRAVITY_M_S2 * gammaPayload,
    additionalTopEquipmentNominalForceN: additionalTopEquipmentMassKg * STANDARD_GRAVITY_M_S2,

    // Compatibility aliases для внутреннего snapshot/UI предыдущих версий.
    // Они имеют тот же однозначный смысл массы и больше не включают пересчёт
    // произвольной дополнительной вертикальной силы.
    maximumTotalTopMassKg: maximumTopEquipmentMassKg,
    configuredEquivalentTopMassKg: configuredTopEquipmentMassKg,
    remainingAdditionalMassKg: additionalTopEquipmentMassKg,
    remainingAdditionalNominalForceN: additionalTopEquipmentMassKg * STANDARD_GRAVITY_M_S2,

    governingMode: ratios.governingMode,
    criticalMemberId: limit.analysis.criticalMemberId,
    utilizationAtLimit: limit.analysis.maxUtilization,
    boltUtilizationAtLimit: ratios.boltRatio,
    bucklingFactorAtLimit: limit.analysis.buckling.criticalLoadFactor,
    topSettlementAtLimitM: topSettlementM(model, limit.analysis),
    baseSelfWeightN: base.loads.selfWeightN,
    baseUtilization: base.analysis.maxUtilization,
    baseBoltUtilization: baseRatios.boltRatio,
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
  const reference = purePayloadUpperBoundKg(model, unit)
  reportProgress(options, 1, 'Оценка верхней границы по чистой нагрузке 1 кг', 1)

  const base = evaluatePayload(model, parameters, frameSystem, 0, true)
  const baseRatios = stateRatios(model, base.parameters, base.analysis)
  reportProgress(options, 2, 'Проверка мачты под собственным весом и межмодульного болта', 0)

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
  const upperRatios = stateRatios(model, upper.parameters, upper.analysis)
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
      const middleRatios = stateRatios(model, middle.parameters, middle.analysis)
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
