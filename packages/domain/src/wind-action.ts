export const WIND_ACTION_MODE_MANUAL = 'manual-custom-pressure' as const
export const WIND_ACTION_MODE_SP20_MEAN_V1 = 'sp20-mean-v1' as const
export const SP20_WIND_MODEL_SOURCE = 'СП 20.13330.2016, изм. №6, раздел 11' as const

export type WindActionMode = typeof WIND_ACTION_MODE_MANUAL | typeof WIND_ACTION_MODE_SP20_MEAN_V1
export type Sp20WindRegion = 'Ia' | 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII'
export type Sp20TerrainType = 'A' | 'B' | 'C'

/** Characteristic basic wind pressure w0 from SP20 table 11.1. */
export const SP20_BASIC_WIND_PRESSURE_PA: Readonly<Record<Sp20WindRegion, number>> = Object.freeze({
  Ia: 170,
  I: 230,
  II: 300,
  III: 380,
  IV: 480,
  V: 600,
  VI: 730,
  VII: 850,
})

/** Parameters of SP20 table 11.3 used by formula 11.4 for 10 <= ze <= 300 m. */
export const SP20_TERRAIN_PARAMETERS: Readonly<Record<Sp20TerrainType, {
  readonly k10: number
  readonly alpha: number
  readonly kAt5M: number
}>> = Object.freeze({
  A: Object.freeze({ k10: 1, alpha: 0.15, kAt5M: 0.75 }),
  B: Object.freeze({ k10: 0.65, alpha: 0.20, kAt5M: 0.50 }),
  C: Object.freeze({ k10: 0.40, alpha: 0.25, kAt5M: 0.40 }),
})

export interface WindActionProvenance {
  readonly model: WindActionMode
  readonly source: string
  readonly normative: boolean
  readonly meanComponentIncluded: boolean
  readonly pulsationComponentIncluded: boolean
  readonly dynamicResponseIncluded: boolean
  readonly windRegion: Sp20WindRegion | null
  readonly terrainType: Sp20TerrainType | null
  readonly basicWindPressurePa: number | null
  readonly loadReliabilityFactor: number
  readonly aerodynamicCoefficientsAppliedSeparately: boolean
}

/**
 * SP20 k(ze): table 11.2 for ze <= 10 m (linear interpolation from 5 to 10 m),
 * formula 11.4 with table 11.3 parameters for 10 <= ze <= 300 m.
 * Heights above 300 m require project-specific scientific/technical support and are rejected.
 */
export function sp20HeightCoefficient(heightM: number, terrainType: Sp20TerrainType): number {
  if (!Number.isFinite(heightM) || heightM < 0) throw new RangeError('wind height must be finite and >= 0 m')
  if (heightM > 300) throw new RangeError('SP20 k(ze) above 300 m requires project-specific scientific/technical support')
  const parameters = SP20_TERRAIN_PARAMETERS[terrainType]
  if (!parameters) throw new RangeError(`unsupported SP20 terrain type: ${terrainType}`)
  if (heightM <= 5) return parameters.kAt5M
  if (heightM < 10) {
    const fraction = (heightM - 5) / 5
    return parameters.kAt5M + (parameters.k10 - parameters.kAt5M) * fraction
  }
  return parameters.k10 * Math.pow(heightM / 10, 2 * parameters.alpha)
}

export function sp20CharacteristicMeanPressurePa(
  windRegion: Sp20WindRegion,
  terrainType: Sp20TerrainType,
  heightM: number,
): number {
  const basicPressurePa = SP20_BASIC_WIND_PRESSURE_PA[windRegion]
  if (!Number.isFinite(basicPressurePa)) throw new RangeError(`unsupported SP20 wind region: ${windRegion}`)
  return basicPressurePa * sp20HeightCoefficient(heightM, terrainType)
}

function resolveMode(value: unknown): WindActionMode {
  if (value == null || value === '') return WIND_ACTION_MODE_MANUAL
  if (value === WIND_ACTION_MODE_MANUAL || value === WIND_ACTION_MODE_SP20_MEAN_V1) return value
  throw new RangeError(`unsupported wind action mode: ${String(value)}`)
}

