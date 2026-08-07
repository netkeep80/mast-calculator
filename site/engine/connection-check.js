import { evaluateBoltAcrossDemands } from './bolt-check.js'
import {
  applyResolvedJointParameters,
  configureIntermoduleJoint,
  jointGeometryFromParameters,
} from './joint-configurator.js'
import {
  buildIntermoduleJointDemands,
  buildIntermoduleJointResultants,
  buildMemberEndWeldDemands,
} from './joint-demand.js'
import { checkJointNutSections } from './joint-section-check.js'
import { resolveJointStrengthParameters } from './joint-strength-parameters.js'
import {
  calculateMinimumWeldLength,
  recommendWeldConsumable,
} from './weld-check.js'

function boltOptions(parameters) {
  const strength = resolveJointStrengthParameters(parameters)
  return {
    diameterMm: parameters.jointBoltDiameterMm,
    boltClass: parameters.jointBoltClass,
    connectionConditionFactor: parameters.connectionConditionFactor,
    shearPlanes: parameters.jointBoltShearPlanes,
    tighteningTorqueNm: strength.jointTighteningTorqueNm,
    nutFactor: strength.jointNutFactor,
    preloadVariation: strength.jointPreloadVariation,
  }
}

function demandOptions(parameters) {
  return {
    boltAxis: [0, 0, 1],
    jointEffectiveRadiusMm: parameters.jointEffectiveRadiusMm,
  }
}

function baseMetalRunMPa(parameters) {
  return Math.min(
    Number(parameters.tensileStrengthMPa),
    Number(parameters.jointBaseMetalTensileStrengthMPa),
  )
}

function weldOptions(parameters, memberDiameterMm, consumableId = parameters.weldConsumableId) {
  const strength = resolveJointStrengthParameters(parameters)
  const diameterMm = Number(memberDiameterMm)
  const memberAreaMm2 = Math.PI * diameterMm ** 2 / 4
  return {
    consumableId,
    weldLegMm: parameters.weldLegMm,
    segmentCount: parameters.weldSegmentsPerEnd,
    betaF: parameters.weldBetaF,
    betaZ: parameters.weldBetaZ,
    connectionConditionFactor: parameters.connectionConditionFactor,
    baseMetalRunMPa: baseMetalRunMPa(parameters),
    weldGroupRadiusMm: Math.max(diameterMm / 2, parameters.weldLegMm / 2),
    memberAreaMm2,
    minimumAreaRatio: strength.weldToRibAreaRatio,
    serviceYears: strength.weldServiceYears,
    initialStiffnessRetention: strength.weldInitialStiffnessRetention,
    annualStiffnessLossRate: strength.weldAnnualStiffnessLossRate,
    minimumStiffnessRetention: strength.weldMinimumStiffnessRetention,
  }
}

export function evaluateBoltSystemForAnalysis(model, analysis, parameters, metadata = {}) {
  const strength = resolveJointStrengthParameters(parameters)
  const effectiveParameters = { ...parameters, ...strength }
  const geometry = jointGeometryFromParameters(effectiveParameters)
  const nutSections = checkJointNutSections(geometry, effectiveParameters.barDiameterMm, {
    requiredRatio: strength.jointNutSectionAreaRatio,
  })
  effectiveParameters.jointEffectiveRadiusMm = geometry.effectiveRadiusMm
  const demands = buildIntermoduleJointDemands(model, analysis, demandOptions(effectiveParameters))
    .map((demand) => ({ ...metadata, ...demand }))
  if (demands.length === 0) {
    return {
      applicable: false,
      demands,
      passes: geometry.passes && nutSections.passes,
      utilization: 0,
      governingDemand: null,
      governingCheck: null,
      geometry,
      nutSections,
    }
  }
  const evaluation = evaluateBoltAcrossDemands(demands, boltOptions(effectiveParameters))
  return {
    applicable: true,
    demands,
    geometry,
    nutSections,
    ...evaluation,
    passes: geometry.passes && nutSections.passes && evaluation.passes,
  }
}

