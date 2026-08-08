import type {
  calculateGuyedProject,
  calculateProject,
} from './use-cases.js'
import { immutablePublicResult } from './immutability.js'

export const ENGINEERING_SUMMARY_SCHEMA = 'mast-calculator/engineering-summary/v1' as const

export type EngineeringOverallStatus = 'pass' | 'fail' | 'incomplete'
export type EngineeringCriterionStatus = 'pass' | 'fail' | 'not-verified' | 'info'
export type EngineeringCriterionComparison = '<=' | '>=' | 'verified'
export type EngineeringCriterionSource = 'bare' | 'guyed' | 'verification'

type BareResult = ReturnType<typeof calculateProject>
type LowLevelGuyedResult = ReturnType<typeof calculateGuyedProject>
type GuyedResult = LowLevelGuyedResult & {
  readonly connectionEnvelope?: {
    readonly passes: boolean
    readonly maximumBoltUtilization: number
  }
}

export interface EngineeringCriterion {
  readonly id: string
  readonly group: 'structure' | 'connection' | 'guys' | 'verification'
  readonly source: EngineeringCriterionSource
  readonly status: EngineeringCriterionStatus
  readonly required: boolean
  readonly comparison: EngineeringCriterionComparison
  readonly value: number | null
  readonly limit: number | null
  /** Normalized demand/capacity score. Values > 1 are over limit when applicable. */
  readonly ratio: number | null
  readonly unit: 'ratio' | 'mm' | 'count' | null
}

function finiteRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator)) return numerator > 0 ? Number.POSITIVE_INFINITY : 0
  if (!Number.isFinite(denominator)) return denominator > 0 ? 0 : Number.POSITIVE_INFINITY
  return numerator / Math.max(Math.abs(denominator), Number.EPSILON)
}

function lessOrEqualCriterion(
  id: string,
  group: EngineeringCriterion['group'],
  source: EngineeringCriterionSource,
  value: number,
  limit: number,
  unit: EngineeringCriterion['unit'],
  required = true,
): EngineeringCriterion {
  return {
    id,
    group,
    source,
    status: value <= limit ? 'pass' : 'fail',
    required,
    comparison: '<=',
    value,
    limit,
    ratio: finiteRatio(value, limit),
    unit,
  }
}

function greaterOrEqualCriterion(
  id: string,
  group: EngineeringCriterion['group'],
  source: EngineeringCriterionSource,
  value: number,
  limit: number,
  unit: EngineeringCriterion['unit'],
  required = true,
): EngineeringCriterion {
  const ratio = Number.isFinite(value) ? finiteRatio(limit, value) : 0
  return {
    id,
    group,
    source,
    status: !Number.isFinite(value) || value >= limit ? 'pass' : 'fail',
    required,
    comparison: '>=',
    value,
    limit,
    ratio,
    unit,
  }
}

function bareStructuralCriteria(result: BareResult, required: boolean): EngineeringCriterion[] {
  return [
    lessOrEqualCriterion(
      'bare-member-utilization',
      'structure',
      'bare',
      result.envelope.maxUtilization,
      1,
      'ratio',
      required,
    ),
    greaterOrEqualCriterion(
      'bare-global-buckling',
      'structure',
      'bare',
      result.envelope.minimumBucklingFactor,
      result.parameters.minimumBucklingFactor,
      'ratio',
      required,
    ),
    lessOrEqualCriterion(
      'bare-top-displacement',
      'structure',
      'bare',
      result.envelope.maxTopDisplacementM * 1000,
      result.parameters.displacementLimitMm,
      'mm',
      required,
    ),
  ]
}

function bareConnectionCriterion(result: BareResult): EngineeringCriterion {
  const passes = result.connections?.passes !== false
  const boltUtilization = result.connections?.bolt?.selected?.utilization ?? null
  return {
    id: 'bare-connection',
    group: 'connection',
    source: 'bare',
    status: passes ? 'pass' : 'fail',
    required: true,
    comparison: '<=',
    value: boltUtilization,
    limit: 1,
    ratio: passes
      ? (boltUtilization ?? 0)
      : Math.max(1, boltUtilization ?? 1),
    unit: 'ratio',
  }
}

function verificationCriterion(result: BareResult): EngineeringCriterion {
  const failed = result.verification?.counts?.failed
  if (failed === undefined) {
    return {
      id: 'internal-verification',
      group: 'verification',
      source: 'verification',
      status: 'not-verified',
      required: true,
      comparison: 'verified',
      value: null,
      limit: 0,
      ratio: null,
      unit: 'count',
    }
  }
  return {
    id: 'internal-verification',
    group: 'verification',
    source: 'verification',
    status: failed === 0 ? 'pass' : 'fail',
    required: true,
    comparison: '<=',
    value: failed,
    limit: 0,
    ratio: failed === 0 ? 0 : Number.POSITIVE_INFINITY,
    unit: 'count',
  }
}

