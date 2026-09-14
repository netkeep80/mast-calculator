import {
  DEFAULT_PROJECT_INPUT,
  createProjectInput,
} from '../../packages/application/index.js'
import {
  MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE,
  SP20_OPERATIONAL_LOAD_ACTION_PROFILE,
  SP20_OPERATIONAL_LOAD_FACTORS,
} from '../../packages/domain/index.js'

const GROUP_FIELDS = Object.freeze({
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

const LOAD_ACTION_FORM_FIELDS = Object.freeze({
  profile: 'loadActionProfile',
  steelSelfWeightLoadFactor: 'steelSelfWeightLoadFactor',
  equipmentLoadFactor: 'equipmentLoadFactor',
  iceLoadFactor: 'iceLoadFactor',
  windLoadFactor: 'windLoadFactor',
})

export const OPTIONAL_PROJECT_FORM_FIELDS = Object.freeze([
  'windActionMode',
  'windRegion',
  'windTerrainType',
])

function loadActionValues(loadActions) {
  if (loadActions.profile === SP20_OPERATIONAL_LOAD_ACTION_PROFILE) {
    return {
      profile: loadActions.profile,
      ...SP20_OPERATIONAL_LOAD_FACTORS,
    }
  }
  if (loadActions.profile === MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE) return loadActions
  throw new Error(`Неизвестный профиль расчётных воздействий: ${String(loadActions.profile)}`)
}

export function projectInputToFlatValues(projectInput) {
  const flat = {}
  for (const [groupName, mapping] of Object.entries(GROUP_FIELDS)) {
    const group = projectInput[groupName]
    for (const [field, flatName] of Object.entries(mapping)) {
      if (group?.[field] !== undefined) flat[flatName] = group[field]
    }
  }
  const actions = loadActionValues(projectInput.loadActions)
  for (const [field, flatName] of Object.entries(LOAD_ACTION_FORM_FIELDS)) {
    if (actions[field] !== undefined) flat[flatName] = actions[field]
  }
  return flat
}

export const DEFAULT_PROJECT_FORM_VALUES = Object.freeze(projectInputToFlatValues(DEFAULT_PROJECT_INPUT))

function loadActionsFromFlatValues(values) {
  const profile = values.loadActionProfile ?? DEFAULT_PROJECT_INPUT.loadActions.profile
  if (profile === SP20_OPERATIONAL_LOAD_ACTION_PROFILE) return { profile }
  if (profile !== MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE) {
    throw new Error(`Неизвестный профиль расчётных воздействий: ${String(profile)}`)
  }
  return {
    profile,
    steelSelfWeightLoadFactor: values.steelSelfWeightLoadFactor,
    equipmentLoadFactor: values.equipmentLoadFactor,
    iceLoadFactor: values.iceLoadFactor,
    windLoadFactor: values.windLoadFactor,
  }
}

export function projectInputFromFlatValues(values = {}) {
  const groups = {}
  for (const [groupName, mapping] of Object.entries(GROUP_FIELDS)) {
    const group = {}
    for (const [field, flatName] of Object.entries(mapping)) {
      if (values[flatName] !== undefined) group[field] = values[flatName]
    }
    groups[groupName] = group
  }
  groups.loadActions = loadActionsFromFlatValues(values)
  return createProjectInput(groups)
}