export function selectedBoltUtilizationForAnalysis(model, analysis, parameters) {
  const evaluation = evaluateBoltSystemForAnalysis(model, analysis, parameters)
  if (!evaluation.applicable) return 0
  if (evaluation.geometry?.passes === false || evaluation.nutSections?.passes === false) {
    return Number.POSITIVE_INFINITY
  }
  return evaluation.utilization
}

function buildOperationalJointResultants(result) {
  return result.cases.flatMap((loadCase, caseIndex) => (
    buildIntermoduleJointResultants(result.model, loadCase.analysis).map((resultant) => ({
      ...resultant,
      caseIndex,
      windDirectionDeg: loadCase.windDirectionDeg,
    }))
  ))
}

function buildWeldEnvelope(result, parameters, consumableId) {
  const byEnd = new Map()
  for (let caseIndex = 0; caseIndex < result.cases.length; caseIndex += 1) {
    const loadCase = result.cases[caseIndex]
    const demands = buildMemberEndWeldDemands(result.model, loadCase.analysis)
    for (const demand of demands) {
      const member = result.model.members[demand.memberId]
      const memberDiameterMm = member.diameterM * 1000
      const check = calculateMinimumWeldLength(
        demand,
        weldOptions(parameters, memberDiameterMm, consumableId),
      )
      const key = `${demand.memberId}:${demand.end}`
      const candidate = {
        ...demand,
        memberDiameterMm,
        caseIndex,
        windDirectionDeg: loadCase.windDirectionDeg,
        check,
      }
      const previous = byEnd.get(key)
      if (!previous || check.requiredPhysicalLengthMm > previous.check.requiredPhysicalLengthMm) {
        byEnd.set(key, candidate)
      }
    }
  }
  return [...byEnd.values()].sort((left, right) => (
    right.check.requiredPhysicalLengthMm - left.check.requiredPhysicalLengthMm
  ))
}

function summarizeWeldRecommendation(result, parameters, process) {
  const recommendation = recommendWeldConsumable({
    process,
    baseMetalRunMPa: baseMetalRunMPa(parameters),
  })
  if (!recommendation.recommended) return { ...recommendation, worstRequiredPhysicalLengthMm: null }
  const envelope = buildWeldEnvelope(result, parameters, recommendation.recommended.id)
  return {
    ...recommendation,
    worstRequiredPhysicalLengthMm: envelope[0]?.check.requiredPhysicalLengthMm ?? 0,
  }
}

function selectedBoltResult(configurator) {
  const selected = configurator.selected
  if (selected.demands.length === 0) {
    return {
      applicable: false,
      options: selected.evaluation.options,
      checks: [],
      governingDemand: null,
      governingCheck: null,
      utilization: 0,
      passes: selected.geometry.passes && selected.nutSections.passes,
      geometry: selected.geometry,
      nutSections: selected.nutSections,
    }
  }
  return {
    applicable: true,
    ...selected.evaluation,
    geometry: selected.geometry,
    nutSections: selected.nutSections,
    passes: selected.geometry.passes && selected.nutSections.passes && selected.evaluation.passes,
  }
}

