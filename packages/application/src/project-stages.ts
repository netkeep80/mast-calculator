import type {
  ProjectErectionInput,
  ProjectGuysInput,
  ProjectInput,
} from '../../domain/contracts.js'
import type { ApplicationAbortSignal } from './contracts.js'
import { toApplicationError } from './errors.js'
import { immutablePublicResult, type ImmutableResultOptions } from './immutability.js'
import { calculateProjectErection } from './project-erection.js'
import { calculateProjectGuys } from './project-guys.js'
import {
  createProjectStageSummary,
  type SerializedStageError,
} from './project-stage-summary.js'
import {
  calculateProject,
  type ProjectJobProgress,
} from './use-cases.js'

export interface CalculateProjectStagesOptions extends ImmutableResultOptions {
  readonly onProgress?: (progress: ProjectJobProgress) => void
  readonly signal?: ApplicationAbortSignal
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number(value) || 0))

function stageLayout(hasGuys: boolean, hasErection: boolean) {
  const optionalCount = Number(hasGuys) + Number(hasErection)
  if (optionalCount === 0) return { operationalEnd: 1, optionalShare: 0 }
  const operationalEnd = optionalCount === 1 ? 0.78 : 0.64
  return { operationalEnd, optionalShare: (1 - operationalEnd) / optionalCount }
}

function captureOptionalStageError(error: unknown): SerializedStageError {
  const normalized = toApplicationError(error)
  if (normalized.category !== 'numerical-failure' && normalized.category !== 'convergence-failure') {
    throw normalized
  }
  return Object.freeze({
    category: normalized.category,
    code: normalized.code,
    message: normalized.message,
  })
}

/**
 * Canonical stage-oriented project orchestration. Operational CalculationResult,
 * guyed response and erection response are immutable siblings. No stage mutates
 * another stage's result and adapters own transport only, not sequencing policy.
 *
 * Numerical/convergence failures of an optional stage are retained as explicit
 * stage outcomes so an already-computed operational result cannot be mislabeled
 * as full PASS. Cancellation and invalid/unsupported configuration remain
 * fail-fast application errors.
 */
export function calculateProjectStages(
  input: ProjectInput,
  guys: ProjectGuysInput | null | undefined,
  erection: ProjectErectionInput | null | undefined,
  options: CalculateProjectStagesOptions = {},
) {
  const hasGuys = Boolean(guys?.tiers?.length)
  const hasErection = erection?.mode === 'tilt-up'
  const layout = stageLayout(hasGuys, hasErection)
  const immutableOptions: ImmutableResultOptions = options.freezeResult === undefined
    ? {}
    : { freezeResult: options.freezeResult }
  const cancellationOptions = options.signal === undefined ? {} : { signal: options.signal }

  const result = calculateProject(input, {
    ...immutableOptions,
    ...cancellationOptions,
    onProgress: (progress) => options.onProgress?.({
      phase: progress.phase,
      label: progress.label,
      fraction: clamp01(
        layout.operationalEnd * progress.completed / Math.max(1, progress.total),
      ),
    }),
  })

  let cursor = layout.operationalEnd
  let guyedResult = null
  let guyStageError: SerializedStageError | null = null
  if (hasGuys) {
    options.onProgress?.({
      phase: 'guys',
      label: 'Нелинейный расчёт tension-only растяжек',
      fraction: cursor,
    })
    try {
      guyedResult = calculateProjectGuys(input, guys, result, {
        ...immutableOptions,
        ...cancellationOptions,
      })
    } catch (error) {
      guyStageError = captureOptionalStageError(error)
    }
    cursor += layout.optionalShare
    options.onProgress?.({
      phase: 'guys',
      label: guyStageError
        ? 'Расчёт растяжек завершён с численной ошибкой'
        : 'Расчёт растяжек и соединений завершён',
      fraction: cursor,
    })
  }

  let erectionResult = null
  let erectionStageError: SerializedStageError | null = null
  if (hasErection) {
    const erectionStart = cursor
    options.onProgress?.({
      phase: 'erection',
      label: 'Адаптивная огибающая монтажа',
      fraction: erectionStart,
    })
    try {
      erectionResult = calculateProjectErection(input, erection, {
        ...immutableOptions,
        ...cancellationOptions,
        onEvaluation: (progress) => options.onProgress?.({
          phase: 'erection',
          label: `Монтаж: угол ${progress.angleDeg.toFixed(2)}°`,
          fraction: clamp01(
            erectionStart + layout.optionalShare
              * (progress.evaluationNumber - 1) / Math.max(1, progress.maximumEvaluations),
          ),
        }),
      })
    } catch (error) {
      erectionStageError = captureOptionalStageError(error)
    }
    cursor += layout.optionalShare
    options.onProgress?.({
      phase: 'erection',
      label: erectionStageError
        ? 'Монтажная стадия завершена с численной ошибкой'
        : 'Монтажная огибающая завершена',
      fraction: cursor,
    })
  }

  const stageErrors = Object.freeze({
    guys: guyStageError,
    erection: erectionStageError,
  })
  const stageSnapshot = { result, guyedResult, erectionResult, stageErrors }
  const stageSummary = createProjectStageSummary(stageSnapshot, {
    requestedGuys: hasGuys,
    requestedErection: hasErection,
  })

  options.onProgress?.({
    phase: 'complete',
    label: 'Все включённые стадии расчёта завершены',
    fraction: 1,
  })
  return immutablePublicResult({ ...stageSnapshot, stageSummary }, options)
}
