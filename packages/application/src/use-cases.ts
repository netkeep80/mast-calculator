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

export interface ProjectJobProgress {
  readonly phase: string
  readonly label: string
  readonly fraction: number
}

export interface OptimizeAndCalculateProjectOptions extends ImmutableResultOptions {
  readonly diameters?: readonly number[]
  readonly optimizationShare?: number
  readonly onProgress?: (progress: ProjectJobProgress) => void
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

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number(value) || 0))

function normalizedJobProgress(
  progress: { phase: string; label: string; completed: number; total: number },
  start = 0,
  span = 1,
  prefix = '',
): ProjectJobProgress {
  const fraction = progress.completed / Math.max(1, progress.total)
  return {
    phase: progress.phase,
    label: prefix ? `${prefix}: ${progress.label}` : progress.label,
    fraction: clamp01(start + span * fraction),
  }
}

function buildOptimizationSummary(optimization: ReturnType<typeof selectUniformDiameter>) {
  return {
    recommendedDiameter: optimization.recommended?.diameter ?? null,
    evaluatedCount: optimization.evaluatedCount,
    availableCount: optimization.availableCount,
    variants: optimization.variants.map((variant) => ({
      diameter: variant.diameter,
      passesStrength: variant.passesStrength,
      passesDisplacement: variant.passesDisplacement,
      passesBuckling: variant.passesBuckling,
      passesConnection: variant.passesConnection,
      utilization: variant.result.envelope.maxUtilization,
      displacementMm: variant.result.envelope.maxTopDisplacementM * 1000,
      bucklingFactor: variant.result.envelope.minimumBucklingFactor,
      jointBoltDiameterMm: variant.result.connections?.configurator?.geometry?.bolt?.diameterMm ?? null,
      jointBoltClass: variant.result.connections?.configurator?.selected?.boltClass ?? null,
    })),
  }
}

/** Lightweight presentation-neutral query for forms that need canonical derived geometry. */
export function previewProjectGeometry(input: ProjectInput) {
  try {
    const parameters = resolveValidatedProject(input)
    return immutablePublicResult({
      moduleCount: parameters.moduleCount,
      ribCutLengthMm: parameters.ribCutLengthMm,
      moduleHeightMm: parameters.moduleHeightMm,
      mastHeightM: parameters.moduleCount * parameters.moduleHeightMm / 1000,
      barDiameterMm: parameters.barDiameterMm,
      reinforcementClass: parameters.reinforcementClass,
    })
  } catch (error) {
    throw toApplicationError(error)
  }
}

/**
 * Canonical headless project calculation entrypoint.
 * ProjectInput is validated and resolved exactly once at the application boundary.
 */
export function calculateProject(input: ProjectInput, options: CalculateOptions = {}) {
  try {
    const parameters = resolveValidatedProject(input)
    const calculated = calculateCompleteMastWithConfiguredJoint(parameters, options)
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

/**
 * Complete "optimize then calculate the selected project" job.
 * The application layer owns uniform-profile normalization, automatic joint mode,
 * candidate selection and the final recalculation so Worker/CLI/Desktop adapters
 * cannot accidentally implement different orchestration rules.
 */
export function optimizeAndCalculateProject(
  input: ProjectInput,
  options: OptimizeAndCalculateProjectOptions = {},
) {
  try {
    const optimizationShare = clamp01(options.optimizationShare ?? 0.78)
    const diameters = options.diameters ?? STANDARD_DIAMETERS_MM
    const { moduleDiametersMm: _ignoredMixedProfile, ...uniformGeometry } = input.geometry
    const automaticInput: ProjectInput = {
      ...input,
      geometry: uniformGeometry,
      connection: { ...input.connection, configuratorMode: 'auto' },
    }

    options.onProgress?.({
      phase: 'optimize',
      label: `Подбор арматуры и соединительного узла: до ${diameters.length} стандартных вариантов`,
      fraction: 0,
    })

    const optimization = optimizeProject(automaticInput, {
      diameters,
      stopAtFirstPassing: true,
      freezeResult: options.freezeResult,
      onProgress: (event) => options.onProgress?.({
        phase: 'optimize',
        label: `Подбор Ø${event.diameter} мм (${event.variantIndex + 1}/${event.variantCount}): ${event.inner.label}`,
        fraction: clamp01(optimizationShare * event.fraction),
      }),
    })
    const summary = buildOptimizationSummary(optimization)

    if (!optimization.recommended) {
      options.onProgress?.({
        phase: 'done',
        label: 'Подбор завершён: подходящий комплект арматуры и узла не найден',
        fraction: 1,
      })
      return immutablePublicResult({ result: null, optimization: summary }, options)
    }

    const diameter = optimization.recommended.diameter
    options.onProgress?.({
      phase: 'optimize',
      label: `Минимальный проходящий комплект найден после ${optimization.evaluatedCount} вариантов: арматура Ø${diameter} мм`,
      fraction: optimizationShare,
    })

    const selectedInput: ProjectInput = {
      ...automaticInput,
      geometry: { ...automaticInput.geometry, barDiameterMm: diameter },
    }
    const result = calculateProject(selectedInput, {
      freezeResult: options.freezeResult,
      onProgress: (progress) => options.onProgress?.(normalizedJobProgress(
        progress,
        optimizationShare,
        1 - optimizationShare,
        `Итоговый расчёт Ø${diameter} мм`,
      )),
    })
    const joint = result.connections?.configurator
    const jointLabel = joint?.geometry
      ? `; болт M${joint.geometry.bolt.diameterMm}×${joint.geometry.bolt.lengthMm} ${joint.selected.boltClass}`
      : ''
    options.onProgress?.({
      phase: 'done',
      label: `Подбор завершён: арматура Ø${diameter} мм${jointLabel}`,
      fraction: 1,
    })
    return immutablePublicResult({ result, optimization: summary }, options)
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
    return immutablePublicResult(calculateGuyedMast(parameters, tiers, options), options)
  } catch (error) {
    throw toApplicationError(error)
  }
}

/** Build a verification passport from an already complete immutable result. */
export function createVerification(result: CalculatedProject) {
  if (!result.verification) throw toApplicationError(new Error('Для верификации требуется полный результат расчёта'))
  return immutablePublicResult(augmentVerificationWithModuleChecks(result.verification, result))
}
