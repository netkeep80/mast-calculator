import {
  BOLT_PROPERTY_CLASS_IDS,
  BOLT_SIZES,
} from './connection-catalog.js'
import { evaluateBoltAcrossDemands } from './bolt-check.js'
import {
  buildJointHardwareGeometry,
  DEFAULT_THREAD_ENGAGEMENT_FACTOR,
  suggestedWeldLegMm,
} from './joint-hardware-catalog.js'
import { splitJointDemandForBolt } from './joint-demand.js'
import { checkJointNutSections } from './joint-section-check.js'
import { resolveJointStrengthParameters } from './joint-strength-parameters.js'
import { recommendWeldConsumable } from './weld-check.js'

export const JOINT_CONFIGURATOR_MODES = Object.freeze([
  Object.freeze({ id: 'auto', label: 'Автоподбор узла' }),
  Object.freeze({ id: 'manual', label: 'Ручная конфигурация' }),
])

// 8.8 выбран первым как практический базовый класс. Повышенные классы
// используются только если стандартный ряд 8.8 не проходит. 5.6 остаётся
// доступным ручному режиму и рекомендациям, но не вытесняет 8.8 в автоподборе.
export const AUTO_BOLT_CLASS_ORDER = Object.freeze(['8.8', '10.9', '12.9', '5.6', '5.8'])

function boltEvaluationOptions(parameters, geometry, boltClass) {
  const strength = resolveJointStrengthParameters(parameters)
  return {
    diameterMm: geometry.bolt.diameterMm,
    boltClass,
    connectionConditionFactor: parameters.connectionConditionFactor,
    shearPlanes: parameters.jointBoltShearPlanes,
    tighteningTorqueNm: strength.jointTighteningTorqueNm,
    nutFactor: strength.jointNutFactor,
    preloadVariation: strength.jointPreloadVariation,
  }
}

function demandsForGeometry(resultants, geometry) {
  return resultants.map((resultant) => ({
    ...resultant,
    ...splitJointDemandForBolt(resultant.forceGlobalN, resultant.momentGlobalNm, {
      boltAxis: [0, 0, 1],
      jointEffectiveRadiusMm: geometry.effectiveRadiusMm,
    }),
  }))
}

function evaluateCandidate(resultants, parameters, boltClass, diameterMm, geometryOverrides = {}) {
  const geometry = buildJointHardwareGeometry({
    boltDiameterMm: diameterMm,
    boltClass,
    threadEngagementFactor: geometryOverrides.threadEngagementFactor ?? DEFAULT_THREAD_ENGAGEMENT_FACTOR,
    clearanceNutThreadMm: geometryOverrides.clearanceNutThreadMm,
    boltLengthMm: geometryOverrides.boltLengthMm,
  })
  const strength = resolveJointStrengthParameters(parameters)
  const nutSections = checkJointNutSections(geometry, parameters.barDiameterMm, {
    requiredRatio: strength.jointNutSectionAreaRatio,
  })
  const demands = demandsForGeometry(resultants, geometry)
  const evaluation = demands.length > 0
    ? evaluateBoltAcrossDemands(demands, boltEvaluationOptions(parameters, geometry, boltClass))
    : {
        options: boltEvaluationOptions(parameters, geometry, boltClass),
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

function recommendationForClass(resultants, parameters, boltClass) {
  const candidates = []
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
  return {
    boltClass,
    recommended: candidates.find((candidate) => candidate.passes) ?? null,
    candidates,
  }
}

function allClassRecommendations(resultants, parameters) {
  return BOLT_PROPERTY_CLASS_IDS.map((boltClass) => recommendationForClass(resultants, parameters, boltClass))
}

function automaticBoltConfiguration(resultants, parameters, recommendations) {
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
    ?? BOLT_PROPERTY_CLASS_IDS.at(-1)
  return evaluateCandidate(
    resultants,
    parameters,
    fallbackClass,
    BOLT_SIZES.at(-1).diameterMm,
  )
}

function manualBoltConfiguration(resultants, parameters) {
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
  )
}

function weldConfiguration(parameters, mode, baseMetalRunMPa) {
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
    weldLegMm: suggestedWeldLegMm(parameters.barDiameterMm),
    segmentsPerEnd: 3,
    automatic: true,
  }
}

export function configureIntermoduleJoint(resultants, parameters, options = {}) {
  const mode = parameters.jointConfiguratorMode === 'manual' ? 'manual' : 'auto'
  const strength = resolveJointStrengthParameters(parameters)
  const effectiveParameters = { ...parameters, ...strength }
  const recommendationsByClass = allClassRecommendations(resultants, effectiveParameters)
  const selected = mode === 'auto'
    ? automaticBoltConfiguration(resultants, effectiveParameters, recommendationsByClass)
    : manualBoltConfiguration(resultants, effectiveParameters)
  const baseMetalRunMPa = Number(options.baseMetalRunMPa)
  const weld = weldConfiguration(effectiveParameters, mode, baseMetalRunMPa)
  const geometry = selected.geometry
  const resolvedParameters = {
    jointBoltDiameterMm: selected.diameterMm,
    jointBoltClass: selected.boltClass,
    jointClearanceNutThreadMm: geometry.bottomClearanceNut.threadDiameterMm,
    jointBoltLengthMm: geometry.bolt.lengthMm,
    jointThreadEngagementFactor: geometry.threadEngagementFactor,
    jointEffectiveRadiusMm: geometry.effectiveRadiusMm,
    weldConsumableId: weld.consumableId,
    weldLegMm: weld.weldLegMm,
    weldSegmentsPerEnd: weld.segmentsPerEnd,
    ...strength,
  }

  return {
    method: 'self-configuring-two-nut-joint-v2',
    mode,
    modeLabel: mode === 'auto' ? 'Автоподбор узла' : 'Ручная конфигурация',
    selected,
    geometry,
    nutSections: selected.nutSections,
    strengthParameters: strength,
    weld,
    recommendationsByClass,
    resolvedParameters,
    passesGeometry: geometry.passes,
    passesNutSections: selected.nutSections.passes,
    passesBolt: selected.evaluation.passes,
    passes: geometry.passes && selected.nutSections.passes && selected.evaluation.passes,
    explanation: mode === 'auto'
      ? 'Программа сама выбрала болт, проходную гайку ножки, длинную соединительную гайку, длину болта и базовые параметры сварки. Кандидат обязан одновременно пройти компоновку, минимум 2× по нетто-сечению гайки, преднатяг от момента затяжки, растяжение и срез.'
      : 'Проверяется выбранная пользователем сборка. Соединительная гайка верхнего узла всегда имеет ту же резьбу, что и болт; гайка ножки должна иметь большую резьбу, свободный проход болта и достаточное нетто-сечение.',
  }
}

export function applyResolvedJointParameters(parameters, configurator, mode = parameters.jointConfiguratorMode) {
  return {
    ...parameters,
    ...configurator.resolvedParameters,
    jointConfiguratorMode: mode,
  }
}

export function jointGeometryFromParameters(parameters) {
  return buildJointHardwareGeometry({
    boltDiameterMm: parameters.jointBoltDiameterMm,
    boltClass: parameters.jointBoltClass,
    clearanceNutThreadMm: parameters.jointClearanceNutThreadMm,
    boltLengthMm: parameters.jointBoltLengthMm,
    threadEngagementFactor: parameters.jointThreadEngagementFactor,
  })
}
