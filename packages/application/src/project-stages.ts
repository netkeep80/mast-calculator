import type {
  ProjectErectionInput,
  ProjectGuysInput,
  ProjectInput,
} from '../../domain/contracts.js'
import type { ApplicationAbortSignal } from './contracts.js'
import { immutablePublicResult, type ImmutableResultOptions } from './immutability.js'
import { calculateProjectErection } from './project-erection.js'
import { calculateProjectGuys } from './project-guys.js'
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

/**
 * Canonical stage-oriented project orchestration. Operational CalculationResult,
 * guyed response and erection response are immutable siblings. No stage mutates
 * another stage's result and adapters own transport only, not sequencing policy.
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
        layout.operationalEnd * Number(progress.completed ?? 0) / Math.max(1, Number(progress.total ?? 1)),
      ),
    }),
  })

  let cursor = layout.operationalEnd
  let guyedResult = null
  if (hasGuys) {
    options.onProgress?.({
      phase: 'guys',
      label: 'Нелинейный расчёт tension-only растяжек',
      fraction: cursor,
    })
    guyedResult = calculateProjectGuys(input, guys, result, {
      ...immutableOptions,
      ...cancellationOptions,
    })
    cursor += layout.optionalShare
    options.onProgress?.({
      phase: 'guys',
      label: 'Расчёт растяжек и соединений завершён',
      fraction: cursor,
    })
  }

  let erectionResult = null
  if (hasErection) {
    const erectionStart = cursor
    options.onProgress?.({
      phase: 'erection',
      label: 'Адаптивная огибающая монтажа',
      fraction: erectionStart,
    })
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
    cursor += layout.optionalShare
    options.onProgress?.({
      phase: 'erection',
      label: 'Монтажная огибающая завершена',
      fraction: cursor,
    })
  }

  options.onProgress?.({
    phase: 'complete',
    label: 'Все включённые стадии расчёта завершены',
    fraction: 1,
  })
  return immutablePublicResult({ result, guyedResult, erectionResult }, options)
}
