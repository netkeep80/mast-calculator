const positiveDiameter = (value, name = 'Диаметр арматуры') => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${name} должен быть положительным числом`)
  }
  return numeric
}

const moduleCountFrom = (parameters) => {
  const count = Math.floor(Number(parameters?.moduleCount))
  if (!Number.isFinite(count) || count < 1) throw new Error('Количество модулей должно быть положительным целым числом')
  return count
}

/**
 * Returns the physical rebar diameter of every module, ordered from the rigid
 * foundation upwards. `barDiameterMm` remains the backwards-compatible
 * uniform default. A shorter explicit profile is extended with its last/top
 * diameter so discrete height-search trials stay deterministic.
 */
export function resolveModuleDiameters(parameters) {
  const moduleCount = moduleCountFrom(parameters)
  const fallback = positiveDiameter(parameters?.barDiameterMm)
  const configured = Array.isArray(parameters?.moduleDiametersMm)
    ? parameters.moduleDiametersMm
    : []

  if (configured.length === 0) return Array(moduleCount).fill(fallback)

  const resolved = []
  let previous = fallback
  for (let index = 0; index < moduleCount; index += 1) {
    const source = index < configured.length
      ? configured[index]
      : configured[configured.length - 1]
    if (source != null && source !== '') {
      previous = positiveDiameter(source, `Диаметр арматуры модуля ${index + 1}`)
    }
    resolved.push(previous)
  }
  return resolved
}

export function maximumModuleDiameterMm(parameters) {
  return Math.max(...resolveModuleDiameters(parameters))
}

export function minimumModuleDiameterMm(parameters) {
  return Math.min(...resolveModuleDiameters(parameters))
}

export function isUniformModuleDiameterProfile(parametersOrDiameters) {
  const diameters = Array.isArray(parametersOrDiameters)
    ? parametersOrDiameters.map((value) => positiveDiameter(value))
    : resolveModuleDiameters(parametersOrDiameters)
  return diameters.every((diameter) => Math.abs(diameter - diameters[0]) < 1e-12)
}

/** Compact consecutive equal diameters into human/report-friendly tiers. */
export function buildDiameterTiers(parametersOrDiameters) {
  const diameters = Array.isArray(parametersOrDiameters)
    ? parametersOrDiameters.map((value) => positiveDiameter(value))
    : resolveModuleDiameters(parametersOrDiameters)
  const tiers = []
  for (let index = 0; index < diameters.length; index += 1) {
    const diameterMm = diameters[index]
    const previous = tiers.at(-1)
    if (previous && Math.abs(previous.diameterMm - diameterMm) < 1e-12) {
      previous.toModule = index + 1
      previous.moduleCount += 1
    } else {
      tiers.push({
        fromModule: index + 1,
        toModule: index + 1,
        moduleCount: 1,
        diameterMm,
      })
    }
  }
  return tiers
}

export function diameterProfileSummary(parametersOrDiameters) {
  return buildDiameterTiers(parametersOrDiameters).map((tier) => {
    const range = tier.fromModule === tier.toModule
      ? `модуль ${tier.fromModule}`
      : `модули ${tier.fromModule}–${tier.toModule}`
    return `${range}: Ø${tier.diameterMm}`
  }).join('; ')
}
