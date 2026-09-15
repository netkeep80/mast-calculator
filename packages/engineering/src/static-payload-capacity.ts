import type { ResolvedProject } from '../../domain/contracts.js'
import {
  evaluateBoltSystemForAnalysis,
  selectedBoltUtilizationForAnalysis,
} from './connection-check.js'
import {
  buildLoadCase,
  compileFrameSystem,
  type GeneratedMastModel,
} from '../../structural-analysis/index.js'
import { STANDARD_GRAVITY_M_S2 } from './lateral-capacity.js'
import { analyzeCheckedFrame } from './member-check.js'

export const STATIC_PAYLOAD_BISECTION_ITERATIONS = 18
export const STATIC_PAYLOAD_PROGRESS_STEPS = STATIC_PAYLOAD_BISECTION_ITERATIONS + 3
const MAX_REFERENCE_PAYLOAD_KG = 1e9

type FrameSystem = ReturnType<typeof compileFrameSystem>
type CheckedAnalysis = ReturnType<typeof analyzeCheckedFrame>
type PayloadState = ReturnType<typeof evaluatePayload>
type StateRatios = ReturnType<typeof stateRatios>
type PayloadReference = ReturnType<typeof purePayloadUpperBoundKg>

export interface StaticPayloadProgress {
  stage: 'static-payload'
  completed: number
  total: number
  label: string
  payloadMassKg: number | null
}

export interface StaticPayloadCapacityOptions {
  frameSystem?: FrameSystem
  onProgress?: (progress: StaticPayloadProgress) => void
}

function payloadParameters(
  parameters: ResolvedProject,
  payloadMassKg: number,
  includeSelfWeight: boolean,
): ResolvedProject {
  return {
    ...parameters,
    steelSelfWeightLoadFactor: includeSelfWeight ? parameters.steelSelfWeightLoadFactor : 0,
    windPressurePa: 0,
    windPresetId: 'custom',
    windDirectionDeg: 0,
    windEnvelopeEnabled: false,
    equipmentMassKg: payloadMassKg,
    equipmentWindAreaM2: 0,
    iceThicknessMm: 0,
  }
}

function evaluatePayload(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  frameSystem: FrameSystem,
  payloadMassKg: number,
  includeSelfWeight = true,
) {
  const caseParameters = payloadParameters(parameters, payloadMassKg, includeSelfWeight)
  const loads = buildLoadCase(model, caseParameters)
  const analysis = analyzeCheckedFrame(model, loads, caseParameters, frameSystem)
  return { payloadMassKg, loads, analysis, parameters: caseParameters }
}

function memberLimitMode(analysis: CheckedAnalysis) {
  const member = analysis.criticalMemberId == null
    ? undefined
    : analysis.memberResults[analysis.criticalMemberId]
  if (!member) return 'none' as const
  return (member.bucklingUtilization ?? 0) >= (member.stressUtilization ?? 0)
    ? 'local-member-buckling' as const
    : 'material-strength' as const
}

