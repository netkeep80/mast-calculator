export const STOCK_BAR_LENGTHS_MM = Object.freeze([11800, 12000])

export const STOCK_BAR_DIVISIONS = Object.freeze(
  Array.from({ length: 17 }, (_, index) => index + 8),
)

// Практический ряд наиболее распространённых номинальных диаметров из
// сортамента ГОСТ 34028-2016. Полный стандарт допускает и промежуточные размеры.
export const STANDARD_DIAMETERS_MM = Object.freeze([
  6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40,
])

export const REINFORCEMENT_CLASSES = Object.freeze({
  A400C: Object.freeze({
    id: 'A400C',
    label: 'А400С',
    standard: 'ГОСТ 34028-2016',
    weldabilityGuaranteed: true,
    youngModulusGPa: 200,
    yieldStrengthMPa: 390,
    tensileStrengthMPa: 590,
    densityKgM3: 7850,
  }),
  A500C: Object.freeze({
    id: 'A500C',
    label: 'А500С',
    standard: 'ГОСТ 34028-2016',
    weldabilityGuaranteed: true,
    youngModulusGPa: 200,
    yieldStrengthMPa: 500,
    tensileStrengthMPa: 600,
    densityKgM3: 7850,
  }),
  A600C: Object.freeze({
    id: 'A600C',
    label: 'А600С',
    standard: 'ГОСТ 34028-2016',
    weldabilityGuaranteed: true,
    youngModulusGPa: 200,
    yieldStrengthMPa: 600,
    tensileStrengthMPa: 700,
    densityKgM3: 7850,
  }),
})

export const REINFORCEMENT_CLASS_IDS = Object.freeze(Object.keys(REINFORCEMENT_CLASSES))

const positiveNumber = (value, name) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должно быть положительным числом`)
  return numeric
}

export function theoreticalCutLengthMm(stockBarLengthMm, stockBarPieces) {
  const stockLength = positiveNumber(stockBarLengthMm, 'Закупочная длина арматуры')
  const pieces = positiveNumber(stockBarPieces, 'Количество частей')
  if (!Number.isInteger(pieces)) throw new Error('Количество частей должно быть целым числом')
  return stockLength / pieces
}

export function getReinforcementClass(classId) {
  const material = REINFORCEMENT_CLASSES[classId]
  if (!material) throw new Error(`Неизвестный класс арматуры: ${classId}`)
  return material
}

export function applyReinforcementClass(parameters) {
  const material = getReinforcementClass(parameters.reinforcementClass)
  return {
    ...parameters,
    youngModulusGPa: material.youngModulusGPa,
    yieldStrengthMPa: material.yieldStrengthMPa,
    tensileStrengthMPa: material.tensileStrengthMPa,
    densityKgM3: material.densityKgM3,
    reinforcementStandard: material.standard,
    reinforcementWeldabilityGuaranteed: material.weldabilityGuaranteed,
  }
}
