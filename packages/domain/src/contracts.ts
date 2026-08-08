export type Millimeters = number
export type Meters = number
export type Newtons = number
export type NewtonMeters = number
export type Pascals = number
export type Megapascals = number
export type Kilograms = number
export type Degrees = number

export type JointConfiguratorMode = 'auto' | 'manual'

export interface GeometryInput {
  readonly moduleCount: number
  readonly stockBarLengthMm: Millimeters
  readonly stockBarPieces: number
  readonly barDiameterMm: Millimeters
  readonly moduleDiametersMm?: readonly Millimeters[]
}

export interface MaterialInput {
  readonly reinforcementClass: string
  readonly materialSafetyFactor: number
}

export interface EnvironmentInput {
  readonly deadLoadFactor: number
  readonly windLoadFactor: number
  readonly windPresetId: string
  /** Required only for the custom wind preset; presets derive pressure from their design speed. */
  readonly windPressurePa?: Pascals
  readonly dragCoefficient: number
  readonly windDirectionDeg: Degrees
  readonly windEnvelopeEnabled: boolean
  readonly windEnvelopeStepDeg: Degrees
  readonly lateralCapacityStepDeg: Degrees
  readonly iceThicknessMm: Millimeters
  readonly iceDensityKgM3: number
}

export interface EquipmentInput {
  readonly massKg: Kilograms
  readonly windAreaM2: number
  readonly dragCoefficient: number
  readonly loadFactor: number
}

export interface ConnectionInput {
  readonly configuratorMode: JointConfiguratorMode
  readonly boltDiameterMm: Millimeters
  readonly boltClass: string
  readonly clearanceNutThreadMm: Millimeters
  readonly boltLengthMm: Millimeters
  readonly threadEngagementFactor: number
  readonly boltShearPlanes: number
  readonly conditionFactor: number
  readonly weldConsumableId: string
  readonly weldLegMm: Millimeters
  readonly weldSegmentsPerEnd: number
  readonly weldBetaF: number
  readonly weldBetaZ: number
  readonly tighteningTorqueNm?: NewtonMeters
  readonly nutFactor?: number
  readonly preloadVariation?: number
  readonly nutSectionAreaRatio?: number
  readonly weldToRibAreaRatio?: number
  readonly weldServiceYears?: number
  readonly weldInitialStiffnessRetention?: number
  readonly weldAnnualStiffnessLossRate?: number
  readonly weldMinimumStiffnessRetention?: number
}

export interface CriteriaInput {
  readonly displacementLimitMm: Millimeters
  readonly minimumBucklingFactor: number
  readonly heightSearchMaxModules: number
}

/**
 * The only canonical user-controlled engineering input.
 * Derived geometry, material properties and resolved catalogue geometry are deliberately absent.
 */
export interface ProjectInput {
  readonly geometry: GeometryInput
  readonly material: MaterialInput
  readonly environment: EnvironmentInput
  readonly equipment: EquipmentInput
  readonly connection: ConnectionInput
  readonly criteria: CriteriaInput
}

/**
 * Canonical resolved calculation contract consumed by physics packages in 4a.
 * It is intentionally flat so the existing solver formulas can migrate without a simultaneous rewrite.
 */
export interface ResolvedProject {
  readonly moduleCount: number
  readonly stockBarLengthMm: Millimeters
  readonly stockBarPieces: number
  readonly ribCutLengthMm: Millimeters
  readonly triangleSideMm: Millimeters
  readonly moduleHeightMm: Millimeters
  readonly reinforcementClass: string
  readonly barDiameterMm: Millimeters
  readonly moduleDiametersMm?: readonly Millimeters[]
  readonly youngModulusGPa: number
  readonly poissonRatio: number
  readonly yieldStrengthMPa: Megapascals
  readonly tensileStrengthMPa: Megapascals
  readonly densityKgM3: number
  readonly reinforcementStandard: string
  readonly reinforcementWeldabilityGuaranteed: boolean
  readonly effectiveLengthFactor: number
  readonly materialSafetyFactor: number
  readonly deadLoadFactor: number
  readonly windLoadFactor: number
  readonly equipmentLoadFactor: number
  readonly windPresetId: string
  readonly windPresetLabel: string
  readonly beaufortForce: number | null
  readonly windPressurePa: Pascals
  readonly windSpeedMs: number
  readonly dragCoefficient: number
  readonly windDirectionDeg: Degrees
  readonly windEnvelopeEnabled: boolean
  readonly windEnvelopeStepDeg: Degrees
  readonly lateralCapacityStepDeg: Degrees
  readonly equipmentMassKg: Kilograms
  readonly equipmentWindAreaM2: number
  readonly equipmentDragCoefficient: number
  readonly iceThicknessMm: Millimeters
  readonly iceDensityKgM3: number
  readonly displacementLimitMm: Millimeters
  readonly minimumBucklingFactor: number
  readonly heightSearchMaxModules: number
  readonly jointConfiguratorMode: JointConfiguratorMode
  readonly jointBoltDiameterMm: Millimeters
  readonly jointBoltClass: string
  readonly jointClearanceNutThreadMm: Millimeters
  readonly jointBoltLengthMm: Millimeters
  readonly jointThreadEngagementFactor: number
  readonly jointBoltShearPlanes: number
  readonly jointEffectiveRadiusMm: Millimeters
  readonly connectionConditionFactor: number
  readonly jointBaseMetalTensileStrengthMPa: Megapascals
  readonly weldConsumableId: string
  readonly weldLegMm: Millimeters
  readonly weldSegmentsPerEnd: number
  readonly weldBetaF: number
  readonly weldBetaZ: number
  readonly jointTighteningTorqueNm?: NewtonMeters
  readonly jointNutFactor?: number
  readonly jointPreloadVariation?: number
  readonly jointNutSectionAreaRatio?: number
  readonly weldToRibAreaRatio?: number
  readonly weldServiceYears?: number
  readonly weldInitialStiffnessRetention?: number
  readonly weldAnnualStiffnessLossRate?: number
  readonly weldMinimumStiffnessRetention?: number
}

export const PROJECT_PACKAGE_SCHEMA = 'mast-calculator/project/v1' as const

export interface ProjectPackageV1 {
  readonly schema: typeof PROJECT_PACKAGE_SCHEMA
  readonly project: ProjectInput
}
