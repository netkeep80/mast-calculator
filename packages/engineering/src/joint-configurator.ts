import type { ResolvedProject } from '../../domain/contracts.js'
import {
  BOLT_PROPERTY_CLASS_IDS,
  BOLT_SIZES,
  buildJointHardwareGeometry,
  DEFAULT_THREAD_ENGAGEMENT_FACTOR,
  maximumModuleDiameterMm,
  suggestedWeldLegMm,
  type BoltPropertyClassId,
  type JointHardwareOptions,
} from '../../domain/index.js'
import {
  calculateBoltCapacity,
  evaluateBoltAcrossDemands,
  type BoltCapacityInput,
  type BoltDemand,
} from './bolt-check.js'
import { splitJointDemandForBolt } from './joint-demand.js'
import { checkJointNutSections } from './joint-section-check.js'
import { resolveJointStrengthParameters } from './joint-strength-parameters.js'
import { recommendWeldConsumable } from './weld-check.js'

export const JOINT_CONFIGURATOR_MODES = Object.freeze([
  Object.freeze({ id: 'auto', label: 'Автоподбор узла' }),
  Object.freeze({ id: 'manual', label: 'Ручная конфигурация' }),
])

export const AUTO_BOLT_CLASS_ORDER = Object.freeze([
  '8.8', '10.9', '12.9', '5.6', '5.8',
] as const satisfies readonly BoltPropertyClassId[])

export const AUTO_MAX_PRELOAD_UTILIZATION = 0.55

type JointGeometry = ReturnType<typeof buildJointHardwareGeometry>

export interface JointResultant {
  forceGlobalN: readonly number[]
  momentGlobalNm: readonly number[]
  readonly [key: string]: unknown
}

interface GeometryOverrides {
  threadEngagementFactor?: number
  clearanceNutThreadMm?: unknown
  boltLengthMm?: number | null
}

interface CandidateOptions {
  automaticTorque?: boolean
}

function automaticTighteningTorqueNm(
  parameters: ResolvedProject,
  boltClass: string,
  diameterMm: number,
): number {
  const strength = resolveJointStrengthParameters(parameters)
  const requestedTorqueNm = strength.jointTighteningTorqueNm
  if (!(requestedTorqueNm > 0)) return 0
  const capacity = calculateBoltCapacity({
    diameterMm,
    boltClass,
    connectionConditionFactor: parameters.connectionConditionFactor,
    shearPlanes: parameters.jointBoltShearPlanes,
    tighteningTorqueNm: 0,
    nutFactor: strength.jointNutFactor,
    preloadVariation: strength.jointPreloadVariation,
  })
  if (!(capacity.designTorqueAtTensionCapacityNm != null && capacity.designTorqueAtTensionCapacityNm > 0)) return 0
  return Math.min(
    requestedTorqueNm,
    capacity.designTorqueAtTensionCapacityNm * AUTO_MAX_PRELOAD_UTILIZATION,
  )
}

function boltEvaluationOptions(
  parameters: ResolvedProject,
  geometry: JointGeometry,
  boltClass: string,
  tighteningTorqueNm: number | null = null,
): BoltCapacityInput {
  const strength = resolveJointStrengthParameters(parameters)
  return {
    diameterMm: geometry.bolt.diameterMm,
    boltClass,
    connectionConditionFactor: parameters.connectionConditionFactor,
    shearPlanes: parameters.jointBoltShearPlanes,
    tighteningTorqueNm: tighteningTorqueNm ?? strength.jointTighteningTorqueNm,
    nutFactor: strength.jointNutFactor,
    preloadVariation: strength.jointPreloadVariation,
  }
}

function demandsForGeometry(resultants: readonly JointResultant[], geometry: JointGeometry) {
  return resultants.map((resultant) => ({
    ...resultant,
    ...splitJointDemandForBolt(resultant.forceGlobalN, resultant.momentGlobalNm, {
      boltAxis: [0, 0, 1],
      jointEffectiveRadiusMm: geometry.effectiveRadiusMm,
    }),
  }))
}

