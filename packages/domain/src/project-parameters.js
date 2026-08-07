import {
  applyReinforcementClass,
  regularOctahedronHeightMm,
  theoreticalCutLengthMm,
} from './catalog.js'
import { resolveWindParameters, windSpeedFromPressurePa } from './weather.js'

export const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

export const DEFAULT_PROJECT_INPUT = deepFreeze({
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
  environment: {
    deadLoadFactor: 1.1,
    windLoadFactor: 1.4,
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
    loadFactor: 1.1,
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
  environment: Object.freeze({
    deadLoadFactor: 'deadLoadFactor',
    windLoadFactor: 'windLoadFactor',
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
    loadFactor: 'equipmentLoadFactor',
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

export const PROJECT_INPUT_GROUP_NAMES = Object.freeze(Object.keys(PROJECT_INPUT_GROUPS))

const isPlainObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value)

export function createProjectInput(overrides = {}) {
  const unknownGroups = Object.keys(overrides).filter((key) => !(key in PROJECT_INPUT_GROUPS))
  if (unknownGroups.length > 0) {
    throw new Error(`Неизвестные группы ProjectInput: ${unknownGroups.join(', ')}`)
  }
  const result = {}
  for (const groupName of PROJECT_INPUT_GROUP_NAMES) {
    const groupOverrides = overrides[groupName] ?? {}
    if (!isPlainObject(groupOverrides)) throw new Error(`ProjectInput.${groupName} должен быть объектом`)
    const allowedFields = PROJECT_INPUT_GROUPS[groupName]
    const unknownFields = Object.keys(groupOverrides).filter((key) => !(key in allowedFields))
    if (unknownFields.length > 0) {
      throw new Error(`Неизвестные поля ProjectInput.${groupName}: ${unknownFields.join(', ')}`)
    }
    result[groupName] = { ...DEFAULT_PROJECT_INPUT[groupName], ...groupOverrides }
  }
  return result
}

export function assertProjectInput(value) {
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
      if (!(requiredField in group)) throw new Error(`Отсутствует ProjectInput.${groupName}.${requiredField}`)
    }
  }
  return value
}

export function flattenProjectInput(projectInput) {
  const input = assertProjectInput(projectInput)
  const flat = {}
  for (const groupName of PROJECT_INPUT_GROUP_NAMES) {
    const mapping = PROJECT_INPUT_GROUPS[groupName]
    for (const [field, flatField] of Object.entries(mapping)) {
      if (input[groupName][field] !== undefined) flat[flatField] = input[groupName][field]
    }
  }
  return flat
}

const DEFAULT_FLAT_INPUT = flattenProjectInput(DEFAULT_PROJECT_INPUT)

/**
 * Internal resolved default used by low-level engineering tests during #61/#62.
 * It is not a user-input contract; public adapters must use DEFAULT_PROJECT_INPUT.
 */
export const DEFAULT_PARAMETERS = Object.freeze({
  ...DEFAULT_FLAT_INPUT,
  ribCutLengthMm: theoreticalCutLengthMm(DEFAULT_FLAT_INPUT.stockBarLengthMm, DEFAULT_FLAT_INPUT.stockBarPieces),
  triangleSideMm: theoreticalCutLengthMm(DEFAULT_FLAT_INPUT.stockBarLengthMm, DEFAULT_FLAT_INPUT.stockBarPieces),
  moduleHeightMm: regularOctahedronHeightMm(theoreticalCutLengthMm(DEFAULT_FLAT_INPUT.stockBarLengthMm, DEFAULT_FLAT_INPUT.stockBarPieces)),
  youngModulusGPa: 200,
  poissonRatio: 0.3,
  yieldStrengthMPa: 390,
  tensileStrengthMPa: 590,
  densityKgM3: 7850,
  reinforcementStandard: 'ГОСТ 34028-2016',
  reinforcementWeldabilityGuaranteed: true,
  effectiveLengthFactor: 0.5,
  windSpeedMs: windSpeedFromPressurePa(DEFAULT_FLAT_INPUT.windPressurePa),
  jointEffectiveRadiusMm: 18,
  jointBaseMetalTensileStrengthMPa: 490,
})

function resolveFlatCalculationParameters(parameters = {}) {
  const merged = { ...DEFAULT_FLAT_INPUT, ...parameters }
  const withMaterial = applyReinforcementClass(merged)
  const withWind = resolveWindParameters(withMaterial)
  const ribCutLengthMm = theoreticalCutLengthMm(withWind.stockBarLengthMm, withWind.stockBarPieces)
  const moduleHeightMm = regularOctahedronHeightMm(ribCutLengthMm)
  const heightSearchMaxModules = Math.max(
    1,
    Math.min(500, Math.floor(Number(withWind.heightSearchMaxModules) || DEFAULT_FLAT_INPUT.heightSearchMaxModules)),
  )
  return {
    ...withWind,
    ribCutLengthMm,
    triangleSideMm: ribCutLengthMm,
    moduleHeightMm,
    heightSearchMaxModules,
    effectiveLengthFactor: 0.5,
    jointBaseMetalTensileStrengthMPa: withWind.tensileStrengthMPa,
  }
}

/** Canonical public resolution path: ProjectInput -> ResolvedProject. */
export function resolveProjectInput(projectInput) {
  return resolveFlatCalculationParameters(flattenProjectInput(projectInput))
}

/**
 * Transitional low-level fixture resolver for existing focused tests/internal calls.
 * Public application use-cases must not call this with user input; #62 removes it.
 */
export function resolveCalculationParameters(parameters = {}) {
  return resolveFlatCalculationParameters(parameters)
}
