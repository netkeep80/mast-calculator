import type { LoadActionProvenance, ProjectInput, ResolvedProject } from './contracts.js'
import {
  MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE,
  SP20_OPERATIONAL_LOAD_ACTION_PROFILE,
} from './contracts.js'
import {
  applyReinforcementClass,
  regularOctahedronHeightMm,
  theoreticalCutLengthMm,
} from './catalog.js'
import {
  WIND_ACTION_MODE_SP20_MEAN_V1,
  resolveWindAction,
} from './wind-action.js'
import {
  resolveWindParameters,
  windSpeedFromPressurePa,
} from './weather.js'

export const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15

export const SP20_OPERATIONAL_LOAD_FACTORS = Object.freeze({
  steelSelfWeightLoadFactor: 1.05,
  equipmentLoadFactor: 1.05,
  iceLoadFactor: 1.8,
  windLoadFactor: 1.4,
})

export const SP20_OPERATIONAL_LOAD_ACTION_SOURCE =
  'СП 20.13330.2016 «Нагрузки и воздействия», изм. №6: 7.2/табл. 7.1; 8.1.4/табл. 8.2; 12.5; 11.4' as const

type JsonRecord = Record<string, unknown>

const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as JsonRecord)) deepFreeze(nested)
  return Object.freeze(value) as T
}

export const DEFAULT_PROJECT_INPUT: ProjectInput = deepFreeze({
  geometry: {
    moduleCount: 12,
    stockBarLengthMm: 12000,
    stockBarPieces: 16,
    barDiameterMm: 12,
  },
  material: {
    reinforcementClass: 'A400C',
    materialSafetyFactor: 1.1,
  },
  loadActions: {
    profile: SP20_OPERATIONAL_LOAD_ACTION_PROFILE,
  },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 380,
    dragCoefficient: 1.2,
    windDirectionDeg: 0,
    windEnvelopeEnabled: true,
    windEnvelopeStepDeg: 30,
    lateralCapacityStepDeg: DEFAULT_LATERAL_CAPACITY_STEP_DEG,
    iceThicknessMm: 0,
    iceDensityKgM3: 900,
  },
  equipment: {
    massKg: 20,
    windAreaM2: 0.35,
    dragCoefficient: 1.4,
  },
  connection: {
    configuratorMode: 'auto',
    boltDiameterMm: 24,
    boltClass: '8.8',
    clearanceNutThreadMm: 30,
    boltLengthMm: 80,
    threadEngagementFactor: 2,
    boltShearPlanes: 1,
    conditionFactor: 1,
    weldConsumableId: 'electrode-e50a-uoni-13-55',
    weldLegMm: 4,
    weldSegmentsPerEnd: 3,
    weldBetaF: 0.7,
    weldBetaZ: 1,
  },
  criteria: {
    displacementLimitMm: 65,
    minimumBucklingFactor: 2,
    heightSearchMaxModules: 200,
  },
})

