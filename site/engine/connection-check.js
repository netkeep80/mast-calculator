import {
  buildBoltRecommendations,
  evaluateBoltAcrossDemands,
} from './bolt-check.js'
import {
  buildIntermoduleJointDemands,
  buildMemberEndWeldDemands,
} from './joint-demand.js'
import {
  calculateMinimumWeldLength,
  recommendWeldConsumable,
} from './weld-check.js'

function boltOptions(parameters, overrides = {}) {
  return {
    diameterMm: overrides.diameterMm ?? parameters.jointBoltDiameterMm,
    boltClass: overrides.boltClass ?? parameters.jointBoltClass,
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
  const demands = buildIntermoduleJointDemands(model, analysis, demandOptions(parameters))
    .map((demand) => ({ ...metadata, ...demand }))
  if (demands.length === 0) {
    return {
      applicable: false,
      demands,
      passes: true,
      utilization: 0,
      governingDemand: null,
      governingCheck: null,
    }
  }
  return {
    applicable: true,
    demands,
    ...evaluateBoltAcrossDemands(demands, boltOptions(parameters)),
  }
}

export function selectedBoltUtilizationForAnalysis(model, analysis, parameters) {
  return evaluateBoltSystemForAnalysis(model, analysis, parameters).utilization
}

function buildOperationalJointDemands(result) {
  return result.cases.flatMap((loadCase, caseIndex) => (
    buildIntermoduleJointDemands(
      result.model,
      loadCase.analysis,
      demandOptions(result.parameters),
    ).map((demand) => ({
      ...demand,
      caseIndex,
      windDirectionDeg: loadCase.windDirectionDeg,
    }))
  ))
}

function buildWeldEnvelope(result, consumableId) {
  const byEnd = new Map()
  for (let caseIndex = 0; caseIndex < result.cases.length; caseIndex += 1) {
    const loadCase = result.cases[caseIndex]
    const demands = buildMemberEndWeldDemands(result.model, loadCase.analysis)
    for (const demand of demands) {
      const member = result.model.members[demand.memberId]
      const check = calculateMinimumWeldLength(demand, weldOptions(result.parameters, consumableId))
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

function summarizeWeldRecommendation(result, process) {
  const recommendation = recommendWeldConsumable({
    process,
    baseMetalRunMPa: baseMetalRunMPa(result.parameters),
  })
  if (!recommendation.recommended) return { ...recommendation, worstRequiredPhysicalLengthMm: null }
  const envelope = buildWeldEnvelope(result, recommendation.recommended.id)
  return {
    ...recommendation,
    worstRequiredPhysicalLengthMm: envelope[0]?.check.requiredPhysicalLengthMm ?? 0,
  }
}

export function calculateConnectionChecks(result) {
  if (!result?.model?.members?.length || !result?.cases?.length) {
    throw new Error('Для расчёта соединений требуется готовый frame-result с load cases')
  }
  const parameters = result.parameters
  const jointDemands = buildOperationalJointDemands(result)
  const selectedBolt = jointDemands.length
    ? evaluateBoltAcrossDemands(jointDemands, boltOptions(parameters))
    : {
        applicable: false,
        checks: [],
        governingDemand: null,
        governingCheck: null,
        utilization: 0,
        passes: true,
      }
  const boltRecommendations = jointDemands.length
    ? buildBoltRecommendations(jointDemands, {
        connectionConditionFactor: parameters.connectionConditionFactor,
        shearPlanes: parameters.jointBoltShearPlanes,
      })
    : []

  const weldEnvelope = buildWeldEnvelope(result, parameters.weldConsumableId)
  const criticalWeld = weldEnvelope[0] ?? null
  const selectedWeldCompatible = criticalWeld?.check.baseStrengthCompatible ?? true
  const electrodeRecommendation = summarizeWeldRecommendation(result, 'electrode')
  const wireRecommendation = summarizeWeldRecommendation(result, 'wire')

  return {
    method: 'intermodule-bolt-and-member-end-weld-v1',
    standard: 'СП 16.13330.2017 (ред. 09.12.2024)',
    physicalSplit: 'На каждом внутреннем узле два ребра верхней ножки отделяются от четырёх рёбер нижнего модуля одним вертикальным болтом.',
    boltModel: 'Сила и момент верхней двухреберной части приводятся к растяжению/срезу одного болта; изгибающий момент делится на эффективный радиус узла, кручение — на тот же радиус.',
    weldModel: 'Каждый конец ребра проверяется как идеализированная круговая группа угловых швов по совпадающему N/V/T/M одного load case.',
    jointCount: result.model.moduleCount > 1 ? 3 * (result.model.moduleCount - 1) : 0,
    jointDemandCount: jointDemands.length,
    jointDemands,
    bolt: {
      selected: selectedBolt,
      recommendationsByClass: boltRecommendations,
      configuredDiameterMm: parameters.jointBoltDiameterMm,
      configuredClass: parameters.jointBoltClass,
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
    selectedWeldConsumableCompatible: selectedWeldCompatible,
    passes: selectedBolt.passes && selectedWeldCompatible,
  }
}
