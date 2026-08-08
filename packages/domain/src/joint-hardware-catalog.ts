import { getBoltSize } from './connection-catalog.js'

export const REGULAR_NUT_STANDARD = 'ISO 4032 / DIN 934, справочная геометрия'
export const COUPLING_NUT_STANDARD = 'DIN 6334, соединительная гайка высотой 3d'
export const HARDWARE_STEEL_DENSITY_KG_M3 = 7850
export const MIN_CLEARANCE_DIAMETER_MM = 0.5
export const DEFAULT_THREAD_ENGAGEMENT_FACTOR = 2
export const DEFAULT_ASSEMBLY_ALLOWANCE_MM = 2

export interface RegularNut {
  readonly threadDiameterMm: number
  readonly pitchMm: number
  readonly heightMm: number
  readonly acrossFlatsMm: number
  readonly standard: string
}

export interface CouplingNut {
  readonly threadDiameterMm: number
  readonly pitchMm: number
  readonly lengthMm: number
  readonly acrossFlatsMm: number
  readonly standard: string
}

export interface ClearanceNut extends RegularNut {
  readonly basicMinorDiameterMm: number
  readonly diametralClearanceMm: number
}

export interface JointHardwareOptions {
  boltDiameterMm: unknown
  boltClass?: string | null
  minimumClearanceMm?: number
  clearanceNutThreadMm?: unknown
  threadEngagementFactor?: number
  assemblyAllowanceMm?: number
  boltLengthMm?: number | null
}

export const REGULAR_NUTS: readonly RegularNut[] = Object.freeze([
  { threadDiameterMm: 16, pitchMm: 2, heightMm: 14.8, acrossFlatsMm: 24 },
  { threadDiameterMm: 18, pitchMm: 2.5, heightMm: 15, acrossFlatsMm: 27 },
  { threadDiameterMm: 20, pitchMm: 2.5, heightMm: 18, acrossFlatsMm: 30 },
  { threadDiameterMm: 22, pitchMm: 2.5, heightMm: 19.4, acrossFlatsMm: 34 },
  { threadDiameterMm: 24, pitchMm: 3, heightMm: 21.5, acrossFlatsMm: 36 },
  { threadDiameterMm: 27, pitchMm: 3, heightMm: 23.8, acrossFlatsMm: 41 },
  { threadDiameterMm: 30, pitchMm: 3.5, heightMm: 25.6, acrossFlatsMm: 46 },
  { threadDiameterMm: 33, pitchMm: 3.5, heightMm: 28.7, acrossFlatsMm: 50 },
  { threadDiameterMm: 36, pitchMm: 4, heightMm: 31, acrossFlatsMm: 55 },
  { threadDiameterMm: 39, pitchMm: 4, heightMm: 33.4, acrossFlatsMm: 60 },
  { threadDiameterMm: 42, pitchMm: 4.5, heightMm: 34, acrossFlatsMm: 65 },
  { threadDiameterMm: 45, pitchMm: 4.5, heightMm: 38.9, acrossFlatsMm: 70 },
  { threadDiameterMm: 48, pitchMm: 5, heightMm: 38, acrossFlatsMm: 75 },
  { threadDiameterMm: 52, pitchMm: 5, heightMm: 44.2, acrossFlatsMm: 80 },
  { threadDiameterMm: 56, pitchMm: 5.5, heightMm: 45, acrossFlatsMm: 85 },
  { threadDiameterMm: 60, pitchMm: 5.5, heightMm: 50.8, acrossFlatsMm: 90 },
  { threadDiameterMm: 64, pitchMm: 6, heightMm: 51, acrossFlatsMm: 95 },
].map((item) => Object.freeze({ ...item, standard: REGULAR_NUT_STANDARD })))