const PROJECT_INPUT_GROUPS = Object.freeze({
  geometry: Object.freeze({
    moduleCount: 'moduleCount',
    stockBarLengthMm: 'stockBarLengthMm',
    stockBarPieces: 'stockBarPieces',
    barDiameterMm: 'barDiameterMm',
    moduleDiametersMm: 'moduleDiametersMm',
  }),
  material: Object.freeze({
    reinforcementClass: 'reinforcementClass',
    materialSafetyFactor: 'materialSafetyFactor',
  }),
  loadActions: Object.freeze({
    profile: 'loadActionProfile',
    steelSelfWeightLoadFactor: 'steelSelfWeightLoadFactor',
    equipmentLoadFactor: 'equipmentLoadFactor',
    iceLoadFactor: 'iceLoadFactor',
    windLoadFactor: 'windLoadFactor',
  }),
  environment: Object.freeze({
    windActionMode: 'windActionMode',
    windRegion: 'windRegion',
    windTerrainType: 'windTerrainType',
    windPresetId: 'windPresetId',
    windPressurePa: 'windPressurePa',
    dragCoefficient: 'dragCoefficient',
    windDirectionDeg: 'windDirectionDeg',
    windEnvelopeEnabled: 'windEnvelopeEnabled',
    windEnvelopeStepDeg: 'windEnvelopeStepDeg',
    lateralCapacityStepDeg: 'lateralCapacityStepDeg',
    iceThicknessMm: 'iceThicknessMm',
    iceDensityKgM3: 'iceDensityKgM3',
  }),
  equipment: Object.freeze({
    massKg: 'equipmentMassKg',
    windAreaM2: 'equipmentWindAreaM2',
    dragCoefficient: 'equipmentDragCoefficient',
  }),
  connection: Object.freeze({
    configuratorMode: 'jointConfiguratorMode',
    boltDiameterMm: 'jointBoltDiameterMm',
    boltClass: 'jointBoltClass',
    clearanceNutThreadMm: 'jointClearanceNutThreadMm',
    boltLengthMm: 'jointBoltLengthMm',
    threadEngagementFactor: 'jointThreadEngagementFactor',
    boltShearPlanes: 'jointBoltShearPlanes',
    conditionFactor: 'connectionConditionFactor',
    weldConsumableId: 'weldConsumableId',
    weldLegMm: 'weldLegMm',
    weldSegmentsPerEnd: 'weldSegmentsPerEnd',
    weldBetaF: 'weldBetaF',
    weldBetaZ: 'weldBetaZ',
    tighteningTorqueNm: 'jointTighteningTorqueNm',
    nutFactor: 'jointNutFactor',
    preloadVariation: 'jointPreloadVariation',
    nutSectionAreaRatio: 'jointNutSectionAreaRatio',
    weldToRibAreaRatio: 'weldToRibAreaRatio',
    weldServiceYears: 'weldServiceYears',
    weldInitialStiffnessRetention: 'weldInitialStiffnessRetention',
    weldAnnualStiffnessLossRate: 'weldAnnualStiffnessLossRate',
    weldMinimumStiffnessRetention: 'weldMinimumStiffnessRetention',
  }),
  criteria: Object.freeze({
    displacementLimitMm: 'displacementLimitMm',
    minimumBucklingFactor: 'minimumBucklingFactor',
    heightSearchMaxModules: 'heightSearchMaxModules',
  }),
})

type ProjectInputGroupName = keyof typeof PROJECT_INPUT_GROUPS
export const PROJECT_INPUT_GROUP_NAMES = Object.freeze(Object.keys(PROJECT_INPUT_GROUPS) as ProjectInputGroupName[])

const isPlainObject = (value: unknown): value is JsonRecord => value != null && typeof value === 'object' && !Array.isArray(value)

export function createProjectInput(overrides: JsonRecord = {}): ProjectInput {
  const unknownGroups = Object.keys(overrides).filter((key) => !(key in PROJECT_INPUT_GROUPS))
  if (unknownGroups.length > 0) {
    throw new Error(`Неизвестные группы ProjectInput: ${unknownGroups.join(', ')}`)
  }
  const result: JsonRecord = {}
  for (const groupName of PROJECT_INPUT_GROUP_NAMES) {
    const groupOverrides = overrides[groupName] ?? {}
    if (!isPlainObject(groupOverrides)) throw new Error(`ProjectInput.${groupName} должен быть объектом`)
    const allowedFields = PROJECT_INPUT_GROUPS[groupName]
    const unknownFields = Object.keys(groupOverrides).filter((key) => !(key in allowedFields))
    if (unknownFields.length > 0) {
      throw new Error(`Неизвестные поля ProjectInput.${groupName}: ${unknownFields.join(', ')}`)
    }
    result[groupName] = { ...(DEFAULT_PROJECT_INPUT[groupName] as unknown as JsonRecord), ...groupOverrides }
  }
  return result as unknown as ProjectInput
}

