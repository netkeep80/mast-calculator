import {
  getWeldConsumable,
  WELD_CONSUMABLES,
} from './connection-catalog.js'

export const DEFAULT_WELD_BETA_F = 0.7
export const DEFAULT_WELD_BETA_Z = 1.0
export const MINIMUM_EFFECTIVE_FILLET_WELD_LENGTH_MM = 40
export const END_DEDUCTION_PER_CONTINUOUS_WELD_MM = 10

const positive = (value, name) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должен быть положительным числом`)
  return numeric
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

  const weldMetalResistancePerMmN = betaF * weldLegMm * consumable.rwfMPa * gammaC
  const fusionResistancePerMmN = betaZ * weldLegMm * rwzMPa * gammaC
  const requiredByWeldMetalMm = equivalent.equivalentConditionalForceN
    / Math.max(weldMetalResistancePerMmN, Number.EPSILON)
  const requiredByFusionMm = equivalent.equivalentConditionalForceN
    / Math.max(fusionResistancePerMmN, Number.EPSILON)
  const codeMinimumEffectiveMm = Math.max(
    MINIMUM_EFFECTIVE_FILLET_WELD_LENGTH_MM,
    4 * weldLegMm,
  )
  const requiredEffectiveLengthMm = Math.max(
    requiredByWeldMetalMm,
    requiredByFusionMm,
    codeMinimumEffectiveMm,
  )
  const requiredPhysicalLengthMm = requiredEffectiveLengthMm
    + segmentCount * END_DEDUCTION_PER_CONTINUOUS_WELD_MM
  const providedPhysicalLengthMm = Number(options.providedPhysicalLengthMm)
  const providedEffectiveLengthMm = Number.isFinite(providedPhysicalLengthMm)
    ? Math.max(0, providedPhysicalLengthMm - segmentCount * END_DEDUCTION_PER_CONTINUOUS_WELD_MM)
    : null
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
    connectionConditionFactor: gammaC,
    weldGroupRadiusMm,
    ...equivalent,
    weldMetalResistancePerMmN,
    fusionResistancePerMmN,
    requiredByWeldMetalMm,
    requiredByFusionMm,
    codeMinimumEffectiveMm,
    requiredEffectiveLengthMm,
    requiredPhysicalLengthMm,
    requiredPhysicalLengthPerSegmentMm: requiredPhysicalLengthMm / segmentCount,
    providedPhysicalLengthMm: Number.isFinite(providedPhysicalLengthMm) ? providedPhysicalLengthMm : null,
    providedEffectiveLengthMm,
    providedUtilization,
    providedPasses: providedUtilization == null ? null : providedUtilization <= 1,
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
