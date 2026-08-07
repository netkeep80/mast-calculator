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
import {
  calculateMinimumWeldLength,
  recommendWeldConsumable,
} from './weld-check.js'

function boltOptions(parameters) {
  return {
    diameterMm: parameters.jointBoltDiameterMm,
    boltClass: parameters.jointBoltClass,
    connectionConditionFactor: parameters.connectionConditionFactor,
    shearPlanes: parameters.jointBoltShearPlanes,
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

function weldOptions(parameters, consumableId = parameters.weldConsumableId) {
  return {
    consumableId,
    weldLegMm: parameters.weldLegMm,
    segmentCount: parameters.weldSegmentsPerEnd,
    betaF: parameters.weldBetaF,
    betaZ: parameters.weldBetaZ,
    connectionConditionFactor: parameters.connectionConditionFactor,
    baseMetalRunMPa: baseMetalRunMPa(parameters),
    weldGroupRadiusMm: Math.max(parameters.barDiameterMm / 2, parameters.weldLegMm / 2),
  }
}

export function evaluateBoltSystemForAnalysis(model, analysis, parameters, metadata = {}) {
  const geometry = jointGeometryFromParameters(parameters)
  const effectiveParameters = {
    ...parameters,
    jointEffectiveRadiusMm: geometry.effectiveRadiusMm,
  }
  const demands = buildIntermoduleJointDemands(model, analysis, demandOptions(effectiveParameters))
    .map((demand) => ({ ...metadata, ...demand }))
  if (demands.length === 0) {
    return {
      applicable: false,
      demands,
      passes: geometry.passes,
      utilization: 0,
      governingDemand: null,
      governingCheck: null,
      geometry,
    }
  }
  const evaluation = evaluateBoltAcrossDemands(demands, boltOptions(effectiveParameters))
  return {
    applicable: true,
    demands,
    geometry,
    ...evaluation,
    passes: geometry.passes && evaluation.passes,
  }
}

export function selectedBoltUtilizationForAnalysis(model, analysis, parameters) {
  return evaluateBoltSystemForAnalysis(model, analysis, parameters).utilization
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
      const check = calculateMinimumWeldLength(demand, weldOptions(parameters, consumableId))
      const key = `${demand.memberId}:${demand.end}`
      const candidate = {
        ...demand,
        memberDiameterMm: member.diameterM * 1000,
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
      passes: selected.geometry.passes,
      geometry: selected.geometry,
    }
  }
  return {
    applicable: true,
    ...selected.evaluation,
    geometry: selected.geometry,
    passes: selected.geometry.passes && selected.evaluation.passes,
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
  const electrodeRecommendation = summarizeWeldRecommendation(result, parameters, 'electrode')
  const wireRecommendation = summarizeWeldRecommendation(result, parameters, 'wire')

  return {
    method: 'two-nut-intermodule-joint-and-member-end-weld-v2',
    standard: 'СП 16.13330.2017 (ред. 09.12.2024) + справочная геометрия ISO 4032 / DIN 6334',
    physicalSplit: 'На ножке верхнего модуля два ребра приварены к проходной гайке с резьбой большего диаметра. Болт свободно проходит через неё и ввинчивается в длинную соединительную гайку верхнего узла нижнего модуля, к которой приварены четыре ребра.',
    boltModel: 'Сила и момент двухреберной ножки приводятся к растяжению/срезу одного болта; эффективный радиус автоматически берётся как половина размера под ключ соединительной гайки.',
    weldModel: 'Каждый конец ребра проверяется как идеализированная круговая группа угловых швов по совпадающему N/V/T/M одного load case.',
    jointCount: result.model.moduleCount > 1 ? 3 * (result.model.moduleCount - 1) : 0,
    jointDemandCount: jointDemands.length,
    jointResultants,
    jointDemands,
    configurator,
    resolvedParameters: configurator.resolvedParameters,
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
    },
    weld: {
      configuredConsumableId: parameters.weldConsumableId,
      configuredLegMm: parameters.weldLegMm,
      segmentsPerEnd: parameters.weldSegmentsPerEnd,
      betaF: parameters.weldBetaF,
      betaZ: parameters.weldBetaZ,
      weakerBaseMetalRunMPa: baseMetalRunMPa(parameters),
      envelope: weldEnvelope,
      critical: criticalWeld,
      selectedConsumableCompatible: selectedWeldCompatible,
      electrodeRecommendation,
      wireRecommendation,
    },
    passesConfiguredBolt: selectedBolt.passes,
    passesJointGeometry: configurator.geometry.passes,
    selectedWeldConsumableCompatible: selectedWeldCompatible,
    passes: selectedBolt.passes && configurator.geometry.passes && selectedWeldCompatible,
  }
}
