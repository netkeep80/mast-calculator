import type { ResolvedProject } from '../../domain/contracts.js'
import { maximumModuleDiameterMm } from '../../domain/index.js'
import type { GeneratedMastModel } from '../../structural-analysis/index.js'
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

interface ConnectionAnalysisMemberResult {
  localEndForces: readonly number[]
  localAxes: readonly (readonly number[])[]
}

interface ConnectionAnalysis {
  memberResults: readonly (ConnectionAnalysisMemberResult | undefined)[]
}

interface ConnectionCase {
  windDirectionDeg: number
  analysis: ConnectionAnalysis
}

export interface ConnectionCalculationResult {
  parameters: ResolvedProject
  model: GeneratedMastModel
  cases: readonly ConnectionCase[]
  readonly [key: string]: unknown
}

function boltOptions(parameters: ResolvedProject) {
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

function demandOptions(parameters: ResolvedProject) {
  return {
    boltAxis: [0, 0, 1],
    jointEffectiveRadiusMm: parameters.jointEffectiveRadiusMm,
  }
}

function baseMetalRunMPa(parameters: ResolvedProject): number {
  return Math.min(
    Number(parameters.tensileStrengthMPa),
    Number(parameters.jointBaseMetalTensileStrengthMPa),
  )
}

function weldOptions(
  parameters: ResolvedProject,
  memberDiameterMm: number,
  consumableId: string = parameters.weldConsumableId,
) {
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

export function evaluateBoltSystemForAnalysis(
  model: GeneratedMastModel,
  analysis: ConnectionAnalysis,
  parameters: ResolvedProject,
  metadata: Readonly<Record<string, unknown>> = {},
) {
  const strength = resolveJointStrengthParameters(parameters)
  const effectiveParameters: ResolvedProject = { ...parameters, ...strength }
  const geometry = jointGeometryFromParameters(effectiveParameters)
  const referenceBarDiameterMm = maximumModuleDiameterMm(effectiveParameters)
  const nutSections = checkJointNutSections(geometry, referenceBarDiameterMm, {
    requiredRatio: strength.jointNutSectionAreaRatio,
  })
  const parametersWithGeometry: ResolvedProject = {
    ...effectiveParameters,
    jointEffectiveRadiusMm: geometry.effectiveRadiusMm,
  }
  const demands = buildIntermoduleJointDemands(model, analysis, demandOptions(parametersWithGeometry))
    .map((demand) => ({ ...metadata, ...demand }))
  if (demands.length === 0) {
    return {
      applicable: false as const,
      demands,
      passes: geometry.passes && nutSections.passes,
      utilization: 0,
      governingDemand: null,
      governingCheck: null,
      geometry,
      nutSections,
      referenceBarDiameterMm,
    }
  }
  const evaluation = evaluateBoltAcrossDemands(demands, boltOptions(parametersWithGeometry))
  return {
    applicable: true as const,
    demands,
    geometry,
    nutSections,
    referenceBarDiameterMm,
    ...evaluation,
    passes: geometry.passes && nutSections.passes && evaluation.passes,
  }
}

export function selectedBoltUtilizationForAnalysis(
  model: GeneratedMastModel,
  analysis: ConnectionAnalysis,
  parameters: ResolvedProject,
): number {
  const evaluation = evaluateBoltSystemForAnalysis(model, analysis, parameters)
  if (!evaluation.applicable) return 0
  if (evaluation.geometry?.passes === false || evaluation.nutSections?.passes === false) {
    return Number.POSITIVE_INFINITY
  }
  return evaluation.utilization
}

function buildOperationalJointResultants(result: ConnectionCalculationResult) {
  return result.cases.flatMap((loadCase, caseIndex) => (
    buildIntermoduleJointResultants(result.model, loadCase.analysis).map((resultant) => ({
      ...resultant,
      caseIndex,
      windDirectionDeg: loadCase.windDirectionDeg,
    }))
  ))
}

type WeldDemand = ReturnType<typeof buildMemberEndWeldDemands>[number]
type WeldCheck = ReturnType<typeof calculateMinimumWeldLength>

interface WeldEnvelopeItem extends WeldDemand {
  memberDiameterMm: number
  caseIndex: number
  windDirectionDeg: number
  check: WeldCheck
}

function buildWeldEnvelope(
  result: ConnectionCalculationResult,
  parameters: ResolvedProject,
  consumableId: string,
): WeldEnvelopeItem[] {
  const byEnd = new Map<string, WeldEnvelopeItem>()
  for (let caseIndex = 0; caseIndex < result.cases.length; caseIndex += 1) {
    const loadCase = result.cases[caseIndex]!
    const demands = buildMemberEndWeldDemands(result.model, loadCase.analysis)
    for (const demand of demands) {
      const member = result.model.members[demand.memberId]
      if (!member) throw new Error(`Не найдено ребро ${demand.memberId} для проверки сварки`)
      const memberDiameterMm = member.diameterM * 1000
      const check = calculateMinimumWeldLength(
        demand,
        weldOptions(parameters, memberDiameterMm, consumableId),
      )
      const key = `${demand.memberId}:${demand.end}`
      const candidate: WeldEnvelopeItem = {
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

function summarizeWeldRecommendation(
  result: ConnectionCalculationResult,
  parameters: ResolvedProject,
  process: string,
) {
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

function selectedBoltResult(configurator: ReturnType<typeof configureIntermoduleJoint>) {
  const selected = configurator.selected
  if (selected.demands.length === 0) {
    return {
      applicable: false as const,
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
    applicable: true as const,
    ...selected.evaluation,
    geometry: selected.geometry,
    nutSections: selected.nutSections,
    passes: selected.geometry.passes && selected.nutSections.passes && selected.evaluation.passes,
  }
}

export function calculateConnectionChecks(result: ConnectionCalculationResult) {
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
    || item.check.requiredAreaRatio! + 1e-12 >= item.check.minimumAreaRatio
  ))
  const electrodeRecommendation = summarizeWeldRecommendation(result, parameters, 'electrode')
  const wireRecommendation = summarizeWeldRecommendation(result, parameters, 'wire')
  const strength = resolveJointStrengthParameters(parameters)
  const hardwareGeometryPasses = configurator.geometry.passes
  const jointGeometryPasses = hardwareGeometryPasses && configurator.nutSections.passes

  return {
    method: 'two-nut-intermodule-joint-and-member-end-weld-v4' as const,
    standard: 'СП 16.13330.2017 + ISO/ГОСТ геометрия + torque-preload T=KFd + проектные criteria issue #33/#19',
    physicalSplit: 'На ножке верхнего модуля два ребра приварены к проходной гайке с резьбой большего диаметра. Болт свободно проходит через неё и ввинчивается в длинную соединительную гайку верхнего узла нижнего модуля, к которой приварены четыре ребра.',
    boltModel: 'Сила наклонных верхних рёбер раскладывается на осевую и поперечную к болту составляющие; момент добавляет M/reff. В auto момент затяжки ограничивается по расчётной растягивающей способности конкретного диаметра, ручной режим сохраняет заданный момент.',
    nutSectionModel: 'Нетто-площадь шестигранника за вычетом базового отверстия обязана быть не меньше заданного кратного сечения одного ребра; для смешанного профиля используется максимальный диаметр ребра мачты.',
    weldModel: 'Каждый конец ребра проверяется по совпадающему N/V/T/M и фактическому диаметру этого ребра. Номинальное throat дополнительно умножается на явный service-retention factor сварной зоны issue #19; это консервативный параметрический reserve model, а не универсальный физический закон календарного старения.',
    jointCount: result.model.moduleCount > 1 ? 3 * (result.model.moduleCount - 1) : 0,
    jointDemandCount: jointDemands.length,
    referenceBarDiameterMm: maximumModuleDiameterMm(parameters),
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
