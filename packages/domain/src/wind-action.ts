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

/**
 * Height coefficient parameters for terrain categories from SP20 table 11.2.
 * k(z) = k10 * (z / 10)^(2 * alpha), with the standard low-height floor.
 */
export const SP20_TERRAIN_PARAMETERS: Readonly<Record<Sp20TerrainType, {
  readonly k10: number
  readonly alpha: number
  readonly minimumCoefficient: number
}>> = Object.freeze({
  A: Object.freeze({ k10: 1, alpha: 0.15, minimumCoefficient: 0.75 }),
  B: Object.freeze({ k10: 0.65, alpha: 0.20, minimumCoefficient: 0.50 }),
  C: Object.freeze({ k10: 0.40, alpha: 0.25, minimumCoefficient: 0.40 }),
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

export function sp20HeightCoefficient(heightM: number, terrainType: Sp20TerrainType): number {
  if (!Number.isFinite(heightM) || heightM < 0) throw new RangeError('wind height must be finite and >= 0 m')
  const parameters = SP20_TERRAIN_PARAMETERS[terrainType]
  if (!parameters) throw new RangeError(`unsupported SP20 terrain type: ${terrainType}`)
  const effectiveHeightM = Math.max(5, heightM)
  const coefficient = parameters.k10 * Math.pow(effectiveHeightM / 10, 2 * parameters.alpha)
  return Math.max(parameters.minimumCoefficient, coefficient)
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

export function meanWindPressureAtHeightPa(
  parameters: {
    readonly windActionMode?: WindActionMode
    readonly windRegion?: Sp20WindRegion
    readonly windTerrainType?: Sp20TerrainType
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

export function createWindActionProvenance(parameters: {
  readonly windActionMode?: WindActionMode
  readonly windRegion?: Sp20WindRegion
  readonly windTerrainType?: Sp20TerrainType
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
