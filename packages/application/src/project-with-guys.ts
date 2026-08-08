import type { ProjectGuysInput, ProjectInput } from '../../domain/contracts.js'
import type { ApplicationAbortSignal } from './contracts.js'
import { attachGuyedConnectionEnvelope } from './guyed-connection-envelope.js'
import { immutablePublicResult, type ImmutableResultOptions } from './immutability.js'
import {
  calculateGuyedProject,
  calculateProject,
  type ProjectJobProgress,
} from './use-cases.js'

export interface CalculateProjectWithGuysOptions extends ImmutableResultOptions {
  readonly bareCalculationShare?: number
  readonly onProgress?: (progress: ProjectJobProgress) => void
  readonly signal?: ApplicationAbortSignal
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number(value) || 0))

/**
 * Canonical application orchestration for a project that may contain guy wires.
 * The normal complete CalculationResult remains authoritative for bare-frame
 * reports/limits. For guyed projects the nonlinear cable/frame envelope is
 * additionally rechecked against the exact physical intermodule joint selected
 * by that complete result.
 */
export function calculateProjectWithGuys(
  input: ProjectInput,
  guys: ProjectGuysInput | null | undefined,
  options: CalculateProjectWithGuysOptions = {},
) {
  const hasGuys = Boolean(guys?.tiers?.length)
  const bareShare = hasGuys ? clamp01(options.bareCalculationShare ?? 0.82) : 1
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
        bareShare * Number(progress.completed ?? 0) / Math.max(1, Number(progress.total ?? 1)),
      ),
    }),
  })

  if (!hasGuys || !guys) {
    return immutablePublicResult({ result, guyedResult: null }, options)
  }

  options.onProgress?.({
    phase: 'guys',
    label: 'Нелинейный расчёт tension-only растяжек',
    fraction: bareShare,
  })
  const rawGuyedResult = calculateGuyedProject(input, guys.tiers, {
    ...immutableOptions,
    ...cancellationOptions,
    ...(guys.safetyFactor === undefined ? {} : { safetyFactor: guys.safetyFactor }),
    ...(guys.terminationEfficiency === undefined ? {} : { terminationEfficiency: guys.terminationEfficiency }),
  })
  const guyedResult = attachGuyedConnectionEnvelope(rawGuyedResult, result.parameters)
  options.onProgress?.({
    phase: 'guys',
    label: 'Расчёт растяжек и соединений завершён',
    fraction: 1,
  })
  return immutablePublicResult({ result, guyedResult }, options)
}
