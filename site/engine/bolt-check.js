import {
  BOLT_PROPERTY_CLASS_IDS,
  BOLT_SIZES,
  getBoltClass,
  getBoltSize,
} from './connection-catalog.js'

const EPSILON_FORCE_N = 1e-9

const positiveFactor = (value, name) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должен быть положительным числом`)
  return numeric
}

export function calculateBoltCapacity({
  diameterMm,
  boltClass,
  connectionConditionFactor = 1,
  shearPlanes = 1,
}) {
  const size = getBoltSize(diameterMm)
  const propertyClass = getBoltClass(boltClass)
  const gammaC = positiveFactor(connectionConditionFactor, 'Коэффициент условий работы соединения')
  const planes = positiveFactor(shearPlanes, 'Число плоскостей среза')
  const shearCapacityN = propertyClass.rbsMPa * size.grossAreaMm2 * planes * gammaC
  const tensionCapacityN = Number.isFinite(propertyClass.rbtMPa)
    ? propertyClass.rbtMPa * size.netAreaMm2 * gammaC
    : null
  const characteristicRuptureN = propertyClass.rbunMPa * size.netAreaMm2

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
    nutClassForTension: propertyClass.nutClassForTension,
    note: propertyClass.note ?? null,
  }
}

export function checkBoltDemand(demand, options) {
  const tensionN = Math.max(0, Number(demand.tensionN) || 0)
  const shearN = Math.max(0, Number(demand.shearN) || 0)
  const capacity = calculateBoltCapacity(options)
  const shearUtilization = shearN / Math.max(capacity.shearCapacityN, Number.EPSILON)
  const tensionSupported = capacity.tensionCapacityN != null || tensionN <= EPSILON_FORCE_N
  const tensionUtilization = tensionN <= EPSILON_FORCE_N
    ? 0
    : tensionSupported
      ? tensionN / Math.max(capacity.tensionCapacityN, Number.EPSILON)
      : Number.POSITIVE_INFINITY
  const interactionUtilization = Math.hypot(shearUtilization, tensionUtilization)
  const governingUtilization = Math.max(shearUtilization, tensionUtilization, interactionUtilization)
  const loadFactorToDesignLimit = governingUtilization > Number.EPSILON
    ? 1 / governingUtilization
    : Number.POSITIVE_INFINITY
  const resultantDemandN = Math.hypot(tensionN, shearN)

  return {
    ...capacity,
    tensionN,
    shearN,
    resultantDemandN,
    shearUtilization,
    tensionUtilization,
    interactionUtilization,
    utilization: governingUtilization,
    passes: tensionSupported && governingUtilization <= 1,
    tensionSupported,
    loadFactorToDesignLimit,
    equivalentResultantAtDesignLimitN: Number.isFinite(loadFactorToDesignLimit)
      ? resultantDemandN * loadFactorToDesignLimit
      : Number.POSITIVE_INFINITY,
  }
}

export function evaluateBoltAcrossDemands(demands, options) {
  if (!Array.isArray(demands) || demands.length === 0) {
    throw new Error('Для проверки болта нужен непустой набор нагрузок узла')
  }
  const checks = demands.map((demand) => ({
    demand,
    check: checkBoltDemand(demand, options),
  }))
  const governing = checks.reduce((best, candidate) => (
    candidate.check.utilization > best.check.utilization ? candidate : best
  ), checks[0])
  return {
    options: { ...options },
    checks,
    governingDemand: governing.demand,
    governingCheck: governing.check,
    utilization: governing.check.utilization,
    passes: checks.every((item) => item.check.passes),
  }
}

export function minimumBoltForClass(demands, boltClass, options = {}) {
  const candidates = BOLT_SIZES.map((size) => {
    const evaluation = evaluateBoltAcrossDemands(demands, {
      diameterMm: size.diameterMm,
      boltClass,
      connectionConditionFactor: options.connectionConditionFactor ?? 1,
      shearPlanes: options.shearPlanes ?? 1,
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

export function buildBoltRecommendations(demands, options = {}) {
  return BOLT_PROPERTY_CLASS_IDS.map((boltClass) => minimumBoltForClass(demands, boltClass, options))
}
