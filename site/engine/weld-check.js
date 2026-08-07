import {
  getWeldConsumable,
  WELD_CONSUMABLES,
} from './connection-catalog.js'

export const DEFAULT_WELD_BETA_F = 0.7
export const DEFAULT_WELD_BETA_Z = 1.0
export const MINIMUM_EFFECTIVE_FILLET_WELD_LENGTH_MM = 40
export const END_DEDUCTION_PER_CONTINUOUS_WELD_MM = 10
export const DEFAULT_WELD_TO_RIB_AREA_RATIO = 2.5
export const MIN_WELD_TO_RIB_AREA_RATIO = 2
export const MAX_WELD_TO_RIB_AREA_RATIO = 3

const positive = (value, name) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должен быть положительным числом`)
  return numeric
}

function optionalPositive(value, name) {
  if (value == null) return null
  return positive(value, name)
}

export function equivalentCircularWeldDemandN({
  axialForceN = 0,
  shearForceN = 0,
  torsionNm = 0,
  bendingNm = 0,
  weldGroupRadiusMm,
}) {
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

export function calculateMinimumWeldLength(demand, options) {
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

  const effectiveThroatMm = betaF * weldLegMm
  const weldMetalResistancePerMmN = effectiveThroatMm * consumable.rwfMPa * gammaC
  const fusionResistancePerMmN = betaZ * weldLegMm * rwzMPa * gammaC
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
  const requiredThroatAreaMm2 = memberAreaMm2 == null ? 0 : requestedAreaRatio * memberAreaMm2
  const requiredByAreaRatioMm = memberAreaMm2 == null
    ? 0
    : requiredThroatAreaMm2 / Math.max(effectiveThroatMm, Number.EPSILON)

  const requiredEffectiveLengthMm = Math.max(
    requiredByWeldMetalMm,
    requiredByFusionMm,
    codeMinimumEffectiveMm,
    requiredByAreaRatioMm,
  )
  const requiredEffectiveAreaMm2 = effectiveThroatMm * requiredEffectiveLengthMm
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
    : effectiveThroatMm * providedEffectiveLengthMm
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
      : `Aweld,eff / Arib >= ${requestedAreaRatio}`,
    areaCriterionSource: memberAreaMm2 == null
      ? null
      : 'Issue #33: дополнительный проектный запас 2–3×; эффективная площадь определяется через throat×length.',
  }
}

export function recommendWeldConsumable({ process, baseMetalRunMPa }) {
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