function stateRatios(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  analysis: CheckedAnalysis,
) {
  const memberRatio = analysis.maxUtilization ?? 0
  const globalRatio = Number.isFinite(analysis.buckling.criticalLoadFactor)
    ? 1 / Math.max(analysis.buckling.criticalLoadFactor, Number.EPSILON)
    : 0
  const boltRatio = selectedBoltUtilizationForAnalysis(model, analysis, parameters)
  const governingRatio = Math.max(memberRatio, globalRatio, boltRatio)
  let governingMode: string = memberLimitMode(analysis)
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

function selectedBoltExternalLoadFactor(
  model: GeneratedMastModel,
  analysis: CheckedAnalysis,
  parameters: ResolvedProject,
): number {
  const evaluation = evaluateBoltSystemForAnalysis(model, analysis, parameters)
  if (!evaluation.applicable) return Number.POSITIVE_INFINITY
  if (evaluation.geometry?.passes === false || evaluation.nutSections?.passes === false) return 0
  return Math.min(...evaluation.checks.map(({ check }) => check.loadFactorToDesignLimit))
}

function purePayloadUpperBoundKg(model: GeneratedMastModel, unit: PayloadState) {
  const unitRatios = stateRatios(model, unit.parameters, unit.analysis)
  const memberLimitKg = unitRatios.memberRatio > Number.EPSILON
    ? 1 / unitRatios.memberRatio
    : Number.POSITIVE_INFINITY
  const globalLimitKg = unitRatios.globalRatio > Number.EPSILON
    ? 1 / unitRatios.globalRatio
    : Number.POSITIVE_INFINITY
  const boltLimitKg = selectedBoltExternalLoadFactor(model, unit.analysis, unit.parameters)
  return {
    memberLimitKg,
    globalLimitKg,
    boltLimitKg,
    criticalLimitKg: Math.min(memberLimitKg, globalLimitKg, boltLimitKg),
  }
}

function topSettlementM(model: GeneratedMastModel, analysis: CheckedAnalysis): number {
  return Math.max(
    0,
    ...model.topNodeIds.map((nodeId) => Math.max(0, -(analysis.displacements[nodeId]?.[2] ?? 0))),
  )
}

function reportProgress(
  options: StaticPayloadCapacityOptions,
  completed: number,
  label: string,
  payloadMassKg: number | null = null,
): void {
  options.onProgress?.({
    stage: 'static-payload',
    completed,
    total: STATIC_PAYLOAD_PROGRESS_STEPS,
    label,
    payloadMassKg,
  })
}

function resultFromLimit(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  base: PayloadState,
  limit: PayloadState,
  ratios: StateRatios,
  reference: PayloadReference,
  bounded: boolean,
  iterations: number,
) {
  const gammaPayload = Math.max(parameters.equipmentLoadFactor, Number.EPSILON)
  const configuredTopEquipmentMassKg = Math.max(0, Number(parameters.equipmentMassKg ?? 0))
  const maximumTopEquipmentMassKg = limit.payloadMassKg
  const additionalTopEquipmentMassKg = Math.max(
    0,
    maximumTopEquipmentMassKg - configuredTopEquipmentMassKg,
  )
  const baseRatios = stateRatios(model, base.parameters, base.analysis)

  return {
    method: 'gravity-only-top-equipment-mass-with-self-weight-v4-fixed-preload-scaling' as const,
    forceApplication: 'масса оборудования/груза вертикально вниз, поровну между тремя узлами верхней треугольной грани',
    includedLoads: 'собственный вес мачты с коэффициентом постоянной нагрузки, искомая масса на вершине с коэффициентом веса оборудования и выбранный межмодульный болт',
    excludedLoads: 'ветер и лёд; это отдельный gravity-only предел массы вершины',
    maximumTopEquipmentMassKg,
    configuredTopEquipmentMassKg,
    additionalTopEquipmentMassKg,
    maximumNominalTopForceN: maximumTopEquipmentMassKg * STANDARD_GRAVITY_M_S2,
    maximumDesignTopForceN: maximumTopEquipmentMassKg * STANDARD_GRAVITY_M_S2 * gammaPayload,
    additionalTopEquipmentNominalForceN: additionalTopEquipmentMassKg * STANDARD_GRAVITY_M_S2,
    maximumTotalTopMassKg: maximumTopEquipmentMassKg,
    configuredEquivalentTopMassKg: configuredTopEquipmentMassKg,
    remainingAdditionalMassKg: additionalTopEquipmentMassKg,
    remainingAdditionalNominalForceN: additionalTopEquipmentMassKg * STANDARD_GRAVITY_M_S2,
    governingMode: ratios.governingMode,
    criticalMemberId: limit.analysis.criticalMemberId ?? null,
    utilizationAtLimit: limit.analysis.maxUtilization ?? 0,
    boltUtilizationAtLimit: ratios.boltRatio,
    bucklingFactorAtLimit: limit.analysis.buckling.criticalLoadFactor,
    topSettlementAtLimitM: topSettlementM(model, limit.analysis),
    baseSelfWeightN: base.loads.selfWeightN,
    baseUtilization: base.analysis.maxUtilization ?? 0,
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

export function calculateStaticPayloadCapacity(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  options: StaticPayloadCapacityOptions = {},
) {
  if (!model.members.length || !model.topNodeIds.length) {
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