export function assertProjectInput(value: unknown): ProjectInput {
  if (!isPlainObject(value)) throw new Error('ProjectInput должен быть объектом')
  const unknownGroups = Object.keys(value).filter((key) => !(key in PROJECT_INPUT_GROUPS))
  if (unknownGroups.length > 0) throw new Error(`Неизвестные группы ProjectInput: ${unknownGroups.join(', ')}`)
  for (const groupName of PROJECT_INPUT_GROUP_NAMES) {
    const group = value[groupName]
    if (!isPlainObject(group)) throw new Error(`Отсутствует группа ProjectInput.${groupName}`)
    const allowed = PROJECT_INPUT_GROUPS[groupName]
    const unknownFields = Object.keys(group).filter((key) => !(key in allowed))
    if (unknownFields.length > 0) {
      throw new Error(`Неизвестные поля ProjectInput.${groupName}: ${unknownFields.join(', ')}`)
    }
    for (const requiredField of Object.keys(DEFAULT_PROJECT_INPUT[groupName])) {
      const windPressureDerived = groupName === 'environment'
        && requiredField === 'windPressurePa'
        && (group.windActionMode === WIND_ACTION_MODE_SP20_MEAN_V1 || group.windPresetId !== 'custom')
      if (windPressureDerived) continue
      if (!(requiredField in group)) throw new Error(`Отсутствует ProjectInput.${groupName}.${requiredField}`)
    }
  }
  const actions = value.loadActions as JsonRecord
  if (actions.profile !== SP20_OPERATIONAL_LOAD_ACTION_PROFILE
    && actions.profile !== MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE) {
    throw new Error(`Неизвестный профиль ProjectInput.loadActions: ${String(actions.profile)}`)
  }
  if (actions.profile === MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE) {
    for (const field of ['steelSelfWeightLoadFactor', 'equipmentLoadFactor', 'iceLoadFactor', 'windLoadFactor']) {
      const factor = Number(actions[field])
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new Error(`ProjectInput.loadActions.${field} должен быть положительным конечным числом`)
      }
    }
  }
  return value as unknown as ProjectInput
}

export function flattenProjectInput(projectInput: unknown): JsonRecord {
  const input = assertProjectInput(projectInput)
  const flat: JsonRecord = {}
  for (const groupName of PROJECT_INPUT_GROUP_NAMES) {
    const mapping = PROJECT_INPUT_GROUPS[groupName] as Record<string, string>
    const group = input[groupName] as unknown as JsonRecord
    for (const [field, flatField] of Object.entries(mapping)) {
      if (group[field] !== undefined) flat[flatField] = group[field]
    }
  }
  return flat
}

const DEFAULT_FLAT_INPUT = flattenProjectInput(DEFAULT_PROJECT_INPUT)
const DEFAULT_BASE_METAL_TENSILE_STRENGTH_MPA = 490

