import type { ResolvedProject } from '../../domain/contracts.js'
import type {
  buildVerificationPassport,
  calculateConnectionChecks,
  calculateCraneBoomCapacity,
  calculateLateralCapacity,
  calculateStaticPayloadCapacity,
} from '../../engineering/index.js'
import type { CheckedFrameAnalysis } from '../../engineering/contracts.js'
import type { GeneratedMastModel } from '../../structural-analysis/index.js'
import type { LoadCase } from '../../structural-analysis/contracts.js'

export interface ReportingModuleAction {
  readonly nodeId: number
  readonly forceN: readonly number[]
  readonly momentNm: readonly number[]
}

export interface ReportingModuleResult {
  readonly bottomNodeIds: readonly number[]
  readonly topNodeIds: readonly number[]
  readonly memberIds: readonly number[]
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
  readonly loads: LoadCase
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

export interface HeightLimitCase {
  readonly designMode?: string | null
  readonly ultimateMode?: string | null
  readonly [key: string]: unknown
}

export interface HeightBoundary {
  readonly bounded: boolean
  readonly maximumModules: number
  readonly maximumHeightM: number
  readonly firstFailCase?: HeightLimitCase | null
  readonly [key: string]: unknown
}

export interface BottomModuleCapacity {
  readonly mode?: string | null
  readonly [key: string]: unknown
}

export interface HeightCapacity {
  readonly design?: HeightBoundary
  readonly ultimateResistance?: HeightBoundary
  readonly bottomModuleAtDesignLimit?: BottomModuleCapacity | null
  readonly bottomModuleAtFirstDesignOverload?: BottomModuleCapacity | null
  readonly [key: string]: unknown
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
  readonly loads: LoadCase
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
  readonly assemblyMass?: Readonly<Record<string, unknown>>
}

export interface ReportingBuildInfo {
  readonly repository?: string
  readonly ref?: string | null
  readonly sha?: string | null
  readonly runId?: string | number | null
}
