import type { ResolvedProject } from '../../domain/contracts.js'

export type Vector3 = readonly [number, number, number]
export type Vector6 = readonly [number, number, number, number, number, number]

export interface StructuralNode {
  readonly id: number
  readonly position: Vector3
  readonly restrained: readonly [boolean, boolean, boolean, boolean, boolean, boolean]
  readonly level?: number
}

export interface StructuralMember {
  readonly id: number
  readonly nodeA: number
  readonly nodeB: number
  readonly diameterM: number
  readonly youngModulusPa: number
  readonly nominalYoungModulusPa?: number
  readonly poissonRatio: number
  readonly densityKgM3: number
  readonly yieldStrengthPa: number
  readonly tensileStrengthPa: number
  readonly effectiveLengthFactor: number
  readonly role?: string
  readonly moduleIndex?: number
}

export interface PhysicalModule {
  readonly moduleIndex: number
  readonly memberIds: readonly number[]
  readonly interfaceNodeIds?: readonly number[]
}

export interface MastModel {
  readonly moduleCount: number
  readonly nodes: readonly StructuralNode[]
  readonly members: readonly StructuralMember[]
  readonly topNodeIds: readonly number[]
  readonly physicalModules?: readonly PhysicalModule[]
}

export interface LoadCase {
  readonly nodalLoads: readonly Vector3[]
  readonly nodalMoments?: readonly Vector3[]
  readonly memberDistributedLoads?: readonly Vector3[]
  readonly totalAppliedLoad: Vector3
  readonly distributedResultant?: Vector3
  readonly nodalResultant?: Vector3
  readonly selfWeightN?: number
  readonly iceWeightN?: number
  readonly memberWindN?: number
  readonly equipmentWindN?: number
}

export interface RawMemberResult {
  readonly memberId: number
  readonly lengthM: number
  readonly localAxes: readonly Vector3[]
  readonly distributedLoadLocalNPerM: Vector3
  readonly localEndForces: readonly number[]
  readonly axialForceAtAN: number
  readonly axialForceAtBN: number
}

export interface BucklingResult {
  readonly criticalLoadFactor: number
  readonly mode: readonly Vector3[]
  readonly rotations: readonly Vector3[]
  readonly residual: number
  readonly eigenResidual: number
  readonly iterations: number
}

export interface AnalysisDiagnostics {
  readonly relativeResidual: number
  readonly minPivotRatio: number
  readonly freeDofCount: number
  readonly stiffnessBandwidth: number
  readonly stiffnessFactorizationCount: number
  readonly maximumNodeEquilibriumResidual: number
  readonly globalMomentResidual: number
  readonly maximumGuyCorrectedFreeResidualN?: number
}

export interface RawFrameAnalysis {
  readonly solver: 'linear-3d-frame-euler-bernoulli'
  readonly linearSystemSolver: string
  readonly degreesOfFreedomPerNode: 6
  readonly displacements: readonly Vector3[]
  readonly rotations: readonly Vector3[]
  readonly reactions: readonly Vector3[]
  readonly reactionMoments: readonly Vector3[]
  readonly memberResults: readonly RawMemberResult[]
  readonly maxDisplacementM: number
  readonly maxTopDisplacementM: number
  readonly maxUtilization: null
  readonly criticalMemberId: null
  readonly totalMassKg: number
  readonly buckling: BucklingResult
  readonly diagnostics: AnalysisDiagnostics
}

export interface StructuralCase {
  readonly windDirectionDeg: number
  readonly loads: LoadCase
  readonly analysis: RawFrameAnalysis
}

export interface CompiledFrameSystem {
  readonly method: string
  readonly dofCount: number
  readonly freeDofs: readonly number[]
  readonly bandwidth: number
  readonly totalMassKg: number
  readonly factorizationCount: number
  readonly parameters: ResolvedProject
}
