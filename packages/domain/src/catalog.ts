export const STOCK_BAR_LENGTHS_MM = Object.freeze([11800, 12000] as const)

// Issue #36: изготовителю может понадобиться любой целочисленный раскрой
// закупочного прутка от одного цельного ребра до 48 равных заготовок.
export const STOCK_BAR_DIVISIONS = Object.freeze(
  Array.from({ length: 48 }, (_, index) => index + 1),
)

// Практический ряд наиболее распространённых номинальных диаметров из
// сортамента ГОСТ 34028-2016. Полный стандарт допускает и промежуточные размеры.
export const STANDARD_DIAMETERS_MM = Object.freeze([
  6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40,
] as const)

export interface ReinforcementClass {
  readonly id: string
  readonly label: string
  readonly standard: string
  readonly weldabilityGuaranteed: boolean
  readonly youngModulusGPa: number
  readonly poissonRatio: number
  readonly densityKgM3: number
  readonly yieldStrengthMPa: number
  readonly tensileStrengthMPa: number
}

const COMMON_STEEL = Object.freeze({
  youngModulusGPa: 200,
  poissonRatio: 0.3,
  densityKgM3: 7850,
})

export const REINFORCEMENT_CLASSES = Object.freeze({
  A400C: Object.freeze({
    id: 'A400C',
    label: 'А400С',
    standard: 'ГОСТ 34028-2016',
    weldabilityGuaranteed: true,
    ...COMMON_STEEL,
    yieldStrengthMPa: 390,
    tensileStrengthMPa: 590,
  }),
  A500C: Object.freeze({
    id: 'A500C',
    label: 'А500С',
    standard: 'ГОСТ 34028-2016',
    weldabilityGuaranteed: true,
    ...COMMON_STEEL,
    yieldStrengthMPa: 500,
    tensileStrengthMPa: 600,
  }),
  A600C: Object.freeze({
    id: 'A600C',
    label: 'А600С',
    standard: 'ГОСТ 34028-2016',
    weldabilityGuaranteed: true,
    ...COMMON_STEEL,
    yieldStrengthMPa: 600,
    tensileStrengthMPa: 700,
  }),
} satisfies Record<string, ReinforcementClass>)

export type ReinforcementClassId = keyof typeof REINFORCEMENT_CLASSES
export const REINFORCEMENT_CLASS_IDS = Object.freeze(Object.keys(REINFORCEMENT_CLASSES) as ReinforcementClassId[])

const positiveNumber = (value: unknown, name: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должно быть положительным числом`)
  return numeric
}

export function theoreticalCutLengthMm(stockBarLengthMm: unknown, stockBarPieces: unknown): number {
  const stockLength = positiveNumber(stockBarLengthMm, 'Закупочная длина арматуры')
  const pieces = positiveNumber(stockBarPieces, 'Количество частей')
  if (!Number.isInteger(pieces)) throw new Error('Количество частей должно быть целым числом')
  if (pieces > 48) throw new Error('Количество частей должно быть от 1 до 48')
  return stockLength / pieces
}

export function regularOctahedronHeightMm(edgeLengthMm: unknown): number {
  const edge = positiveNumber(edgeLengthMm, 'Длина ребра октаэдра')
  return edge * Math.sqrt(2 / 3)
}

export function getReinforcementClass(classId: string): ReinforcementClass {
  if (!(classId in REINFORCEMENT_CLASSES)) throw new Error(`Неизвестный класс арматуры: ${classId}`)
  return REINFORCEMENT_CLASSES[classId as ReinforcementClassId]
}

export interface ReinforcementParameters {
  reinforcementClass: string
  [key: string]: unknown
}

export function applyReinforcementClass<T extends ReinforcementParameters>(parameters: T) {
  const material = getReinforcementClass(parameters.reinforcementClass)
  return {
    ...parameters,
    youngModulusGPa: material.youngModulusGPa,
    poissonRatio: material.poissonRatio,
    yieldStrengthMPa: material.yieldStrengthMPa,
    tensileStrengthMPa: material.tensileStrengthMPa,
    densityKgM3: material.densityKgM3,
    reinforcementStandard: material.standard,
    reinforcementWeldabilityGuaranteed: material.weldabilityGuaranteed,
  }
}
