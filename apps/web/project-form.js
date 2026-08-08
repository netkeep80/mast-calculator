import {
  DEFAULT_PROJECT_INPUT,
  createProjectInput,
} from '../../packages/application/index.js'

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

export const DEFAULT_PROJECT_FORM_VALUES = Object.freeze(projectInputToFlatValues(DEFAULT_PROJECT_INPUT))

export function projectInputToFlatValues(projectInput) {
  const flat = {}
  for (const [groupName, mapping] of Object.entries(GROUP_FIELDS)) {
    const group = projectInput[groupName]
    for (const [field, flatName] of Object.entries(mapping)) {
      if (group?.[field] !== undefined) flat[flatName] = group[field]
    }
  }
  return flat
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
  return createProjectInput(groups)
}
