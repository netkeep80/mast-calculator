import {
  BOLT_PROPERTY_CLASS_IDS,
  BOLT_SIZES,
  getBoltClass,
  getBoltSize,
} from '../../domain/index.js'
import {
  calculateBoltPreload,
  DEFAULT_NUT_FACTOR,
  DEFAULT_PRELOAD_VARIATION,
  torqueForNominalPreloadNm,
} from './bolt-preload.js'

const EPSILON_FORCE_N = 1e-9
const UTILIZATION_TOLERANCE = 1e-12

const positiveFactor = (value: unknown, name: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должен быть положительным числом`)
  return numeric
}

const nonNegative = (value: unknown, name: string): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`${name} должен быть неотрицательным числом`)
  return numeric
}

export interface BoltCapacityInput {
  diameterMm: number
  boltClass: string
  connectionConditionFactor?: number
  shearPlanes?: number
  tighteningTorqueNm?: number
  nutFactor?: number
  preloadVariation?: number
}

export interface BoltDemand {
  tensionN?: unknown
  shearN?: unknown
  readonly [key: string]: unknown
}

export function calculateBoltCapacity({
  diameterMm,
  boltClass,
  connectionConditionFactor = 1,
  shearPlanes = 1,
  tighteningTorqueNm = 0,
  nutFactor = DEFAULT_NUT_FACTOR,
  preloadVariation = DEFAULT_PRELOAD_VARIATION,
}: BoltCapacityInput) {
  const size = getBoltSize(diameterMm)
  const propertyClass = getBoltClass(boltClass)
  const gammaC = positiveFactor(connectionConditionFactor, 'Коэффициент условий работы соединения')
  const planes = positiveFactor(shearPlanes, 'Число плоскостей среза')
  const torqueNm = nonNegative(tighteningTorqueNm, 'Момент затяжки')
  const shearCapacityN = propertyClass.rbsMPa * size.grossAreaMm2 * planes * gammaC
  const tensionCapacityN = Number.isFinite(propertyClass.rbtMPa)
    ? propertyClass.rbtMPa! * size.netAreaMm2 * gammaC
    : null
  const characteristicRuptureN = propertyClass.rbunMPa * size.netAreaMm2
  const preload = calculateBoltPreload({
    tighteningTorqueNm: torqueNm,
    diameterMm: size.diameterMm,
    nutFactor,
    preloadVariation,
  })
  const externalTensionReserveN = tensionCapacityN == null
    ? null
    : Math.max(0, tensionCapacityN - preload.maximumPreloadN)
  const designTorqueAtTensionCapacityNm = tensionCapacityN == null
    ? null
    : torqueForNominalPreloadNm(
        tensionCapacityN / (1 + preload.preloadVariation),
        size.diameterMm,
        preload.nutFactor,
      )

  return {
    diameterMm: size.diameterMm,
    pitchMm: size.pitchMm,
    boltClass: propertyClass.id,
    grossAreaMm2: size.grossAreaMm2,
    netAreaMm2: size.netAreaMm2,
    rbunMPa: propertyClass.rbunMPa,
    rbsMPa: propertyClass.rbsMPa,
    rbtMPa: propertyClass.rbtMPa,
    connectionConditionFactor: gammaC,
    shearPlanes: planes,
    shearCapacityN,
    tensionCapacityN,
    characteristicRuptureN,
    preload,
    externalTensionReserveN,
    designTorqueAtTensionCapacityNm,
    nutClassForTension: propertyClass.nutClassForTension,
    note: propertyClass.note ?? null,
  }
}

type BoltCapacity = ReturnType<typeof calculateBoltCapacity>

function externalDemandScaleToDesignLimit(capacity: BoltCapacity, tensionN: number, shearN: number): number {
  const preloadN = capacity.preload.maximumPreloadN
  if (capacity.tensionCapacityN == null) {
    if (preloadN > EPSILON_FORCE_N || tensionN > EPSILON_FORCE_N) return 0
    return shearN > EPSILON_FORCE_N
      ? capacity.shearCapacityN / shearN
      : Number.POSITIVE_INFINITY
  }

  const tensionCapacityN = Math.max(capacity.tensionCapacityN, Number.EPSILON)
  const shearCapacityN = Math.max(capacity.shearCapacityN, Number.EPSILON)
  const preloadRatio = preloadN / tensionCapacityN
  if (preloadRatio > 1 + UTILIZATION_TOLERANCE) return 0

  const externalTensionRatio = tensionN / tensionCapacityN
  const shearRatio = shearN / shearCapacityN
  const quadraticA = externalTensionRatio ** 2 + shearRatio ** 2
  if (quadraticA <= Number.EPSILON) return Number.POSITIVE_INFINITY

  const quadraticB = 2 * preloadRatio * externalTensionRatio
  const quadraticC = preloadRatio ** 2 - 1
  const discriminant = Math.max(0, quadraticB ** 2 - 4 * quadraticA * quadraticC)
  const factor = (-quadraticB + Math.sqrt(discriminant)) / (2 * quadraticA)
  return Math.max(0, factor)
}

export function checkBoltDemand(demand: BoltDemand, options: BoltCapacityInput) {
  const tensionN = Math.max(0, Number(demand.tensionN) || 0)
  const shearN = Math.max(0, Number(demand.shearN) || 0)
  const capacity = calculateBoltCapacity(options)
  const strengthTensionN = tensionN + capacity.preload.maximumPreloadN
  const shearUtilization = shearN / Math.max(capacity.shearCapacityN, Number.EPSILON)
  const tensionSupported = capacity.tensionCapacityN != null || strengthTensionN <= EPSILON_FORCE_N
  const tensionUtilization = strengthTensionN <= EPSILON_FORCE_N
    ? 0
    : tensionSupported
      ? strengthTensionN / Math.max(capacity.tensionCapacityN!, Number.EPSILON)
      : Number.POSITIVE_INFINITY
  const preloadUtilization = capacity.tensionCapacityN == null
    ? capacity.preload.maximumPreloadN <= EPSILON_FORCE_N ? 0 : Number.POSITIVE_INFINITY
    : capacity.preload.maximumPreloadN / Math.max(capacity.tensionCapacityN, Number.EPSILON)
  const externalTensionUtilization = capacity.tensionCapacityN == null
    ? tensionN <= EPSILON_FORCE_N ? 0 : Number.POSITIVE_INFINITY
    : tensionN / Math.max(capacity.tensionCapacityN, Number.EPSILON)
  const interactionUtilization = Math.hypot(shearUtilization, tensionUtilization)
  const governingUtilization = Math.max(
    shearUtilization,
    tensionUtilization,
    preloadUtilization,
    interactionUtilization,
  )
  const loadFactorToDesignLimit = tensionSupported
    ? externalDemandScaleToDesignLimit(capacity, tensionN, shearN)
    : 0
  const resultantDemandN = Math.hypot(strengthTensionN, shearN)
  const equivalentResultantAtDesignLimitN = Number.isFinite(loadFactorToDesignLimit)
    ? Math.hypot(
        capacity.preload.maximumPreloadN + tensionN * loadFactorToDesignLimit,
        shearN * loadFactorToDesignLimit,
      )
    : Number.POSITIVE_INFINITY

  return {
    ...capacity,
    tensionN,
    serviceExternalTensionN: tensionN,
    strengthTensionN,
    shearN,
    resultantDemandN,
    shearUtilization,
    externalTensionUtilization,
    preloadUtilization,
    tensionUtilization,
    interactionUtilization,
    utilization: governingUtilization,
    passes: tensionSupported && governingUtilization <= 1 + UTILIZATION_TOLERANCE,
    tensionSupported,
    loadFactorToDesignLimit,
    equivalentResultantAtDesignLimitN,
  }
}

export function evaluateBoltAcrossDemands(demands: readonly BoltDemand[], options: BoltCapacityInput) {
  if (!Array.isArray(demands) || demands.length === 0) {
    throw new Error('Для проверки болта нужен непустой набор нагрузок узла')
  }
  const checks = demands.map((demand) => ({
    demand,
    check: checkBoltDemand(demand, options),
  }))
  const governing = checks.reduce((best, candidate) => (
    candidate.check.utilization > best.check.utilization ? candidate : best
  ), checks[0]!)
  return {
    options: { ...options },
    checks,
    governingDemand: governing.demand,
    governingCheck: governing.check,
    utilization: governing.check.utilization,
    passes: checks.every((item) => item.check.passes),
  }
}

export type BoltRecommendationOptions = Partial<Omit<BoltCapacityInput, 'diameterMm' | 'boltClass'>>

export function minimumBoltForClass(
  demands: readonly BoltDemand[],
  boltClass: string,
  options: BoltRecommendationOptions = {},
) {
  const candidates = BOLT_SIZES.map((size) => {
    const evaluation = evaluateBoltAcrossDemands(demands, {
      diameterMm: size.diameterMm,
      boltClass,
      connectionConditionFactor: options.connectionConditionFactor ?? 1,
      shearPlanes: options.shearPlanes ?? 1,
      tighteningTorqueNm: options.tighteningTorqueNm ?? 0,
      nutFactor: options.nutFactor ?? DEFAULT_NUT_FACTOR,
      preloadVariation: options.preloadVariation ?? DEFAULT_PRELOAD_VARIATION,
    })
    return {
      diameterMm: size.diameterMm,
      pitchMm: size.pitchMm,
      evaluation,
      passes: evaluation.passes,
    }
  })
  const recommended = candidates.find((candidate) => candidate.passes) ?? null
  return {
    boltClass,
    recommended,
    candidates,
  }
}

export function buildBoltRecommendations(
  demands: readonly BoltDemand[],
  options: BoltRecommendationOptions = {},
) {
  return BOLT_PROPERTY_CLASS_IDS.map((boltClass) => minimumBoltForClass(demands, boltClass, options))
}
