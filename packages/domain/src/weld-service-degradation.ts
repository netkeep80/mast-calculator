export const DEFAULT_WELD_SERVICE_YEARS = 25
export const DEFAULT_WELD_INITIAL_STIFFNESS_RETENTION = 0.97
export const DEFAULT_WELD_ANNUAL_STIFFNESS_LOSS_RATE = 0.0015
export const DEFAULT_WELD_MINIMUM_STIFFNESS_RETENTION = 0.85

export interface WeldServiceDegradationOptions {
  serviceYears?: unknown
  initialStiffnessRetention?: unknown
  annualStiffnessLossRate?: unknown
  minimumStiffnessRetention?: unknown
}

const finite = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback

export function calculateWeldServiceDegradation(options: WeldServiceDegradationOptions = {}) {
  const serviceYears = Math.max(0, finite(options.serviceYears, DEFAULT_WELD_SERVICE_YEARS))
  const initialRetention = finite(options.initialStiffnessRetention, DEFAULT_WELD_INITIAL_STIFFNESS_RETENTION)
  const annualLossRate = finite(options.annualStiffnessLossRate, DEFAULT_WELD_ANNUAL_STIFFNESS_LOSS_RATE)
  const minimumRetention = finite(options.minimumStiffnessRetention, DEFAULT_WELD_MINIMUM_STIFFNESS_RETENTION)

  if (!(initialRetention > 0 && initialRetention <= 1)) {
    throw new Error('Начальное сохранение жёсткости сварной зоны должно быть в диапазоне (0; 1]')
  }
  if (!(annualLossRate >= 0 && annualLossRate < 1)) {
    throw new Error('Годовая скорость деградации сварной зоны должна быть в диапазоне [0; 1)')
  }
  if (!(minimumRetention > 0 && minimumRetention <= initialRetention)) {
    throw new Error('Минимальное сохранение жёсткости должно быть > 0 и не выше начального')
  }

  const uncappedRetention = initialRetention * (1 - annualLossRate) ** serviceYears
  const stiffnessRetentionFactor = Math.max(minimumRetention, uncappedRetention)

  return {
    model: 'project-weld-zone-service-reserve-v1',
    serviceYears,
    initialStiffnessRetention: initialRetention,
    annualStiffnessLossRate: annualLossRate,
    minimumStiffnessRetention: minimumRetention,
    uncappedStiffnessRetention: uncappedRetention,
    stiffnessRetentionFactor,
    stiffnessLossFraction: 1 - stiffnessRetentionFactor,
    sourceStatus: 'Консервативный параметрический reserve model проекта, не нормативный универсальный закон старения стали.',
    physicalBoundary: 'Календарный возраст сам по себе не заменяет fatigue/fracture, corrosion, дефектоскопию и расчёт реальной податливости соединения.',
  }
}
