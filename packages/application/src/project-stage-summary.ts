import type { ApplicationErrorCategory, CalculationResult } from './contracts.js'
import {
  createEngineeringSummary,
  type EngineeringCriterion,
} from './engineering-summary.js'
import { immutablePublicResult } from './immutability.js'
import type { calculateProjectErection } from './project-erection.js'
import type { calculateProjectGuys } from './project-guys.js'

export const PROJECT_STAGE_SUMMARY_SCHEMA = 'mast-calculator/project-stage-summary/v1' as const

export type ProjectStageName = 'operational' | 'guys' | 'erection'
export type ProjectStageStatus =
  | 'not-requested'
  | 'pending'
  | 'numerical-error'
  | 'infeasible'
  | 'failed'
  | 'passed'
export type ProjectOverallStatus = 'pass' | 'fail' | 'incomplete'

export interface SerializedStageError {
  readonly category: ApplicationErrorCategory
  readonly code: string
  readonly message: string
}

export interface ProjectStageErrors {
  readonly guys: SerializedStageError | null
  readonly erection: SerializedStageError | null
}

type GuyedResult = Exclude<ReturnType<typeof calculateProjectGuys>, null>
type ErectionResult = Exclude<ReturnType<typeof calculateProjectErection>, null>

export interface ProjectStageCalculationSnapshot {
  readonly result: CalculationResult
  readonly guyedResult: GuyedResult | null
  readonly erectionResult: ErectionResult | null
  readonly stageErrors: ProjectStageErrors
}

export interface ProjectStageScope {
  readonly requestedGuys: boolean
  readonly requestedErection: boolean
}

export interface ProjectStageStatusSummary {
  readonly requested: boolean
  readonly executed: boolean
  readonly feasible: boolean | null
  readonly verified: boolean
  readonly status: ProjectStageStatus
  readonly code?: string
  readonly reason?: string
}

export interface ProjectStageSummary {
  readonly schema: typeof PROJECT_STAGE_SUMMARY_SCHEMA
  readonly overallStatus: ProjectOverallStatus
  readonly requestedStages: readonly ProjectStageName[]
  readonly stages: Readonly<{
    operational: ProjectStageStatusSummary
    guys: ProjectStageStatusSummary
    erection: ProjectStageStatusSummary
  }>
}

function notRequested(): ProjectStageStatusSummary {
  return {
    requested: false,
    executed: false,
    feasible: null,
    verified: false,
    status: 'not-requested',
  }
}

function criteriaStage(
  criteria: readonly EngineeringCriterion[],
  requested: boolean,
): ProjectStageStatusSummary {
  if (!requested) return notRequested()
  const required = criteria.filter((item) => item.required)
  if (required.some((item) => item.status === 'fail')) {
    return {
      requested: true,
      executed: true,
      feasible: true,
      verified: true,
      status: 'failed',
    }
  }
  if (required.some((item) => item.status === 'not-verified')) {
    return {
      requested: true,
      executed: true,
      feasible: true,
      verified: false,
      status: 'pending',
    }
  }
  return {
    requested: true,
    executed: true,
    feasible: true,
    verified: true,
    status: 'passed',
  }
}

function operationalStage(result: CalculationResult): ProjectStageStatusSummary {
  const engineering = createEngineeringSummary(result)
  return criteriaStage(
    engineering.criteria.filter((item) => item.source === 'bare' || item.source === 'verification'),
    true,
  )
}

function numericalStage(error: SerializedStageError): ProjectStageStatusSummary {
  return {
    requested: true,
    executed: true,
    feasible: null,
    verified: false,
    status: 'numerical-error',
    code: error.code,
    reason: error.message,
  }
}

