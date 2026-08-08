import type { ProjectInput, ResolvedProject } from '../../domain/contracts.js'
import { resolveProjectInput, validateProjectInput } from '../../domain/index.js'
import { calculateGuyedMast } from '../../engineering/index.js'
import { augmentVerificationWithModuleChecks } from '../../structural-analysis/index.js'
import { calculateCompleteMastWithConfiguredJoint } from './complete-calculation.js'
import {
  selectUniformDiameter,
  STANDARD_DIAMETERS_MM,
  type SelectUniformDiameterOptions,
} from './optimize.js'
import { immutablePublicResult, type ImmutableResultOptions } from './immutability.js'
import { toApplicationError } from './errors.js'

type CalculatedProject = ReturnType<typeof calculateCompleteMastWithConfiguredJoint>
type CalculateOptions = NonNullable<Parameters<typeof calculateCompleteMastWithConfiguredJoint>[1]> & ImmutableResultOptions
type GuyedOptions = NonNullable<Parameters<typeof calculateGuyedMast>[2]> & ImmutableResultOptions

export interface OptimizeProjectOptions extends SelectUniformDiameterOptions, ImmutableResultOptions {
  diameters?: readonly number[]
}

function finalizedVerification(result: CalculatedProject): CalculatedProject {
  if (!result.verification) return result
  const verification = augmentVerificationWithModuleChecks(result.verification, result)
  return {
    ...result,
    verification,
    performance: result.performance
      ? {
        ...result.performance,
        verificationInternalCheckCount: verification.counts.internal,
      }
      : result.performance,
  }
}

function resolveValidatedProject(input: ProjectInput): ResolvedProject {
  return resolveProjectInput(validateProjectInput(input))
}

/**
 * Canonical headless project calculation entrypoint.
 * ProjectInput is validated and resolved exactly once at the application boundary.
 */
export function calculateProject(input: ProjectInput, options: CalculateOptions = {}) {
  try {
    const parameters = resolveValidatedProject(input)
    const calculated = calculateCompleteMastWithConfiguredJoint(parameters, {
      ...options,
      resolvedProject: parameters,
    })
    return immutablePublicResult(finalizedVerification(calculated), options)
  } catch (error) {
    throw toApplicationError(error)
  }
}

/** Headless uniform-diameter optimization over the same validated/resolved project contract. */
export function optimizeProject(input: ProjectInput, options: OptimizeProjectOptions = {}) {
  try {
    const parameters = resolveValidatedProject(input)
    const diameters = options.diameters ?? STANDARD_DIAMETERS_MM
    return immutablePublicResult(selectUniformDiameter(parameters, diameters, options), options)
  } catch (error) {
    throw toApplicationError(error)
  }
}

/** Headless guy-wire calculation. Browser forms, Worker transport and persistence remain outside this use case. */
export function calculateGuyedProject(
  input: ProjectInput,
  tiers: Parameters<typeof calculateGuyedMast>[1] = [],
  options: GuyedOptions = {},
) {
  try {
    const parameters = resolveValidatedProject(input)
    return immutablePublicResult(calculateGuyedMast(parameters, tiers, {
      ...options,
      resolvedProject: parameters,
    }), options)
  } catch (error) {
    throw toApplicationError(error)
  }
}

/** Build a verification passport from an already complete immutable result. */
export function createVerification(result: CalculatedProject) {
  if (!result.verification) throw toApplicationError(new Error('Для верификации требуется полный результат расчёта'))
  return immutablePublicResult(augmentVerificationWithModuleChecks(result.verification, result))
}
