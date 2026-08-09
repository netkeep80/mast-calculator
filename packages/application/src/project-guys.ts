import type { ProjectGuysInput, ProjectInput, ResolvedProject } from '../../domain/contracts.js'
import type { ApplicationAbortSignal } from './contracts.js'
import { attachGuyedConnectionEnvelope } from './guyed-connection-envelope.js'
import { immutablePublicResult, type ImmutableResultOptions } from './immutability.js'
import { calculateGuyedProject } from './use-cases.js'

export interface CalculateProjectGuysOptions extends ImmutableResultOptions {
  readonly signal?: ApplicationAbortSignal
}

export interface OperationalParametersSource {
  readonly parameters: ResolvedProject
}

/** Calculates only the optional guy stage against one already completed operational result. */
export function calculateProjectGuys(
  input: ProjectInput,
  guys: ProjectGuysInput | null | undefined,
  operationalResult: OperationalParametersSource,
  options: CalculateProjectGuysOptions = {},
) {
  if (!guys?.tiers?.length) return null
  const raw = calculateGuyedProject(input, guys.tiers, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(guys.safetyFactor === undefined ? {} : { safetyFactor: guys.safetyFactor }),
    ...(guys.terminationEfficiency === undefined ? {} : { terminationEfficiency: guys.terminationEfficiency }),
  })
  return immutablePublicResult(
    attachGuyedConnectionEnvelope(raw, operationalResult.parameters),
    options,
  )
}