function evaluateCandidate(
  resultants: readonly JointResultant[],
  parameters: ResolvedProject,
  boltClass: string,
  diameterMm: number,
  geometryOverrides: GeometryOverrides = {},
  candidateOptions: CandidateOptions = {},
) {
  const hardwareOptions: JointHardwareOptions = {
    boltDiameterMm: diameterMm,
    boltClass,
    threadEngagementFactor: geometryOverrides.threadEngagementFactor ?? DEFAULT_THREAD_ENGAGEMENT_FACTOR,
    ...(geometryOverrides.clearanceNutThreadMm === undefined
      ? {}
      : { clearanceNutThreadMm: geometryOverrides.clearanceNutThreadMm }),
    ...(geometryOverrides.boltLengthMm === undefined
      ? {}
      : { boltLengthMm: geometryOverrides.boltLengthMm }),
  }
  const geometry = buildJointHardwareGeometry(hardwareOptions)
  const strength = resolveJointStrengthParameters(parameters)
  const tighteningTorqueNm = candidateOptions.automaticTorque === false
    ? strength.jointTighteningTorqueNm
    : automaticTighteningTorqueNm(parameters, boltClass, geometry.bolt.diameterMm)
  const evaluationOptions = boltEvaluationOptions(
    parameters,
    geometry,
    boltClass,
    tighteningTorqueNm,
  )
  const referenceBarDiameterMm = maximumModuleDiameterMm(parameters)
  const nutSections = checkJointNutSections(geometry, referenceBarDiameterMm, {
    requiredRatio: strength.jointNutSectionAreaRatio,
  })
  const demands = demandsForGeometry(resultants, geometry)
  const evaluation = demands.length > 0
    ? evaluateBoltAcrossDemands(demands as readonly BoltDemand[], evaluationOptions)
    : {
        options: evaluationOptions,
        checks: [],
        governingDemand: null,
        governingCheck: null,
        utilization: 0,
        passes: true,
      }
  return {
    boltClass,
    diameterMm: geometry.bolt.diameterMm,
    pitchMm: geometry.bolt.pitchMm,
    referenceBarDiameterMm,
    tighteningTorqueNm,
    requestedTighteningTorqueNm: strength.jointTighteningTorqueNm,
    automaticTorque: candidateOptions.automaticTorque !== false,
    torqueWasLimited: tighteningTorqueNm + 1e-9 < strength.jointTighteningTorqueNm,
    geometry,
    nutSections,
    demands,
    evaluation,
    passesGeometry: geometry.passes,
    passesNutSections: nutSections.passes,
    passesBolt: evaluation.passes,
    passes: geometry.passes && nutSections.passes && evaluation.passes,
  }
}

type JointCandidate = ReturnType<typeof evaluateCandidate>

interface FailedJointCandidate {
  boltClass: string
  diameterMm: number
  pitchMm: number
  geometry: null
  nutSections: null
  demands: readonly never[]
  evaluation: null
  passes: false
  error: string
}

interface ClassRecommendation {
  boltClass: string
  recommended: JointCandidate | null
  candidates: Array<JointCandidate | FailedJointCandidate>
}

