import type { ProjectErectionInput, ProjectInput } from '../../domain/contracts.js'
import {
  resolveProjectInput,
  validateProjectErectionInput,
  validateProjectInput,
} from '../../domain/index.js'
import {
  calculateErectionEnvelope,
  generateMastModel,
  resolveProjectErectionPath,
} from '../../structural-analysis/index.js'
import type { ApplicationAbortSignal } from './contracts.js'
import { throwIfApplicationAborted } from './cancellation.js'
import { toApplicationError } from './errors.js'
import { immutablePublicResult, type ImmutableResultOptions } from './immutability.js'

export interface CalculateProjectErectionOptions extends ImmutableResultOptions {
  readonly signal?: ApplicationAbortSignal
}

/**
 * Canonical headless application boundary for the optional erection stage.
 * Operational CalculationResult remains a separate sibling stage and is never
 * mutated with temporary erection state.
 */
export function calculateProjectErection(
  project: ProjectInput,
  erection: ProjectErectionInput | null | undefined,
  options: CalculateProjectErectionOptions = {},
) {
  try {
    throwIfApplicationAborted(options.signal)
    const validatedErection = validateProjectErectionInput(erection ?? undefined)
    if (!validatedErection || validatedErection.mode === 'disabled') return null

    const parameters = resolveProjectInput(validateProjectInput(project))
    const model = generateMastModel(parameters)
    const resolved = resolveProjectErectionPath(model, validatedErection)
    const envelope = calculateErectionEnvelope(model, parameters, resolved.path, resolved.options)
    throwIfApplicationAborted(options.signal)

    return immutablePublicResult({
      configuration: validatedErection,
      topology: resolved.topology,
      envelope,
    }, options)
  } catch (error) {
    throw toApplicationError(error)
  }
}
