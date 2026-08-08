import type { ResolvedProject } from '../../domain/contracts.js'
import { STANDARD_DIAMETERS_MM } from '../../domain/index.js'
import { calculateMast, type CalculationProgressEvent } from './calculate.js'

export { STANDARD_DIAMETERS_MM }

type MastResult = ReturnType<typeof calculateMast>

interface OptimizationVariant {
  diameter: number
  result: MastResult
  passesStrength: boolean
  passesDisplacement: boolean
  passesBuckling: boolean
  passesConnection: boolean
}

export interface OptimizationProgress {
  phase: 'variant'
  diameter: number
  variantIndex: number
  variantCount: number
  inner: CalculationProgressEvent
  fraction: number
}

export interface VariantSummary {
  diameter: number
  index: number
  total: number
  passesStrength: boolean
  passesDisplacement: boolean
  passesBuckling: boolean
  passesConnection: boolean
}

export interface SelectUniformDiameterOptions {
  stopAtFirstPassing?: boolean
  onProgress?: (event: OptimizationProgress) => void
  onVariant?: (event: VariantSummary) => void
  resolvedProject?: ResolvedProject
}

function variantPasses(variant: OptimizationVariant): boolean {
  return variant.passesStrength
    && variant.passesDisplacement
    && variant.passesBuckling
    && variant.passesConnection
}

export function selectUniformDiameter(
  parameters: ResolvedProject,
  diameters: readonly number[] = STANDARD_DIAMETERS_MM,
  options: SelectUniformDiameterOptions = {},
) {
  const orderedDiameters = [...diameters].sort((left, right) => left - right)
  const variants: OptimizationVariant[] = []
  const stopAtFirstPassing = options.stopAtFirstPassing ?? true
  // This API deliberately optimizes one uniform diameter. An explicit mixed
  // module profile belongs to the normal calculation path and must not shadow
  // the candidate diameter being evaluated here.
  const { moduleDiametersMm: _ignoredProfile, ...uniformParameters } = parameters

  for (let index = 0; index < orderedDiameters.length; index += 1) {
    const diameter = orderedDiameters[index]!
    const variantParameters: ResolvedProject = { ...uniformParameters, barDiameterMm: diameter }
    const result = calculateMast(
      variantParameters as unknown as Record<string, unknown>,
      {
        resolvedProject: variantParameters,
        onProgress: (event) => options.onProgress?.({
          phase: 'variant',
          diameter,
          variantIndex: index,
          variantCount: orderedDiameters.length,
          inner: event,
          fraction: (index + event.completed / Math.max(1, event.total)) / orderedDiameters.length,
        }),
      },
    )
    const passesStrength = result.envelope.maxUtilization <= 1
    const passesDisplacement = result.envelope.maxTopDisplacementM * 1000 <= parameters.displacementLimitMm
    const passesBuckling = result.envelope.minimumBucklingFactor >= parameters.minimumBucklingFactor
    const passesConnection = result.connections?.passes !== false
    const variant: OptimizationVariant = {
      diameter,
      result,
      passesStrength,
      passesDisplacement,
      passesBuckling,
      passesConnection,
    }
    variants.push(variant)
    options.onVariant?.({
      diameter,
      index: index + 1,
      total: orderedDiameters.length,
      passesStrength,
      passesDisplacement,
      passesBuckling,
      passesConnection,
    })

    if (stopAtFirstPassing && variantPasses(variant)) break
  }

  return {
    variants,
    recommended: variants.find(variantPasses) ?? null,
    evaluatedCount: variants.length,
    availableCount: orderedDiameters.length,
  }
}
