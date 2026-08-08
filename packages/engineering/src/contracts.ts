import type { ResolvedProject } from '../../domain/contracts.js'
import type {
  LoadCase,
  MastModel,
  RawFrameAnalysis,
  RawMemberResult,
  Vector3,
} from '../../structural-analysis/contracts.js'

export interface MemberResult extends RawMemberResult {
  readonly axialForceN: number
  readonly maxTensionN: number
  readonly maxCompressionN: number
  readonly maxShearN: number
  readonly maxTorsionNm: number
  readonly maxBendingNm: number
  readonly distributedBendingAllowanceNm: number
  readonly axialStressPa: number
  readonly bendingStressPa: number
  readonly normalStressPa: number
  readonly torsionShearPa: number
  readonly transverseShearPa: number
  readonly shearStressPa: number
  readonly equivalentStressPa: number
  readonly stressPa: number
  readonly designYieldPa: number
  readonly stressUtilization: number
  readonly eulerCapacityN: number
  readonly bucklingUtilization: number
  readonly designCapacityN: number
  readonly slenderness: number
  readonly utilization: number
  readonly mode: 'tension' | 'compression'
}

export type CheckedFrameAnalysis = Omit<RawFrameAnalysis, 'memberResults' | 'maxUtilization' | 'criticalMemberId'> & {
  readonly memberResults: readonly MemberResult[]
  readonly maxUtilization: number
  readonly criticalMemberId: number | null
  readonly modular?: ModuleAnalysis
  readonly moduleResults?: readonly ModuleResult[]
}

export interface ModuleResult {
  readonly moduleIndex?: number
  readonly memberIds: readonly number[]
  readonly criticalMemberId: number
  readonly maxUtilization: number
  readonly maxStressUtilization: number
  readonly maxBucklingUtilization: number
  readonly maxRuptureUtilization: number
  readonly verticalFailureMode: 'local-member-buckling' | 'tensile-rupture'
  readonly verticalFailureMemberId: number
  readonly verticalFailureUtilization: number
  readonly verticalFailureLoadFactor: number
}

export interface ModuleAnalysis {
  readonly method: string
  readonly displacementVector: readonly number[]
  readonly modules: readonly ModuleResult[]
  readonly relativeDisplacementDifference: number
  readonly interfaceEquilibriumResidual: number
  readonly interfaceFactorizationCount: number
  readonly referenceSolver: string
}

export interface EngineeringCase {
  readonly windDirectionDeg: number
  readonly loads: LoadCase
  readonly analysis: CheckedFrameAnalysis
}

export interface BoltConfiguration {
  readonly diameterMm: number
  readonly propertyClass?: string
  readonly class?: string
  readonly applicable?: boolean
  readonly utilization?: number
  readonly passes?: boolean
  readonly [key: string]: unknown
}

export interface ConnectionConfiguration {
  readonly mode?: string
  readonly bolt?: BoltConfiguration
  readonly clearanceNutThreadMm?: number
  readonly boltLengthMm?: number
  readonly [key: string]: unknown
}

export interface ConnectionCheck {
  readonly passes?: boolean
  readonly utilization?: number
  readonly loadFactorToDesignLimit?: number
  readonly [key: string]: unknown
}

export interface ConnectionResult {
  readonly passesJointGeometry?: boolean
  readonly bolt?: {
    readonly selected?: BoltConfiguration
    readonly [key: string]: unknown
  }
  readonly weld?: Readonly<Record<string, unknown>>
  readonly nutSections?: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

export interface LateralCapacity {
  readonly method: string
  readonly criticalForceN: number
  readonly criticalForceKgf: number
  readonly governingMode: string
  readonly governing?: Readonly<Record<string, unknown>>
  readonly cases: readonly Readonly<Record<string, unknown>>[]
  readonly [key: string]: unknown
}

export interface StaticPayloadCapacity {
  readonly maximumPayloadMassKg: number
  readonly remainingPayloadMassKg?: number
  readonly governingMode: string
  readonly [key: string]: unknown
}

export interface CraneBoomCapacity {
  readonly maximumEndPayloadMassKg: number
  readonly boomSelfWeightN: number
  readonly boomSelfMassEquivalentKg: number
  readonly governingDirectionDeg: number
  readonly governingMode: string
  readonly [key: string]: unknown
}

export interface HeightCapacity {
  readonly design?: Readonly<Record<string, unknown>>
  readonly ultimate?: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

export type VerificationCheckStatus = 'pass' | 'fail' | 'not-verified'

export interface VerificationCheck {
  readonly id: string
  readonly level: number
  readonly title: string
  readonly explanation: string
  readonly status: VerificationCheckStatus
  readonly howToCheck: string
  readonly formula?: string
  readonly substitution?: string
  readonly actual?: number
  readonly expected?: number
  readonly tolerance?: number
  readonly relativeError?: number
  readonly unit?: string
  readonly evidence?: string
  readonly [key: string]: unknown
}

export interface VerificationLevel {
  readonly number: number
  readonly title: string
  readonly description: string
  readonly status: VerificationCheckStatus
  readonly checkIds: readonly string[]
  readonly [key: string]: unknown
}

export interface VerificationPassport {
  readonly method: string
  readonly status: 'failed' | 'internal-passed-external-pending' | 'incomplete'
  readonly headline: string
  readonly explanation: string
  readonly counts: {
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly notVerified: number
    readonly internal: number
  }
  readonly levels: readonly VerificationLevel[]
  readonly checks: readonly VerificationCheck[]
  readonly thresholds: {
    readonly linearResidual: number
    readonly freeDofEquilibrium: number
    readonly globalMomentResidual: number
    readonly bucklingResidual: number
  }
}

export interface GuyWireDefinition {
  readonly id: string
  readonly attachmentNodeId: number
  readonly anchorPosition: Vector3
  readonly initialLengthM: number
  readonly [key: string]: unknown
}

export interface GuyWireResult extends GuyWireDefinition {
  readonly currentLengthM: number
  readonly tensionN: number
  readonly utilization: number
  readonly slack: boolean
  readonly passes: boolean
  readonly forceOnMastN: Vector3
}

export interface GuyedProjectResult {
  readonly parameters: ResolvedProject
  readonly model: MastModel
  readonly cases: readonly Readonly<Record<string, unknown>>[]
  readonly cableEnvelope: readonly Readonly<Record<string, unknown>>[]
  readonly passes: boolean
  readonly warnings: readonly string[]
  readonly envelope: Readonly<Record<string, unknown>>
}
