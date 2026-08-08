type DiameterParameters = {
  moduleCount?: unknown
  barDiameterMm?: unknown
  moduleDiametersMm?: unknown
}

export interface DiameterTier {
  fromModule: number
  toModule: number
  moduleCount: number
  diameterMm: number
}

const positiveDiameter = (value: unknown, name = 'Диаметр арматуры'): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${name} должен быть положительным числом`)
  }
  return numeric
}

const moduleCountFrom = (parameters: DiameterParameters): number => {
  const count = Math.floor(Number(parameters?.moduleCount))
  if (!Number.isFinite(count) || count < 1) throw new Error('Количество модулей должно быть положительным целым числом')
  return count
}

/**
 * Returns the physical rebar diameter of every module, ordered from the rigid
 * foundation upwards. `barDiameterMm` remains the uniform default. A shorter
 * explicit profile is extended with its last/top diameter so discrete
 * height-search trials stay deterministic.
 */
export function resolveModuleDiameters(parameters: DiameterParameters): number[] {
  const moduleCount = moduleCountFrom(parameters)
  const fallback = positiveDiameter(parameters?.barDiameterMm)
  const configured = Array.isArray(parameters?.moduleDiametersMm)
    ? parameters.moduleDiametersMm
    : []

  if (configured.length === 0) return Array<number>(moduleCount).fill(fallback)

  const resolved: number[] = []
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

export function maximumModuleDiameterMm(parameters: DiameterParameters): number {
  return Math.max(...resolveModuleDiameters(parameters))
}

export function minimumModuleDiameterMm(parameters: DiameterParameters): number {
  return Math.min(...resolveModuleDiameters(parameters))
}

export function isUniformModuleDiameterProfile(parametersOrDiameters: DiameterParameters | readonly unknown[]): boolean {
  const diameters = Array.isArray(parametersOrDiameters)
    ? parametersOrDiameters.map((value) => positiveDiameter(value))
    : resolveModuleDiameters(parametersOrDiameters as DiameterParameters)
  const first = diameters[0]
  if (first === undefined) return true
  return diameters.every((diameter) => Math.abs(diameter - first) < 1e-12)
}

/** Compact consecutive equal diameters into human/report-friendly tiers. */
export function buildDiameterTiers(parametersOrDiameters: DiameterParameters | readonly unknown[]): DiameterTier[] {
  const diameters = Array.isArray(parametersOrDiameters)
    ? parametersOrDiameters.map((value) => positiveDiameter(value))
    : resolveModuleDiameters(parametersOrDiameters as DiameterParameters)
  const tiers: DiameterTier[] = []
  for (let index = 0; index < diameters.length; index += 1) {
    const diameterMm = diameters[index]
    if (diameterMm === undefined) continue
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

export function diameterProfileSummary(parametersOrDiameters: DiameterParameters | readonly unknown[]): string {
  return buildDiameterTiers(parametersOrDiameters).map((tier) => {
    const range = tier.fromModule === tier.toModule
      ? `модуль ${tier.fromModule}`
      : `модули ${tier.fromModule}–${tier.toModule}`
    return `${range}: Ø${tier.diameterMm}`
  }).join('; ')
}
