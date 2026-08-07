import { resolveCalculationParameters } from '../../domain/index.js'
import { calculateGuyedMast, augmentVerificationWithModuleChecks } from '../../structural-analysis/index.js'
import { calculateCompleteMastWithConfiguredJoint } from './complete-calculation.js'
import { selectUniformDiameter, STANDARD_DIAMETERS_MM } from './optimize.js'

function finalizeVerification(result) {
  if (!result?.verification) return result
  result.verification = augmentVerificationWithModuleChecks(result.verification, result)
  if (result.performance) {
    result.performance.verificationInternalCheckCount = result.verification.counts.internal
  }
  return result
}

/**
 * Canonical headless project calculation entrypoint.
 * Environment adapters may provide progress callbacks but do not own result enrichment.
 */
export function calculateProject(input, options = {}) {
  return finalizeVerification(calculateCompleteMastWithConfiguredJoint(input, options))
}

/**
 * Headless uniform-diameter optimization. The returned candidate results use the
 * same engineering core; a consumer may call calculateProject for the chosen project.
 */
export function optimizeProject(input, options = {}) {
  const parameters = resolveCalculationParameters(input)
  const diameters = options.diameters ?? STANDARD_DIAMETERS_MM
  return selectUniformDiameter(parameters, diameters, options)
}

/**
 * Headless guy-wire calculation. Browser forms, Worker transport and persistence
 * remain outside this use case.
 */
export function calculateGuyedProject(input, tiers = [], options = {}) {
  return calculateGuyedMast(input, tiers, options)
}

/**
 * Build the complete verification passport expected by application consumers
 * from an already calculated result without depending on a browser transport.
 */
export function createVerification(result) {
  if (!result?.verification) throw new Error('Для верификации требуется полный результат расчёта')
  return augmentVerificationWithModuleChecks(result.verification, result)
}
