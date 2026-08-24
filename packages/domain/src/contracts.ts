import type {
  Sp20TerrainType,
  Sp20WindRegion,
  WindActionMode,
  WindActionProvenance,
} from './wind-action.js'

export type Millimeters = number
export type Meters = number
export type Newtons = number
export type NewtonMeters = number
export type Pascals = number
export type Megapascals = number
export type Kilograms = number
export type Degrees = number

export type JointConfiguratorMode = 'auto' | 'manual'

export const SP20_OPERATIONAL_LOAD_ACTION_PROFILE = 'sp20-2016-amendment-6' as const
export const MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE = 'manual-migrated-v1' as const

export interface NormativeLoadActionsInput {
  readonly profile: typeof SP20_OPERATIONAL_LOAD_ACTION_PROFILE
}

export interface ManualMigratedV1LoadActionsInput {
  readonly profile: typeof MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE
  readonly steelSelfWeightLoadFactor: number
  readonly equipmentLoadFactor: number
  readonly iceLoadFactor: number
  readonly windLoadFactor: number
}

export type LoadActionsInput = NormativeLoadActionsInput | ManualMigratedV1LoadActionsInput

export interface LoadActionProvenance {
  readonly mode: 'normative' | 'manual-migrated-v1'
  readonly profile: LoadActionsInput['profile']
  readonly standard: 'СП 20.13330.2016'
  readonly amendmentNumber: 6
  readonly source: string
  readonly steelSelfWeight: string
  readonly equipmentWeight: string
  readonly ice: string
  readonly wind: string
}

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
  readonly windActionMode?: WindActionMode
  readonly windRegion?: Sp20WindRegion
  readonly windTerrainType?: Sp20TerrainType
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
  readonly loadActions: LoadActionsInput
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
  readonly steelSelfWeightLoadFactor: number
  readonly equipmentLoadFactor: number
  readonly iceLoadFactor: number
  readonly windLoadFactor: number
  readonly loadActionProvenance: LoadActionProvenance
  readonly windActionMode: WindActionMode
  readonly windRegion: Sp20WindRegion | null
  readonly windTerrainType: Sp20TerrainType | null
  readonly windActionProvenance: WindActionProvenance
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

export interface GuyTierInput {
  readonly id?: string
  readonly heightM?: number
  readonly anchorRadiusM?: number
  readonly anchorDistanceM?: number
  readonly guyCount?: number
  readonly azimuthOffsetDeg?: number
  readonly pretensionN?: number
  readonly wireId?: string
  readonly safetyFactor?: number
  readonly terminationEfficiency?: number
}

export interface ProjectGuysInput {
  readonly tiers: readonly GuyTierInput[]
  readonly safetyFactor?: number
  readonly terminationEfficiency?: number
}

export type ErectionTopologyIndex = 0 | 1 | 2
export type ErectionRotationSense = 1 | -1

export interface ProjectErectionSamplingInput {
  readonly initialSegments: number
  readonly relativeTolerance: number
  readonly minimumAngleStepDeg: Degrees
  readonly maximumEvaluations: number
  readonly maximumDepth: number
}

export interface ProjectErectionDisabledInput {
  readonly mode: 'disabled'
}

export interface ProjectTiltUpErectionInput {
  readonly mode: 'tilt-up'
  /** Base edge i connects base corners i and (i + 1) mod 3. */
  readonly hingeBaseEdgeIndex: ErectionTopologyIndex
  /** Stable top-face corner selector, resolved against generated model topology. */
  readonly attachmentTopCornerIndex: ErectionTopologyIndex
  /** Fixed world-coordinate hoist/anchor point in metres. */
  readonly anchorPointM: readonly [Meters, Meters, Meters]
  readonly rotationSense: ErectionRotationSense
  readonly startAngleDeg: Degrees
  readonly endAngleDeg: Degrees
  readonly sampling: ProjectErectionSamplingInput
}

export type ProjectErectionInput = ProjectErectionDisabledInput | ProjectTiltUpErectionInput

export interface ProjectPackageMetadata {
  readonly name?: string
  readonly description?: string
  readonly createdAt?: string
  readonly modifiedAt?: string
}

export const PROJECT_PACKAGE_SCHEMA_V1 = 'mast-calculator/project/v1' as const
export const PROJECT_PACKAGE_SCHEMA = 'mast-calculator/project/v2' as const

export interface ProjectPackageV2 {
  readonly schema: typeof PROJECT_PACKAGE_SCHEMA
  readonly metadata?: ProjectPackageMetadata
  readonly project: ProjectInput
  readonly guys?: ProjectGuysInput
  readonly erection?: ProjectErectionInput
}

export type ProjectPackageV1 = ProjectPackageV2