function recommendationForClass(
  resultants: readonly JointResultant[],
  parameters: ResolvedProject,
  boltClass: string,
): ClassRecommendation {
  const candidates: Array<JointCandidate | FailedJointCandidate> = []
  for (const size of BOLT_SIZES) {
    try {
      candidates.push(evaluateCandidate(resultants, parameters, boltClass, size.diameterMm))
    } catch (error) {
      candidates.push({
        boltClass,
        diameterMm: size.diameterMm,
        pitchMm: size.pitchMm,
        geometry: null,
        nutSections: null,
        demands: [],
        evaluation: null,
        passes: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const recommended = candidates.find((candidate): candidate is JointCandidate => (
    candidate.passes && candidate.geometry != null && candidate.nutSections != null && candidate.evaluation != null
  )) ?? null
  return {
    boltClass,
    recommended,
    candidates,
  }
}

function allClassRecommendations(
  resultants: readonly JointResultant[],
  parameters: ResolvedProject,
): ClassRecommendation[] {
  return BOLT_PROPERTY_CLASS_IDS.map((boltClass) => recommendationForClass(resultants, parameters, boltClass))
}

function automaticBoltConfiguration(
  resultants: readonly JointResultant[],
  parameters: ResolvedProject,
  recommendations: readonly ClassRecommendation[],
): JointCandidate {
  if (resultants.length === 0) {
    return evaluateCandidate(
      resultants,
      parameters,
      parameters.jointBoltClass,
      parameters.jointBoltDiameterMm,
    )
  }
  for (const boltClass of AUTO_BOLT_CLASS_ORDER) {
    const recommendation = recommendations.find((item) => item.boltClass === boltClass)
    if (recommendation?.recommended) return recommendation.recommended
  }
  const fallbackClass = AUTO_BOLT_CLASS_ORDER.find((id) => BOLT_PROPERTY_CLASS_IDS.includes(id))
    ?? BOLT_PROPERTY_CLASS_IDS.at(-1)!
  return evaluateCandidate(
    resultants,
    parameters,
    fallbackClass,
    BOLT_SIZES.at(-1)!.diameterMm,
  )
}

function manualBoltConfiguration(
  resultants: readonly JointResultant[],
  parameters: ResolvedProject,
): JointCandidate {
  return evaluateCandidate(
    resultants,
    parameters,
    parameters.jointBoltClass,
    parameters.jointBoltDiameterMm,
    {
      clearanceNutThreadMm: parameters.jointClearanceNutThreadMm,
      boltLengthMm: parameters.jointBoltLengthMm,
      threadEngagementFactor: parameters.jointThreadEngagementFactor,
    },
    { automaticTorque: false },
  )
}

function weldConfiguration(
  parameters: ResolvedProject,
  mode: ResolvedProject['jointConfiguratorMode'],
  baseMetalRunMPa: number,
) {
  if (mode === 'manual') {
    return {
      consumableId: parameters.weldConsumableId,
      weldLegMm: parameters.weldLegMm,
      segmentsPerEnd: parameters.weldSegmentsPerEnd,
      automatic: false,
    }
  }
  const electrode = recommendWeldConsumable({ process: 'electrode', baseMetalRunMPa }).recommended
  return {
    consumableId: electrode?.id ?? parameters.weldConsumableId,
    weldLegMm: suggestedWeldLegMm(maximumModuleDiameterMm(parameters))!,
    segmentsPerEnd: 3,
    automatic: true,
  }
}

export interface JointConfiguratorOptions {
  baseMetalRunMPa?: unknown
}

export function configureIntermoduleJoint(
  resultants: readonly JointResultant[],
  parameters: ResolvedProject,
  options: JointConfiguratorOptions = {},
) {
  const mode: ResolvedProject['jointConfiguratorMode'] = parameters.jointConfiguratorMode === 'manual' ? 'manual' : 'auto'
  const strength = resolveJointStrengthParameters(parameters)
  const effectiveParameters: ResolvedProject = { ...parameters, ...strength }
  const recommendationsByClass = allClassRecommendations(resultants, effectiveParameters)
  const selected = mode === 'auto'
    ? automaticBoltConfiguration(resultants, effectiveParameters, recommendationsByClass)
    : manualBoltConfiguration(resultants, effectiveParameters)
  const baseMetalRunMPa = Number(options.baseMetalRunMPa)
  const weld = weldConfiguration(effectiveParameters, mode, baseMetalRunMPa)
  const geometry = selected.geometry
  const resolvedParameters = {
    ...strength,
    jointBoltDiameterMm: selected.diameterMm,
    jointBoltClass: selected.boltClass,
    jointClearanceNutThreadMm: geometry.bottomClearanceNut.threadDiameterMm,
    jointBoltLengthMm: geometry.bolt.lengthMm,
    jointThreadEngagementFactor: geometry.threadEngagementFactor,
    jointEffectiveRadiusMm: geometry.effectiveRadiusMm,
    jointTighteningTorqueNm: selected.tighteningTorqueNm,
    weldConsumableId: weld.consumableId,
    weldLegMm: weld.weldLegMm,
    weldSegmentsPerEnd: weld.segmentsPerEnd,
  }

  return {
    method: 'self-configuring-two-nut-joint-v3' as const,
    mode,
    modeLabel: mode === 'auto' ? 'Автоподбор узла' : 'Ручная конфигурация',
    selected,
    geometry,
    nutSections: selected.nutSections,
    strengthParameters: strength,
    referenceBarDiameterMm: maximumModuleDiameterMm(effectiveParameters),
    weld,
    recommendationsByClass,
    resolvedParameters,
    passesGeometry: geometry.passes,
    passesNutSections: selected.nutSections.passes,
    passesBolt: selected.evaluation.passes,
    passes: geometry.passes && selected.nutSections.passes && selected.evaluation.passes,
    explanation: mode === 'auto'
      ? `Программа выбрала болт, обе гайки, длину, сварку и безопасный момент затяжки. Для смешанного профиля геометрический запас гаек и базовый катет проверяются по максимальному диаметру ребра. Запрошено ${strength.jointTighteningTorqueNm.toFixed(0)} Н·м, для выбранного кандидата принято ${selected.tighteningTorqueNm.toFixed(0)} Н·м; максимальный преднатяг ограничен ${Math.round(AUTO_MAX_PRELOAD_UTILIZATION * 100)}% расчётной растягивающей способности до учёта внешнего усилия.`
      : 'Проверяется выбранная пользователем сборка и заданный момент затяжки без автоматического уменьшения. Соединительная гайка верхнего узла имеет ту же резьбу, что и болт; гайка ножки должна иметь большую резьбу, свободный проход болта и достаточное нетто-сечение относительно максимального диаметра ребра мачты.',
  }
}

export function applyResolvedJointParameters(
  parameters: ResolvedProject,
  configurator: ReturnType<typeof configureIntermoduleJoint>,
  mode: ResolvedProject['jointConfiguratorMode'] = parameters.jointConfiguratorMode,
): ResolvedProject {
  return {
    ...parameters,
    ...configurator.resolvedParameters,
    jointConfiguratorMode: mode,
  }
}

export function jointGeometryFromParameters(parameters: ResolvedProject): JointGeometry {
  return buildJointHardwareGeometry({
    boltDiameterMm: parameters.jointBoltDiameterMm,
    boltClass: parameters.jointBoltClass,
    clearanceNutThreadMm: parameters.jointClearanceNutThreadMm,
    boltLengthMm: parameters.jointBoltLengthMm,
    threadEngagementFactor: parameters.jointThreadEngagementFactor,
  })
}
