import type { ResolvedProject } from '../../domain/contracts.js'
import type { MastModel } from '../../structural-analysis/contracts.js'

export interface AssemblyMass {
  readonly method: string
  readonly densityKgM3: number
  readonly moduleDiametersMm: readonly number[]
  readonly includesInGlobalFemSelfWeight: boolean
  readonly rib: Readonly<Record<string, unknown>>
  readonly hardware: Readonly<Record<string, unknown>>
  readonly weld: Readonly<Record<string, unknown>>
  readonly intermoduleJoint: Readonly<Record<string, unknown>>
  readonly module: Readonly<Record<string, unknown>>
  readonly mast: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

export interface ProcurementEstimate {
  readonly method?: string
  readonly items?: readonly Readonly<Record<string, unknown>>[]
  readonly total?: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

export const DESIGN_PACKAGE_SCHEMA = 'mast-calculator/design-package/v1' as const

export interface DesignPackageV1 {
  readonly schema: typeof DESIGN_PACKAGE_SCHEMA
  readonly createdAt: string
  readonly source: {
    readonly repository: string
    readonly ref: string | null
    readonly sha: string | null
  }
  readonly result: {
    readonly parameters: ResolvedProject
    readonly model: MastModel
    readonly analysis: {
      readonly memberResults: readonly {
        readonly memberId: number
        readonly utilization: number
      }[]
    }
    readonly connections: Readonly<Record<string, unknown>> | null
    readonly assemblyMass: AssemblyMass
  }
}
