export const DEFAULT_TIGHTENING_TORQUE_NM = 200
export const DEFAULT_NUT_FACTOR = 0.2
export const DEFAULT_PRELOAD_VARIATION = 0.25

const nonNegative = (value: unknown, name: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`${name} должен быть неотрицательным числом`)
  return numeric
}

const positive = (value: unknown, name: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должен быть положительным числом`)
  return numeric
}

export interface BoltPreloadInput {
  tighteningTorqueNm?: number
  diameterMm: number
  nutFactor?: number
  preloadVariation?: number
}

export function calculateBoltPreload({
  tighteningTorqueNm = DEFAULT_TIGHTENING_TORQUE_NM,
  diameterMm,
  nutFactor = DEFAULT_NUT_FACTOR,
  preloadVariation = DEFAULT_PRELOAD_VARIATION,
}: BoltPreloadInput) {
  const torqueNm = nonNegative(tighteningTorqueNm, 'Момент затяжки')
  const diameterM = positive(diameterMm, 'Диаметр болта') / 1000
  const k = positive(nutFactor, 'Коэффициент гайки K')
  const variation = nonNegative(preloadVariation, 'Относительный разброс преднатяга')
  if (variation >= 1) throw new Error('Относительный разброс преднатяга должен быть меньше 1')

  const nominalPreloadN = torqueNm === 0 ? 0 : torqueNm / (k * diameterM)
  const maximumPreloadN = nominalPreloadN * (1 + variation)
  const minimumPreloadN = nominalPreloadN * (1 - variation)

  return {
    method: 'torque-nut-factor-preload-v1' as const,
    tighteningTorqueNm: torqueNm,
    diameterMm: diameterM * 1000,
    nutFactor: k,
    preloadVariation: variation,
    nominalPreloadN,
    minimumPreloadN,
    maximumPreloadN,
    formula: 'F0 = T/(K*d); F0,max=(1+Gamma)*F0',
    note: 'Torque-to-preload имеет большой разброс из-за трения. Для прочности используется максимальный преднатяг; поперечная разгрузка за счёт трения в стыке не кредитуется.',
  }
}

export function torqueForNominalPreloadNm(
  preloadN: unknown,
  diameterMm: unknown,
  nutFactor: unknown = DEFAULT_NUT_FACTOR,
): number {
  const forceN = nonNegative(preloadN, 'Преднатяг')
  const diameterM = positive(diameterMm, 'Диаметр болта') / 1000
  const k = positive(nutFactor, 'Коэффициент гайки K')
  return k * forceN * diameterM
}