function guyStage(
  snapshot: ProjectStageCalculationSnapshot,
  requested: boolean,
): ProjectStageStatusSummary {
  if (!requested) return notRequested()
  if (snapshot.stageErrors.guys) return numericalStage(snapshot.stageErrors.guys)
  if (!snapshot.guyedResult) {
    return {
      requested: true,
      executed: false,
      feasible: null,
      verified: false,
      status: 'numerical-error',
      code: 'missing-guy-stage-result',
      reason: 'Запрошенная стадия растяжек не вернула результат',
    }
  }
  const engineering = createEngineeringSummary(snapshot.result, snapshot.guyedResult)
  return criteriaStage(
    engineering.criteria.filter((item) => item.source === 'guyed'),
    true,
  )
}

function erectionStage(
  snapshot: ProjectStageCalculationSnapshot,
  requested: boolean,
): ProjectStageStatusSummary {
  if (!requested) return notRequested()
  if (snapshot.stageErrors.erection) return numericalStage(snapshot.stageErrors.erection)
  const erection = snapshot.erectionResult
  if (!erection) {
    return {
      requested: true,
      executed: false,
      feasible: null,
      verified: false,
      status: 'numerical-error',
      code: 'missing-erection-stage-result',
      reason: 'Запрошенная монтажная стадия не вернула результат',
    }
  }

  const envelope = erection.envelope
  if (envelope.infeasibleSampleCount > 0) {
    const firstInfeasible = envelope.samples.find((sample) => sample.result.status === 'infeasible')
    return {
      requested: true,
      executed: true,
      feasible: false,
      verified: true,
      status: 'infeasible',
      code: firstInfeasible?.result.status === 'infeasible'
        ? firstInfeasible.result.reason
        : 'erection-path-infeasible',
      reason: 'В запрошенной траектории монтажа обнаружено физически недопустимое состояние',
    }
  }

  if (envelope.samples.length === 0 || envelope.feasibleSampleCount === 0) {
    return {
      requested: true,
      executed: true,
      feasible: null,
      verified: false,
      status: 'numerical-error',
      code: 'empty-erection-envelope',
      reason: 'Монтажная огибающая не содержит рассчитанных состояний',
    }
  }

  if (!envelope.diagnostics.converged) {
    return {
      requested: true,
      executed: true,
      feasible: true,
      verified: false,
      status: 'numerical-error',
      code: `erection-sampling-${envelope.diagnostics.reason}`,
      reason: 'Адаптивная дискретизация монтажной траектории не достигла заданной точности',
    }
  }

  return {
    requested: true,
    executed: true,
    feasible: true,
    verified: false,
    status: 'pending',
    code: 'erection-strength-not-verified',
    reason: 'Геометрия монтажной траектории выполнима, но проверка прочности монтажной стадии относится к #72',
  }
}

function overallStatus(stages: readonly ProjectStageStatusSummary[]): ProjectOverallStatus {
  if (stages.some((stage) => stage.status === 'failed' || stage.status === 'infeasible')) return 'fail'
  if (stages.some((stage) => stage.status === 'pending' || stage.status === 'numerical-error')) return 'incomplete'
  return 'pass'
}

/**
 * Application-owned projection of the exact project-stage snapshot.
 * Sampling convergence is numerical evidence only; it never turns an erection
 * envelope into engineering acceptance. Until #72 supplies erection strength
 * criteria, a fully feasible erection path remains explicitly pending.
 */
export function createProjectStageSummary(
  snapshot: ProjectStageCalculationSnapshot,
  scope: ProjectStageScope,
): ProjectStageSummary {
  const stages = {
    operational: operationalStage(snapshot.result),
    guys: guyStage(snapshot, scope.requestedGuys),
    erection: erectionStage(snapshot, scope.requestedErection),
  }
  const requestedStages: ProjectStageName[] = ['operational']
  if (scope.requestedGuys) requestedStages.push('guys')
  if (scope.requestedErection) requestedStages.push('erection')
  return immutablePublicResult({
    schema: PROJECT_STAGE_SUMMARY_SCHEMA,
    overallStatus: overallStatus(requestedStages.map((name) => stages[name])),
    requestedStages,
    stages,
  })
}
