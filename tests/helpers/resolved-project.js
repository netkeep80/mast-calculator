import {
  createProjectInput,
  resolveProjectInput,
} from '../../packages/domain/index.js'

const FLAT_PROJECT_FIELDS = Object.freeze({
  moduleCount: ['geometry', 'moduleCount'],
  stockBarLengthMm: ['geometry', 'stockBarLengthMm'],
  stockBarPieces: ['geometry', 'stockBarPieces'],
  barDiameterMm: ['geometry', 'barDiameterMm'],
  moduleDiametersMm: ['geometry', 'moduleDiametersMm'],

  reinforcementClass: ['material', 'reinforcementClass'],
  materialSafetyFactor: ['material', 'materialSafetyFactor'],

  deadLoadFactor: ['environment', 'deadLoadFactor'],
  windLoadFactor: ['environment', 'windLoadFactor'],
  windActionMode: ['environment', 'windActionMode'],
  windRegion: ['environment', 'windRegion'],
  windTerrainType: ['environment', 'windTerrainType'],
  windPresetId: ['environment', 'windPresetId'],
  windPressurePa: ['environment', 'windPressurePa'],
  dragCoefficient: ['environment', 'dragCoefficient'],
  windDirectionDeg: ['environment', 'windDirectionDeg'],
  windEnvelopeEnabled: ['environment', 'windEnvelopeEnabled'],
  windEnvelopeStepDeg: ['environment', 'windEnvelopeStepDeg'],
  lateralCapacityStepDeg: ['environment', 'lateralCapacityStepDeg'],
  iceThicknessMm: ['environment', 'iceThicknessMm'],
  iceDensityKgM3: ['environment', 'iceDensityKgM3'],

  equipmentMassKg: ['equipment', 'massKg'],
  equipmentWindAreaM2: ['equipment', 'windAreaM2'],
  equipmentDragCoefficient: ['equipment', 'dragCoefficient'],
  equipmentLoadFactor: ['equipment', 'loadFactor'],

  jointConfiguratorMode: ['connection', 'configuratorMode'],
  jointBoltDiameterMm: ['connection', 'boltDiameterMm'],
  jointBoltClass: ['connection', 'boltClass'],
  jointClearanceNutThreadMm: ['connection', 'clearanceNutThreadMm'],
  jointBoltLengthMm: ['connection', 'boltLengthMm'],
  jointThreadEngagementFactor: ['connection', 'threadEngagementFactor'],
  jointBoltShearPlanes: ['connection', 'boltShearPlanes'],
  connectionConditionFactor: ['connection', 'conditionFactor'],
  weldConsumableId: ['connection', 'weldConsumableId'],
  weldLegMm: ['connection', 'weldLegMm'],
  weldSegmentsPerEnd: ['connection', 'weldSegmentsPerEnd'],
  weldBetaF: ['connection', 'weldBetaF'],
  weldBetaZ: ['connection', 'weldBetaZ'],
  jointTighteningTorqueNm: ['connection', 'tighteningTorqueNm'],
  jointNutFactor: ['connection', 'nutFactor'],
  jointPreloadVariation: ['connection', 'preloadVariation'],
  jointNutSectionAreaRatio: ['connection', 'nutSectionAreaRatio'],
  weldToRibAreaRatio: ['connection', 'weldToRibAreaRatio'],
  weldServiceYears: ['connection', 'weldServiceYears'],
  weldInitialStiffnessRetention: ['connection', 'weldInitialStiffnessRetention'],
  weldAnnualStiffnessLossRate: ['connection', 'weldAnnualStiffnessLossRate'],
  weldMinimumStiffnessRetention: ['connection', 'weldMinimumStiffnessRetention'],

  displacementLimitMm: ['criteria', 'displacementLimitMm'],
  minimumBucklingFactor: ['criteria', 'minimumBucklingFactor'],
  heightSearchMaxModules: ['criteria', 'heightSearchMaxModules'],
})

export function resolvedProject(overrides = {}) {
  const grouped = {}
  for (const [flatField, value] of Object.entries(overrides)) {
    const path = FLAT_PROJECT_FIELDS[flatField]
    if (!path) {
      throw new Error(`Test fixture cannot override derived/internal ResolvedProject field: ${flatField}`)
    }
    const [group, field] = path
    grouped[group] ??= {}
    grouped[group][field] = value
  }
  return resolveProjectInput(createProjectInput(grouped))
}