export const COUPLING_NUTS: readonly CouplingNut[] = Object.freeze([
  { threadDiameterMm: 16, pitchMm: 2, lengthMm: 48, acrossFlatsMm: 24, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 18, pitchMm: 2.5, lengthMm: 54, acrossFlatsMm: 27, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 20, pitchMm: 2.5, lengthMm: 60, acrossFlatsMm: 30, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 22, pitchMm: 2.5, lengthMm: 66, acrossFlatsMm: 34, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 24, pitchMm: 3, lengthMm: 72, acrossFlatsMm: 36, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 27, pitchMm: 3, lengthMm: 81, acrossFlatsMm: 41, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 30, pitchMm: 3.5, lengthMm: 90, acrossFlatsMm: 46, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 33, pitchMm: 3.5, lengthMm: 99, acrossFlatsMm: 50, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 36, pitchMm: 4, lengthMm: 108, acrossFlatsMm: 55, standard: COUPLING_NUT_STANDARD },
  { threadDiameterMm: 39, pitchMm: 4, lengthMm: 117, acrossFlatsMm: 60, standard: 'Расчётная соединительная гайка 3d; размер подтвердить у поставщика' },
  { threadDiameterMm: 42, pitchMm: 4.5, lengthMm: 126, acrossFlatsMm: 65, standard: 'Расчётная соединительная гайка 3d; размер подтвердить у поставщика' },
  { threadDiameterMm: 45, pitchMm: 4.5, lengthMm: 135, acrossFlatsMm: 70, standard: 'Расчётная соединительная гайка 3d; размер подтвердить у поставщика' },
  { threadDiameterMm: 48, pitchMm: 5, lengthMm: 144, acrossFlatsMm: 75, standard: 'Расчётная соединительная гайка 3d; размер подтвердить у поставщика' },
].map((item) => Object.freeze(item)))

export const JOINT_BOLT_LENGTHS_MM = Object.freeze([
  40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140,
  150, 160, 180, 200, 220, 240, 260, 280, 300,
])

export const THREAD_ENGAGEMENT_FACTORS = Object.freeze([1, 1.5, 2])
export const WELD_LEG_SIZES_MM = Object.freeze([3, 4, 5, 6, 8, 10, 12])
export const WELD_SEGMENT_COUNTS = Object.freeze([1, 2, 3, 4])

export function metricInternalThreadMinorDiameterMm(diameterMm: unknown, pitchMm: unknown): number {
  const diameter = Number(diameterMm)
  const pitch = Number(pitchMm)
  if (!(diameter > 0) || !(pitch > 0)) throw new Error('Диаметр и шаг внутренней резьбы должны быть положительными')
  return diameter - 1.082532 * pitch
}

export function getRegularNut(threadDiameterMm: unknown): RegularNut {
  const diameter = Number(threadDiameterMm)
  const nut = REGULAR_NUTS.find((item) => item.threadDiameterMm === diameter)
  if (!nut) throw new Error(`Нет геометрии обычной гайки M${String(threadDiameterMm)}`)
  return nut
}

export function getCouplingNutForBolt(boltDiameterMm: unknown): CouplingNut {
  const diameter = Number(boltDiameterMm)
  const nut = COUPLING_NUTS.find((item) => item.threadDiameterMm === diameter)
  if (!nut) throw new Error(`Нет соединительной гайки для болта M${String(boltDiameterMm)}`)
  return nut
}

export function clearanceNutOptionsForBolt(boltDiameterMm: unknown, minimumClearanceMm = MIN_CLEARANCE_DIAMETER_MM): ClearanceNut[] {
  const bolt = getBoltSize(boltDiameterMm)
  return REGULAR_NUTS
    .map((nut) => ({ ...nut, basicMinorDiameterMm: metricInternalThreadMinorDiameterMm(nut.threadDiameterMm, nut.pitchMm) }))
    .map((nut) => ({ ...nut, diametralClearanceMm: nut.basicMinorDiameterMm - bolt.diameterMm }))
    .filter((nut) => nut.threadDiameterMm > bolt.diameterMm && nut.diametralClearanceMm >= minimumClearanceMm)
}

export function minimumClearanceNutForBolt(boltDiameterMm: unknown, minimumClearanceMm = MIN_CLEARANCE_DIAMETER_MM): ClearanceNut | null {
  return clearanceNutOptionsForBolt(boltDiameterMm, minimumClearanceMm)[0] ?? null
}

export function minimumStandardBoltLengthMm(requiredLengthMm: unknown): number | null {
  const required = Number(requiredLengthMm)
  if (!Number.isFinite(required) || required <= 0) throw new Error('Требуемая длина болта должна быть положительной')
  return JOINT_BOLT_LENGTHS_MM.find((length) => length + 1e-9 >= required) ?? null
}