export function calculateConnectionChecks(result) {
  if (!result?.model?.members?.length || !result?.cases?.length) {
    throw new Error('Для расчёта соединений требуется готовый frame-result с load cases')
  }
  const originalParameters = result.parameters
  const jointResultants = buildOperationalJointResultants(result)
  const configurator = configureIntermoduleJoint(jointResultants, originalParameters, {
    baseMetalRunMPa: baseMetalRunMPa(originalParameters),
  })
  const parameters = applyResolvedJointParameters(
    originalParameters,
    configurator,
    originalParameters.jointConfiguratorMode,
  )
  const jointDemands = configurator.selected.demands
  const selectedBolt = selectedBoltResult(configurator)
  const weldEnvelope = buildWeldEnvelope(result, parameters, parameters.weldConsumableId)
  const criticalWeld = weldEnvelope[0] ?? null
  const selectedWeldCompatible = criticalWeld?.check.baseStrengthCompatible ?? true
  const weldAreaPasses = weldEnvelope.every((item) => (
    item.check.minimumAreaRatio == null
    || item.check.requiredAreaRatio + 1e-12 >= item.check.minimumAreaRatio
  ))
  const electrodeRecommendation = summarizeWeldRecommendation(result, parameters, 'electrode')
  const wireRecommendation = summarizeWeldRecommendation(result, parameters, 'wire')
  const strength = resolveJointStrengthParameters(parameters)
  const hardwareGeometryPasses = configurator.geometry.passes
  const jointGeometryPasses = hardwareGeometryPasses && configurator.nutSections.passes

  return {
    method: 'two-nut-intermodule-joint-and-member-end-weld-v4',
    standard: 'СП 16.13330.2017 + ISO/ГОСТ геометрия + torque-preload T=KFd + проектные criteria issue #33/#19',
    physicalSplit: 'На ножке верхнего модуля два ребра приварены к проходной гайке с резьбой большего диаметра. Болт свободно проходит через неё и ввинчивается в длинную соединительную гайку верхнего узла нижнего модуля, к которой приварены четыре ребра.',
    boltModel: 'Сила наклонных верхних рёбер раскладывается на осевую и поперечную к болту составляющие; момент добавляет M/reff. В auto момент затяжки ограничивается по расчётной растягивающей способности конкретного диаметра, ручной режим сохраняет заданный момент.',
    nutSectionModel: 'Нетто-площадь шестигранника за вычетом базового отверстия обязана быть не меньше заданного кратного сечения одного ребра; по умолчанию 2×.',
    weldModel: 'Каждый конец ребра проверяется по совпадающему N/V/T/M. Номинальное throat дополнительно умножается на явный service-retention factor сварной зоны issue #19; это консервативный параметрический reserve model, а не универсальный физический закон календарного старения.',
    jointCount: result.model.moduleCount > 1 ? 3 * (result.model.moduleCount - 1) : 0,
    jointDemandCount: jointDemands.length,
    jointResultants,
    jointDemands,
    configurator,
    resolvedParameters: configurator.resolvedParameters,
    strengthParameters: strength,
    nutSections: configurator.nutSections,
    bolt: {
      selected: selectedBolt,
      recommendationsByClass: configurator.recommendationsByClass,
      configuredDiameterMm: parameters.jointBoltDiameterMm,
      configuredClass: parameters.jointBoltClass,
      configuredLengthMm: parameters.jointBoltLengthMm,
      clearanceNutThreadMm: parameters.jointClearanceNutThreadMm,
      threadEngagementFactor: parameters.jointThreadEngagementFactor,
      effectiveRadiusMm: parameters.jointEffectiveRadiusMm,
      shearPlanes: parameters.jointBoltShearPlanes,
      connectionConditionFactor: parameters.connectionConditionFactor,
      tighteningTorqueNm: strength.jointTighteningTorqueNm,
      nutFactor: strength.jointNutFactor,
      preloadVariation: strength.jointPreloadVariation,
    },
    weld: {
      configuredConsumableId: parameters.weldConsumableId,
      configuredLegMm: parameters.weldLegMm,
      segmentsPerEnd: parameters.weldSegmentsPerEnd,
      betaF: parameters.weldBetaF,
      betaZ: parameters.weldBetaZ,
      weakerBaseMetalRunMPa: baseMetalRunMPa(parameters),
      minimumAreaRatio: strength.weldToRibAreaRatio,
      serviceYears: strength.weldServiceYears,
      initialStiffnessRetention: strength.weldInitialStiffnessRetention,
      annualStiffnessLossRate: strength.weldAnnualStiffnessLossRate,
      minimumStiffnessRetention: strength.weldMinimumStiffnessRetention,
      serviceDegradation: criticalWeld?.check.serviceDegradation ?? null,
      envelope: weldEnvelope,
      critical: criticalWeld,
      selectedConsumableCompatible: selectedWeldCompatible,
      areaCriterionPasses: weldAreaPasses,
      electrodeRecommendation,
      wireRecommendation,
    },
    passesConfiguredBolt: selectedBolt.passes,
    passesHardwareGeometry: hardwareGeometryPasses,
    passesJointGeometry: jointGeometryPasses,
    passesNutSections: configurator.nutSections.passes,
    selectedWeldConsumableCompatible: selectedWeldCompatible,
    passesWeldAreaCriterion: weldAreaPasses,
    passes: selectedBolt.passes
      && jointGeometryPasses
      && selectedWeldCompatible
      && weldAreaPasses,
  }
}
