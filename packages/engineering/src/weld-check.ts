import {
  calculateWeldServiceDegradation,
  getWeldConsumable,
  WELD_CONSUMABLES,
} from '../../domain/index.js'

export const DEFAULT_WELD_BETA_F = 0.7
export const DEFAULT_WELD_BETA_Z = 1.0
export const MINIMUM_EFFECTIVE_FILLET_WELD_LENGTH_MM = 40
export const END_DEDUCTION_PER_CONTINUOUS_WELD_MM = 10
export const DEFAULT_WELD_TO_RIB_AREA_RATIO = 2.5
export const MIN_WELD_TO_RIB_AREA_RATIO = 2
export const MAX_WELD_TO_RIB_AREA_RATIO = 3

const positive = (value: unknown, name: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должен быть положительным числом`)
  return numeric
}

function optionalPositive(value: unknown, name: string): number | null {
  if (value == null) return null
  return positive(value, name)
}

export interface WeldServiceOptions {
  serviceYears?: unknown
  initialStiffnessRetention?: unknown
  annualStiffnessLossRate?: unknown
  minimumStiffnessRetention?: unknown
}

function serviceDegradationForOptions(options: WeldServiceOptions) {
  const explicitlyConfigured = [
    options.serviceYears,
    options.initialStiffnessRetention,
    options.annualStiffnessLossRate,
    options.minimumStiffnessRetention,
  ].some((value) => value != null)

  if (!explicitlyConfigured) {
    return {
      ...calculateWeldServiceDegradation({
        serviceYears: 0,
        initialStiffnessRetention: 1,
        annualStiffnessLossRate: 0,
        minimumStiffnessRetention: 1,
      }),
      configured: false,
    }
  }

  return {
    ...calculateWeldServiceDegradation({
      serviceYears: options.serviceYears,
      initialStiffnessRetention: options.initialStiffnessRetention,
      annualStiffnessLossRate: options.annualStiffnessLossRate,
      minimumStiffnessRetention: options.minimumStiffnessRetention,
    }),
    configured: true,
  }
}

export interface CircularWeldDemandInput {
  axialForceN?: unknown
  shearForceN?: unknown
  torsionNm?: unknown
  bendingNm?: unknown
  weldGroupRadiusMm: unknown
}

export function equivalentCircularWeldDemandN({
  axialForceN = 0,
  shearForceN = 0,
  torsionNm = 0,
  bendingNm = 0,
  weldGroupRadiusMm,
}: CircularWeldDemandInput) {
  const radiusMm = positive(weldGroupRadiusMm, 'Эффективный радиус сварной группы')
  const radiusM = radiusMm / 1000
  const axialLikeN = Math.abs(Number(axialForceN) || 0)
    + 2 * Math.abs(Number(bendingNm) || 0) / radiusM
  const shearLikeN = Math.abs(Number(shearForceN) || 0)
    + Math.abs(Number(torsionNm) || 0) / radiusM
  return {
    axialLikeN,
    shearLikeN,
    equivalentConditionalForceN: Math.hypot(axialLikeN, shearLikeN),
  }
}

export interface WeldDemand {
  axialForceN?: unknown
  shearForceN?: unknown
  torsionNm?: unknown
  bendingNm?: unknown
  readonly [key: string]: unknown
}

export interface MinimumWeldLengthOptions extends WeldServiceOptions {
  consumableId: string
  weldLegMm: unknown
  segmentCount?: unknown
  betaF?: unknown
  betaZ?: unknown
  connectionConditionFactor?: unknown
  baseMetalRunMPa: unknown
  weldGroupRadiusMm: unknown
  memberAreaMm2?: unknown
  minimumAreaRatio?: unknown
  providedPhysicalLengthMm?: unknown
}

export function calculateMinimumWeldLength(demand: WeldDemand, options: MinimumWeldLengthOptions) {
  const consumable = getWeldConsumable(options.consumableId)
  const weldLegMm = positive(options.weldLegMm, 'Катет углового шва')
  const segmentCount = Math.max(1, Math.floor(positive(options.segmentCount ?? 1, 'Число участков шва')))
  const betaF = positive(options.betaF ?? DEFAULT_WELD_BETA_F, 'Коэффициент beta_f')
  const betaZ = positive(options.betaZ ?? DEFAULT_WELD_BETA_Z, 'Коэффициент beta_z')
  const gammaC = positive(options.connectionConditionFactor ?? 1, 'Коэффициент условий работы соединения')
  const baseMetalRunMPa = positive(options.baseMetalRunMPa, 'Временное сопротивление более слабого основного металла')
  const rwzMPa = 0.45 * baseMetalRunMPa
  const weldGroupRadiusMm = positive(
    options.weldGroupRadiusMm,
    'Эффективный радиус сварной группы',
  )
  const equivalent = equivalentCircularWeldDemandN({
    ...demand,
    weldGroupRadiusMm,
  })
  const serviceDegradation = serviceDegradationForOptions(options)

  const effectiveThroatMm = betaF * weldLegMm
  const serviceAdjustedEffectiveThroatMm = effectiveThroatMm
    * serviceDegradation.stiffnessRetentionFactor
  const weldMetalResistancePerMmN = serviceAdjustedEffectiveThroatMm * consumable.rwfMPa * gammaC
  const fusionResistancePerMmN = betaZ * weldLegMm
    * serviceDegradation.stiffnessRetentionFactor * rwzMPa * gammaC
  const requiredByWeldMetalMm = equivalent.equivalentConditionalForceN
    / Math.max(weldMetalResistancePerMmN, Number.EPSILON)
  const requiredByFusionMm = equivalent.equivalentConditionalForceN
    / Math.max(fusionResistancePerMmN, Number.EPSILON)
  const codeMinimumEffectiveMm = Math.max(
    MINIMUM_EFFECTIVE_FILLET_WELD_LENGTH_MM,
    4 * weldLegMm,
  )

  const memberAreaMm2 = optionalPositive(options.memberAreaMm2, 'Площадь сечения ребра')
  const requestedAreaRatio = memberAreaMm2 == null
    ? null
    : positive(
        options.minimumAreaRatio ?? DEFAULT_WELD_TO_RIB_AREA_RATIO,
        'Коэффициент площади шва к сечению ребра',
      )
  if (requestedAreaRatio != null && (
    requestedAreaRatio < MIN_WELD_TO_RIB_AREA_RATIO - 1e-12
    || requestedAreaRatio > MAX_WELD_TO_RIB_AREA_RATIO + 1e-12
  )) {
    throw new Error(`Коэффициент площади шва должен быть в диапазоне ${MIN_WELD_TO_RIB_AREA_RATIO}…${MAX_WELD_TO_RIB_AREA_RATIO}`)
  }
  const requiredThroatAreaMm2 = memberAreaMm2 == null ? 0 : requestedAreaRatio! * memberAreaMm2
  const requiredByAreaRatioMm = memberAreaMm2 == null
    ? 0
    : requiredThroatAreaMm2 / Math.max(serviceAdjustedEffectiveThroatMm, Number.EPSILON)

  const requiredEffectiveLengthMm = Math.max(
    requiredByWeldMetalMm,
    requiredByFusionMm,
    codeMinimumEffectiveMm,
    requiredByAreaRatioMm,
  )
  const nominalRequiredEffectiveAreaMm2 = effectiveThroatMm * requiredEffectiveLengthMm
  const requiredEffectiveAreaMm2 = serviceAdjustedEffectiveThroatMm * requiredEffectiveLengthMm
  const requiredAreaRatio = memberAreaMm2 == null
    ? null
    : requiredEffectiveAreaMm2 / memberAreaMm2
  const requiredPhysicalLengthMm = requiredEffectiveLengthMm
    + segmentCount * END_DEDUCTION_PER_CONTINUOUS_WELD_MM
  const providedPhysicalLengthMm = Number(options.providedPhysicalLengthMm)
  const providedEffectiveLengthMm = Number.isFinite(providedPhysicalLengthMm)
    ? Math.max(0, providedPhysicalLengthMm - segmentCount * END_DEDUCTION_PER_CONTINUOUS_WELD_MM)
    : null
  const providedEffectiveAreaMm2 = providedEffectiveLengthMm == null
    ? null
    : serviceAdjustedEffectiveThroatMm * providedEffectiveLengthMm
  const providedAreaRatio = memberAreaMm2 == null || providedEffectiveAreaMm2 == null
    ? null
    : providedEffectiveAreaMm2 / memberAreaMm2
  const providedUtilization = providedEffectiveLengthMm == null || providedEffectiveLengthMm <= 0
    ? null
    : requiredEffectiveLengthMm / providedEffectiveLengthMm
  const baseStrengthCompatible = consumable.rwunMPa >= baseMetalRunMPa

  return {
    consumableId: consumable.id,
    consumableLabel: consumable.label,
    process: consumable.process,
    rwunMPa: consumable.rwunMPa,
    rwfMPa: consumable.rwfMPa,
    rwzMPa,
    baseMetalRunMPa,
    baseStrengthCompatible,
    weldLegMm,
    segmentCount,
    betaF,
    betaZ,
    effectiveThroatMm,
    serviceAdjustedEffectiveThroatMm,
    serviceDegradation,
    connectionConditionFactor: gammaC,
    weldGroupRadiusMm,
    ...equivalent,
    weldMetalResistancePerMmN,
    fusionResistancePerMmN,
    requiredByWeldMetalMm,
    requiredByFusionMm,
    codeMinimumEffectiveMm,
    memberAreaMm2,
    minimumAreaRatio: requestedAreaRatio,
    requiredThroatAreaMm2,
    requiredByAreaRatioMm,
    requiredEffectiveLengthMm,
    nominalRequiredEffectiveAreaMm2,
    requiredEffectiveAreaMm2,
    requiredAreaRatio,
    requiredPhysicalLengthMm,
    requiredPhysicalLengthPerSegmentMm: requiredPhysicalLengthMm / segmentCount,
    providedPhysicalLengthMm: Number.isFinite(providedPhysicalLengthMm) ? providedPhysicalLengthMm : null,
    providedEffectiveLengthMm,
    providedEffectiveAreaMm2,
    providedAreaRatio,
    providedUtilization,
    providedPasses: providedUtilization == null ? null : providedUtilization <= 1,
    areaCriterion: memberAreaMm2 == null
      ? null
      : `Aweld,service / Arib >= ${requestedAreaRatio}`,
    areaCriterionSource: memberAreaMm2 == null
      ? null
      : 'Issue #33 area-reserve + issue #19 service degradation: проектные консервативные критерии, не универсальный нормативный закон старения.',
  }
}

export interface WeldRecommendationInput {
  process: string
  baseMetalRunMPa: unknown
}

export function recommendWeldConsumable({ process, baseMetalRunMPa }: WeldRecommendationInput) {
  const requiredRun = positive(baseMetalRunMPa, 'Временное сопротивление более слабого основного металла')
  const candidates = WELD_CONSUMABLES
    .filter((item) => process === 'any' || item.process === process)
    .map((item) => ({
      ...item,
      compatible: item.rwunMPa >= requiredRun,
    }))
  return {
    process,
    baseMetalRunMPa: requiredRun,
    recommended: candidates.find((item) => item.compatible) ?? null,
    candidates,
  }
}
