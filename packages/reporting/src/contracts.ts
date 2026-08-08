import type { calculateAssemblyMass } from '../../design/index.js'
import type { ResolvedProject } from '../../domain/contracts.js'
import type {
  buildVerificationPassport,
  calculateConnectionChecks,
  calculateCraneBoomCapacity,
  calculateLateralCapacity,
  calculateStaticPayloadCapacity,
} from '../../engineering/index.js'
import type { CheckedFrameAnalysis } from '../../engineering/contracts.js'
import type { BuiltLoadCase, GeneratedMastModel } from '../../structural-analysis/index.js'

export interface ReportingModuleAction {
  readonly nodeId: number
  readonly forceN: readonly number[]
  readonly momentNm: readonly number[]
}

export interface ReportingModuleResult {
  readonly moduleIndex?: number
  readonly moduleNumber: number
  readonly bottomNodeIds: readonly number[]
  readonly topNodeIds: readonly number[]
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
  readonly topAppliedFromAbove: readonly ReportingModuleAction[]
  readonly bottomReactionFromBelow: readonly ReportingModuleAction[]
  readonly topResultantFromAbove: {
    readonly forceN: readonly number[]
    readonly momentNm: readonly number[]
  }
  readonly bottomResultantFromBelow: {
    readonly forceN: readonly number[]
    readonly momentNm: readonly number[]
  }
  readonly bottomDisplacement: readonly number[]
  readonly topDisplacement: readonly number[]
  readonly [key: string]: unknown
}

export interface ReportingModularAnalysis {
  readonly method: string
  readonly referenceSolver?: string | null
  readonly relativeDisplacementDifference: number
  readonly interfaceEquilibriumResidual: number
  readonly interfaceFactorizationCount: number
  readonly interfaces?: readonly (readonly number[])[]
  readonly condensedBaseLoad?: readonly number[]
  readonly modules?: readonly ReportingModuleResult[]
}

export type ReportingAnalysis = Omit<CheckedFrameAnalysis, 'modular' | 'moduleResults'> & {
  readonly modular?: ReportingModularAnalysis
  readonly moduleResults?: readonly ReportingModuleResult[]
}

export interface ReportingLoadCase {
  readonly windDirectionDeg: number
  readonly loads: BuiltLoadCase
  readonly analysis: ReportingAnalysis
}

export interface ReportingEnvelope {
  readonly strength: ReportingLoadCase
  readonly displacement: ReportingLoadCase
  readonly buckling: ReportingLoadCase
  readonly governing: ReportingLoadCase
  readonly caseCount: number
  readonly maxUtilization: number
  readonly maxTopDisplacementM: number
  readonly minimumBucklingFactor: number
}

export interface BottomModuleCapacity {
  readonly mode: 'local-member-buckling' | 'tensile-rupture'
  readonly utilization: number
  readonly reserveFactor: number
  readonly windDirectionDeg: number
  readonly memberId: number
  readonly maxBucklingUtilization: number
  readonly maxRuptureUtilization: number
  readonly explanation: string
}

export interface HeightLimitCase {
  readonly moduleCount: number
  readonly heightM: number
  readonly designPasses: boolean
  readonly designScore: number
  readonly designMode: string
  readonly ultimatePasses: boolean
  readonly ultimateScore: number
  readonly ultimateMode: string
  readonly memberUtilization: number
  readonly topDisplacementMm: number
  readonly bucklingFactor: number
  readonly boltUtilization: number
  readonly bottomModule: BottomModuleCapacity | null
}

export interface HeightBoundary {
  readonly bounded: boolean
  readonly maximumModules: number
  readonly firstFailModules: number | null
  readonly maximumHeightM: number
  readonly limitCase: HeightLimitCase | null
  readonly firstFailCase: HeightLimitCase | null
  readonly criteria: string
}

export interface HeightCapacity {
  readonly method: string
  readonly searchLimitModules: number
  readonly evaluationCount: number
  readonly moduleHeightM: number
  readonly design: HeightBoundary
  readonly ultimateResistance: HeightBoundary
  readonly bottomModuleAtDesignLimit: BottomModuleCapacity | null
  readonly bottomModuleAtFirstDesignOverload: BottomModuleCapacity | null
  readonly evaluatedCases: readonly HeightLimitCase[]
}

export interface CalculationMethodInfo {
  readonly id?: string
  readonly description?: string
  readonly [key: string]: unknown
}

export interface ReportingCalculationResult {
  readonly parameters: ResolvedProject
  readonly method?: CalculationMethodInfo
  readonly model: GeneratedMastModel
  readonly cases: readonly ReportingLoadCase[]
  readonly loads: BuiltLoadCase
  readonly analysis: ReportingAnalysis
  readonly envelope: ReportingEnvelope
  readonly warnings: readonly string[]
  readonly connections?: ReturnType<typeof calculateConnectionChecks> | null
  readonly lateralCapacity?: ReturnType<typeof calculateLateralCapacity> | null
  readonly staticPayloadCapacity?: ReturnType<typeof calculateStaticPayloadCapacity> | null
  readonly craneBoomCapacity?: ReturnType<typeof calculateCraneBoomCapacity> | null
  readonly heightCapacity?: HeightCapacity | null
  readonly verification?: ReturnType<typeof buildVerificationPassport> | null
  readonly performance?: Readonly<Record<string, unknown>>
  readonly assemblyMass?: ReturnType<typeof calculateAssemblyMass> | null
}

export interface ReportingBuildInfo {
  readonly repository?: string
  readonly ref?: string | null
  readonly sha?: string | null
  readonly runId?: string | number | null
}
