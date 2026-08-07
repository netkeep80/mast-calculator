import { calculateWeldServiceDegradation } from './weld-service-degradation.js'

export const DEFAULT_WELD_AFFECTED_ZONE_LENGTH_FACTOR = 4
export const MINIMUM_WELD_AFFECTED_ZONE_LENGTH_MM = 25

const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback

// Equivalent-member compliance model. Each rib is treated as a nominal elastic
// middle segment plus two short end zones with reduced effective stiffness.
// The exact HAZ/residual-stress compliance is fabrication-specific, therefore
// this is a transparent project reserve rather than a claimed material law.
export function calculateEquivalentMemberWeldZoneStiffness({
  memberLengthM,
  memberDiameterMm,
  weldAffectedZoneLengthFactor = DEFAULT_WELD_AFFECTED_ZONE_LENGTH_FACTOR,
  serviceYears,
  initialStiffnessRetention,
  annualStiffnessLossRate,
  minimumStiffnessRetention,
} = {}) {
  const lengthM = Number(memberLengthM)
  const diameterMm = Number(memberDiameterMm)
  const zoneLengthFactor = finiteOr(
    weldAffectedZoneLengthFactor,
    DEFAULT_WELD_AFFECTED_ZONE_LENGTH_FACTOR,
  )
  if (!(lengthM > 0)) throw new Error('Длина ребра должна быть положительной')
  if (!(diameterMm > 0)) throw new Error('Диаметр ребра должен быть положительным')
  if (!(zoneLengthFactor > 0)) throw new Error('Коэффициент длины околошовной зоны должен быть положительным')

  const serviceDegradation = calculateWeldServiceDegradation({
    serviceYears,
    initialStiffnessRetention,
    annualStiffnessLossRate,
    minimumStiffnessRetention,
  })
  const lengthMm = lengthM * 1000
  const requestedZoneLengthMm = Math.max(
    MINIMUM_WELD_AFFECTED_ZONE_LENGTH_MM,
    zoneLengthFactor * diameterMm,
  )
  // Two end zones may not overlap. Keep at least a numerically meaningful
  // middle segment so the series-compliance expression remains transparent.
  const zoneLengthMm = Math.min(requestedZoneLengthMm, lengthMm * 0.49)
  const middleLengthMm = Math.max(0, lengthMm - 2 * zoneLengthMm)
  const zoneRetention = serviceDegradation.stiffnessRetentionFactor
  const complianceEquivalentLengthMm = middleLengthMm + 2 * zoneLengthMm / zoneRetention
  const equivalentStiffnessRetentionFactor = lengthMm / complianceEquivalentLengthMm

  return {
    model: 'two-end-weld-zone-series-compliance-v1',
    memberLengthM: lengthM,
    memberDiameterMm: diameterMm,
    weldAffectedZoneLengthFactor: zoneLengthFactor,
    requestedZoneLengthMm,
    zoneLengthMm,
    zoneCount: 2,
    middleLengthMm,
    zoneStiffnessRetentionFactor: zoneRetention,
    equivalentStiffnessRetentionFactor,
    equivalentStiffnessLossFraction: 1 - equivalentStiffnessRetentionFactor,
    serviceDegradation,
    sourceStatus: 'Параметрический conservative stiffness reserve issue #19; длина и податливость реальной HAZ/сварного узла должны подтверждаться расчётом или испытанием.',
  }
}