function guyedConnectionCriterion(result: GuyedResult): EngineeringCriterion {
  const envelope = result.connectionEnvelope
  if (!envelope) {
    return {
      id: 'guyed-connection-envelope',
      group: 'connection',
      source: 'guyed',
      status: 'not-verified',
      required: true,
      comparison: 'verified',
      value: null,
      limit: null,
      ratio: null,
      unit: null,
    }
  }
  const boltUtilization = envelope.maximumBoltUtilization
  return {
    id: 'guyed-connection-envelope',
    group: 'connection',
    source: 'guyed',
    status: envelope.passes ? 'pass' : 'fail',
    required: true,
    comparison: '<=',
    value: boltUtilization,
    limit: 1,
    ratio: envelope.passes ? boltUtilization : Math.max(1, boltUtilization),
    unit: 'ratio',
  }
}

function guyedCriteria(result: GuyedResult): EngineeringCriterion[] {
  const nonlinearConverged = result.cases.every((item) => item.nonlinear.converged)
  return [
    lessOrEqualCriterion(
      'guyed-member-utilization',
      'structure',
      'guyed',
      result.envelope.maxUtilization,
      1,
      'ratio',
    ),
    greaterOrEqualCriterion(
      'guyed-global-buckling',
      'structure',
      'guyed',
      result.envelope.minimumBucklingFactor,
      result.parameters.minimumBucklingFactor,
      'ratio',
    ),
    lessOrEqualCriterion(
      'guyed-top-displacement',
      'structure',
      'guyed',
      result.envelope.maxTopDisplacementM * 1000,
      result.parameters.displacementLimitMm,
      'mm',
    ),
    lessOrEqualCriterion(
      'guy-cable-utilization',
      'guys',
      'guyed',
      result.envelope.maximumCableUtilization,
      1,
      'ratio',
    ),
    {
      id: 'guy-nonlinear-convergence',
      group: 'guys',
      source: 'guyed',
      status: nonlinearConverged ? 'pass' : 'fail',
      required: true,
      comparison: 'verified',
      value: nonlinearConverged ? 0 : result.cases.filter((item) => !item.nonlinear.converged).length,
      limit: 0,
      ratio: nonlinearConverged ? 0 : Number.POSITIVE_INFINITY,
      unit: 'count',
    },
    guyedConnectionCriterion(result),
  ]
}

function overallStatus(criteria: readonly EngineeringCriterion[]): EngineeringOverallStatus {
  const required = criteria.filter((item) => item.required)
  if (required.some((item) => item.status === 'fail')) return 'fail'
  if (required.some((item) => item.status === 'not-verified')) return 'incomplete'
  return 'pass'
}

function governingCriterion(criteria: readonly EngineeringCriterion[]): EngineeringCriterion | null {
  const scored = criteria.filter((item) => item.required && item.ratio !== null && item.status !== 'not-verified')
  if (scored.length === 0) return null
  const failed = scored.filter((item) => item.status === 'fail')
  const candidates = failed.length > 0 ? failed : scored
  return [...candidates].sort((left, right) => (right.ratio ?? 0) - (left.ratio ?? 0))[0] ?? null
}

/**
 * One presentation-neutral criteria projection for Web/Desktop summaries.
 * For a guyed project, the nonlinear structural/cable envelope is authoritative
 * for member/buckling/displacement demand. The canonical composite calculation
 * additionally checks the already-selected physical intermodule joint and
 * member-end welds against those same nonlinear cases. Low-level guy-only
 * results without that projection remain explicitly incomplete rather than
 * receiving an accidental PASS.
 *
 * Local guy attachment brackets/eyes, anchors, turnbuckles, thimbles/clamps and
 * soil capacity are outside `guyed-connection-envelope` and remain separate
 * engineering checks.
 */
export function createEngineeringSummary(
  result: BareResult,
  guyedResult: GuyedResult | null = null,
) {
  const isGuyed = guyedResult !== null
  const criteria: EngineeringCriterion[] = [
    ...bareStructuralCriteria(result, !isGuyed),
    bareConnectionCriterion(result),
    verificationCriterion(result),
    ...(guyedResult ? guyedCriteria(guyedResult) : []),
  ]
  const governing = governingCriterion(criteria)
  const pending = criteria.filter((item) => item.required && item.status === 'not-verified')
  return immutablePublicResult({
    schema: ENGINEERING_SUMMARY_SCHEMA,
    mode: isGuyed ? 'guyed' as const : 'bare' as const,
    overallStatus: overallStatus(criteria),
    governingCriterionId: governing?.id ?? null,
    pendingCriterionIds: pending.map((item) => item.id),
    criteria,
    capacities: {
      lateralCriticalForceKgf: result.lateralCapacity?.criticalForceKgf ?? null,
      staticMaximumTopMassKg: result.staticPayloadCapacity?.maximumTopEquipmentMassKg ?? null,
      heightDesignMaximumM: result.heightCapacity?.design?.maximumHeightM ?? null,
      heightDesignMaximumModules: result.heightCapacity?.design?.maximumModules ?? null,
      craneMaximumEndPayloadMassKg: result.craneBoomCapacity?.maximumEndPayloadMassKg ?? null,
      guyedCapacitiesAvailable: false,
    },
  })
}