function resolveLoadActions(parameters: JsonRecord): {
  steelSelfWeightLoadFactor: number
  equipmentLoadFactor: number
  iceLoadFactor: number
  windLoadFactor: number
  loadActionProvenance: LoadActionProvenance
} {
  const profile = parameters.loadActionProfile
  if (profile === SP20_OPERATIONAL_LOAD_ACTION_PROFILE) {
    return {
      ...SP20_OPERATIONAL_LOAD_FACTORS,
      loadActionProvenance: Object.freeze({
        mode: 'normative',
        profile: SP20_OPERATIONAL_LOAD_ACTION_PROFILE,
        standard: 'СП 20.13330.2016',
        amendmentNumber: 6,
        source: SP20_OPERATIONAL_LOAD_ACTION_SOURCE,
        steelSelfWeight: '7.2 / таблица 7.1: собственный вес металлических конструкций, γf=1.05',
        equipmentWeight: '8.1.4 / таблица 8.2: стационарное оборудование, γf=1.05',
        ice: '12.5: гололёдная нагрузка, γf=1.8',
        wind: '11.4: ветровая нагрузка, γf=1.4',
      }),
    }
  }
  if (profile !== MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE) {
    throw new Error(`Неизвестный профиль расчётных воздействий: ${String(profile)}`)
  }
  const steelSelfWeightLoadFactor = Number(parameters.steelSelfWeightLoadFactor)
  const equipmentLoadFactor = Number(parameters.equipmentLoadFactor)
  const iceLoadFactor = Number(parameters.iceLoadFactor)
  const windLoadFactor = Number(parameters.windLoadFactor)
  for (const [name, factor] of Object.entries({
    steelSelfWeightLoadFactor,
    equipmentLoadFactor,
    iceLoadFactor,
    windLoadFactor,
  })) {
    if (!Number.isFinite(factor) || factor <= 0) throw new Error(`Некорректный legacy коэффициент ${name}`)
  }
  return {
    steelSelfWeightLoadFactor,
    equipmentLoadFactor,
    iceLoadFactor,
    windLoadFactor,
    loadActionProvenance: Object.freeze({
      mode: 'manual-migrated-v1',
      profile: MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE,
      standard: 'СП 20.13330.2016',
      amendmentNumber: 6,
      source: 'migrated mast-calculator/project/v1 user factors; not normative SP20 defaults',
      steelSelfWeight: `project/v1 environment.deadLoadFactor=${steelSelfWeightLoadFactor}`,
      equipmentWeight: `project/v1 equipment.loadFactor=${equipmentLoadFactor}`,
      ice: `project/v1 environment.deadLoadFactor=${iceLoadFactor}`,
      wind: `project/v1 environment.windLoadFactor=${windLoadFactor}`,
    }),
  }
}

function resolveFlatCalculationParameters(parameters: JsonRecord = {}): ResolvedProject {
  const merged = { ...DEFAULT_FLAT_INPUT, ...parameters }
  const loadActions = resolveLoadActions(merged)
  const withMaterial = applyReinforcementClass({ ...merged, ...loadActions } as unknown as JsonRecord & { reinforcementClass: string })
  const withWeather = resolveWindParameters(withMaterial as JsonRecord & { windPresetId?: string; windPressurePa?: unknown })
  const ribCutLengthMm = theoreticalCutLengthMm(withWeather.stockBarLengthMm, withWeather.stockBarPieces)
  const moduleHeightMm = regularOctahedronHeightMm(ribCutLengthMm)
  const referenceHeightM = Number(withWeather.moduleCount) * moduleHeightMm / 1000
  const withWindAction = resolveWindAction(
    withWeather as typeof withWeather & { windLoadFactor: number },
    referenceHeightM,
  )
  const normalizedWind = withWindAction.windActionMode === WIND_ACTION_MODE_SP20_MEAN_V1
    ? {
        ...withWindAction,
        windPresetLabel: `СП 20: район ${withWindAction.windRegion}, местность ${withWindAction.windTerrainType}; средняя составляющая`,
        beaufortForce: null,
        windSpeedMs: windSpeedFromPressurePa(withWindAction.windPressurePa),
      }
    : withWindAction
  const heightSearchMaxModules = Math.max(
    1,
    Math.min(500, Math.floor(Number(withWeather.heightSearchMaxModules) || Number(DEFAULT_FLAT_INPUT.heightSearchMaxModules))),
  )
  const baseMetalStrength = Number(parameters.jointBaseMetalTensileStrengthMPa)
  return {
    ...normalizedWind,
    ...loadActions,
    ribCutLengthMm,
    triangleSideMm: ribCutLengthMm,
    moduleHeightMm,
    heightSearchMaxModules,
    effectiveLengthFactor: 0.5,
    jointBaseMetalTensileStrengthMPa: Number.isFinite(baseMetalStrength)
      ? baseMetalStrength
      : DEFAULT_BASE_METAL_TENSILE_STRENGTH_MPA,
  } as unknown as ResolvedProject
}

/** Canonical public resolution path: ProjectInput -> ResolvedProject. */
export function resolveProjectInput(projectInput: ProjectInput): ResolvedProject {
  return resolveFlatCalculationParameters(flattenProjectInput(projectInput))
}