function resolveRegion(value: unknown): Sp20WindRegion {
  const region = String(value ?? '') as Sp20WindRegion
  if (!(region in SP20_BASIC_WIND_PRESSURE_PA)) throw new RangeError(`unsupported SP20 wind region: ${String(value)}`)
  return region
}

function resolveTerrain(value: unknown): Sp20TerrainType {
  const terrain = String(value ?? '') as Sp20TerrainType
  if (!(terrain in SP20_TERRAIN_PARAMETERS)) throw new RangeError(`unsupported SP20 terrain type: ${String(value)}`)
  return terrain
}

export function createWindActionProvenance(parameters: {
  readonly windActionMode?: WindActionMode
  readonly windRegion?: Sp20WindRegion | null
  readonly windTerrainType?: Sp20TerrainType | null
  readonly windPressurePa: number
  readonly windLoadFactor: number
}): WindActionProvenance {
  if (parameters.windActionMode === WIND_ACTION_MODE_SP20_MEAN_V1) {
    const region = parameters.windRegion ?? null
    const terrain = parameters.windTerrainType ?? null
    return Object.freeze({
      model: WIND_ACTION_MODE_SP20_MEAN_V1,
      source: SP20_WIND_MODEL_SOURCE,
      normative: true,
      meanComponentIncluded: true,
      pulsationComponentIncluded: false,
      dynamicResponseIncluded: false,
      windRegion: region,
      terrainType: terrain,
      basicWindPressurePa: region ? SP20_BASIC_WIND_PRESSURE_PA[region] : null,
      loadReliabilityFactor: parameters.windLoadFactor,
      aerodynamicCoefficientsAppliedSeparately: true,
    })
  }
  return Object.freeze({
    model: WIND_ACTION_MODE_MANUAL,
    source: 'manual custom pressure / legacy-compatible input',
    normative: false,
    meanComponentIncluded: true,
    pulsationComponentIncluded: false,
    dynamicResponseIncluded: false,
    windRegion: null,
    terrainType: null,
    basicWindPressurePa: null,
    loadReliabilityFactor: parameters.windLoadFactor,
    aerodynamicCoefficientsAppliedSeparately: true,
  })
}

export function resolveWindAction<T extends {
  readonly windActionMode?: unknown
  readonly windRegion?: unknown
  readonly windTerrainType?: unknown
  readonly windPressurePa: number
  readonly windLoadFactor: number
}>(parameters: T, referenceHeightM: number) {
  const windActionMode = resolveMode(parameters.windActionMode)
  if (windActionMode === WIND_ACTION_MODE_MANUAL) {
    const resolved = {
      ...parameters,
      windActionMode,
      windRegion: null,
      windTerrainType: null,
    }
    return {
      ...resolved,
      windActionProvenance: createWindActionProvenance(resolved),
    }
  }

  const windRegion = resolveRegion(parameters.windRegion)
  const windTerrainType = resolveTerrain(parameters.windTerrainType)
  const windPressurePa = sp20CharacteristicMeanPressurePa(windRegion, windTerrainType, referenceHeightM)
  const resolved = {
    ...parameters,
    windActionMode,
    windRegion,
    windTerrainType,
    windPressurePa,
  }
  return {
    ...resolved,
    windActionProvenance: createWindActionProvenance(resolved),
  }
}

export function meanWindPressureAtHeightPa(
  parameters: {
    readonly windActionMode?: WindActionMode
    readonly windRegion?: Sp20WindRegion | null
    readonly windTerrainType?: Sp20TerrainType | null
    readonly windPressurePa: number
  },
  heightM: number,
): number {
  if (parameters.windActionMode !== WIND_ACTION_MODE_SP20_MEAN_V1) return parameters.windPressurePa
  if (!parameters.windRegion || !parameters.windTerrainType) {
    throw new RangeError('SP20 mean wind mode requires windRegion and windTerrainType')
  }
  return sp20CharacteristicMeanPressurePa(parameters.windRegion, parameters.windTerrainType, heightM)
}
