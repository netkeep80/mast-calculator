import type { ProjectInput, ResolvedProject } from '../../domain/contracts.js'
import type { AssemblyMass } from '../../design/contracts.js'
import type {
  CheckedFrameAnalysis,
  ConnectionResult,
  CraneBoomCapacity,
  EngineeringCase,
  GuyedProjectResult,
  HeightCapacity,
  LateralCapacity,
  StaticPayloadCapacity,
  VerificationPassport,
} from '../../engineering/contracts.js'
import type { LoadCase, MastModel } from '../../structural-analysis/contracts.js'

export type ApplicationErrorCategory =
  | 'input-validation'
  | 'unsupported-configuration'
  | 'numerical-failure'
  | 'convergence-failure'
  | 'schema-error'
  | 'internal-invariant'

export interface ApplicationErrorShape {
  readonly name: 'MastApplicationError'
  readonly category: ApplicationErrorCategory
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export interface CalculationProgress {
  readonly phase: string
  readonly label: string
  readonly completed: number
  readonly total: number
}

export interface SolverOptions {
  readonly onProgress?: (progress: CalculationProgress) => void
}

export interface VerificationOptions {
  readonly freezeResult?: boolean
}

export type CalculateProjectOptions = SolverOptions & VerificationOptions

export interface CalculationMethod {
  readonly id: string
  readonly description: string
}

export interface CalculationEnvelope {
  readonly strength: EngineeringCase
  readonly displacement: EngineeringCase
  readonly buckling: EngineeringCase
  readonly governing: EngineeringCase
  readonly caseCount: number
  readonly maxUtilization: number
  readonly maxTopDisplacementM: number
  readonly minimumBucklingFactor: number
}

export interface CalculationPerformance {
  readonly linearSystemSolver: string
  readonly modularStaticSolver: string | null
  readonly modularInterfaceFactorizationCount: number
  readonly modularRelativeDisplacementDifference: number | null
  readonly modularInterfaceEquilibriumResidual: number | null
  readonly freeDofCount: number
  readonly stiffnessBandwidth: number
  readonly stiffnessFactorizationCount: number
  readonly operationalCaseCount: number
  readonly lateralCaseCount: number
  readonly staticPayloadEvaluationCount: number
  readonly heightSearchEvaluationCount: number
  readonly verificationInternalCheckCount: number
  readonly rotationalSymmetryDeg: number
  readonly jointConfiguratorMode: string
}

export interface CalculationResult {
  readonly parameters: ResolvedProject
  readonly method: CalculationMethod
  readonly model: MastModel
  readonly cases: readonly EngineeringCase[]
  readonly loads: LoadCase
  readonly analysis: CheckedFrameAnalysis
  readonly envelope: CalculationEnvelope
  readonly warnings: readonly string[]
  readonly connections: ConnectionResult
  readonly lateralCapacity: LateralCapacity
  readonly staticPayloadCapacity: StaticPayloadCapacity
  readonly heightCapacity: HeightCapacity
  readonly verification: VerificationPassport
  readonly performance: CalculationPerformance
  readonly assemblyMass: AssemblyMass
  readonly craneBoomCapacity: CraneBoomCapacity
}

export interface OptimizationOptions extends SolverOptions {
  readonly diameters?: readonly number[]
  readonly stopAtFirstPassing?: boolean
}

export interface OptimizationResult {
  readonly evaluatedCount: number
  readonly variants: readonly Readonly<Record<string, unknown>>[]
  readonly [key: string]: unknown
}

export interface ApplicationUseCases {
  calculateProject(input: ProjectInput, options?: CalculateProjectOptions): CalculationResult
  optimizeProject(input: ProjectInput, options?: OptimizationOptions): OptimizationResult
  calculateGuyedProject(input: ProjectInput, tiers?: readonly unknown[], options?: SolverOptions): GuyedProjectResult
  createVerification(result: CalculationResult): VerificationPassport
}