export function suggestedWeldLegMm(barDiameterMm: unknown): number | undefined {
  const target = Math.max(3, Number(barDiameterMm) / 3)
  return WELD_LEG_SIZES_MM.find((value) => value >= target) ?? WELD_LEG_SIZES_MM.at(-1)
}

export function buildJointHardwareGeometry(options: JointHardwareOptions) {
  const bolt = getBoltSize(options.boltDiameterMm)
  const couplingNut = getCouplingNutForBolt(bolt.diameterMm)
  const minimumClearanceMm = Number(options.minimumClearanceMm ?? MIN_CLEARANCE_DIAMETER_MM)
  const automaticClearanceNut = minimumClearanceNutForBolt(bolt.diameterMm, minimumClearanceMm)
  if (!automaticClearanceNut) throw new Error(`Для M${bolt.diameterMm} не найдена проходная гайка с большим внутренним диаметром`)
  const clearanceNut = options.clearanceNutThreadMm == null
    ? automaticClearanceNut
    : (() => {
        const selected = getRegularNut(options.clearanceNutThreadMm)
        const basicMinorDiameterMm = metricInternalThreadMinorDiameterMm(selected.threadDiameterMm, selected.pitchMm)
        return { ...selected, basicMinorDiameterMm, diametralClearanceMm: basicMinorDiameterMm - bolt.diameterMm }
      })()

  const engagementFactor = Number(options.threadEngagementFactor ?? DEFAULT_THREAD_ENGAGEMENT_FACTOR)
  if (!(engagementFactor > 0)) throw new Error('Коэффициент длины зацепления резьбы должен быть положительным')
  const assemblyAllowanceMm = Number(options.assemblyAllowanceMm ?? DEFAULT_ASSEMBLY_ALLOWANCE_MM)
  const threadEngagementMm = engagementFactor * bolt.diameterMm
  const minimumRequiredBoltLengthMm = clearanceNut.heightMm + threadEngagementMm + assemblyAllowanceMm
  const automaticBoltLengthMm = minimumStandardBoltLengthMm(minimumRequiredBoltLengthMm)
  const boltLengthMm = Number(options.boltLengthMm ?? automaticBoltLengthMm)
  const clearancePasses = clearanceNut.threadDiameterMm > bolt.diameterMm && clearanceNut.diametralClearanceMm >= minimumClearanceMm
  const engagementPasses = threadEngagementMm + assemblyAllowanceMm <= couplingNut.lengthMm + 1e-9
  const boltLengthPasses = Number.isFinite(boltLengthMm) && boltLengthMm + 1e-9 >= minimumRequiredBoltLengthMm
  const effectiveRadiusMm = couplingNut.acrossFlatsMm / 2

  return {
    method: 'two-nuts-one-bolt-joint-geometry-v2',
    bolt: {
      diameterMm: bolt.diameterMm,
      pitchMm: bolt.pitchMm,
      classId: options.boltClass ?? null,
      lengthMm: boltLengthMm,
      automaticLengthMm: automaticBoltLengthMm,
      minimumRequiredLengthMm: minimumRequiredBoltLengthMm,
      headAcrossFlatsMm: bolt.headAcrossFlatsMm,
      headHeightMm: bolt.headHeightMm,
      fullThreadAssumed: true,
      scopeNote: bolt.scopeNote ?? null,
    },
    topCouplingNut: {
      ...couplingNut,
      threadEngagementMm,
      engagedThreadTurns: threadEngagementMm / bolt.pitchMm,
      ribCount: 4,
      purpose: 'Верхний узел модуля: к длинной соединительной гайке приварены четыре ребра; болт ввинчивается в её резьбу.',
    },
    bottomClearanceNut: {
      ...clearanceNut,
      ribCount: 2,
      purpose: 'Конец ножки: к обычной гайке большего размера приварены два ребра; болт свободно проходит через её внутреннюю резьбу без зацепления.',
    },
    minimumClearanceMm,
    clearancePasses,
    threadEngagementFactor: engagementFactor,
    threadEngagementMm,
    engagedThreadTurns: threadEngagementMm / bolt.pitchMm,
    couplingNutEngagedFraction: threadEngagementMm / couplingNut.lengthMm,
    assemblyAllowanceMm,
    engagementPasses,
    boltLengthPasses,
    effectiveRadiusMm,
    passes: clearancePasses && engagementPasses && boltLengthPasses,
  }
}
