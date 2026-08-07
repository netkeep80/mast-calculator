import { calculateMast } from './calculate.js'
import { STANDARD_DIAMETERS_MM } from './catalog.js'

export { STANDARD_DIAMETERS_MM }

export function selectUniformDiameter(parameters, diameters = STANDARD_DIAMETERS_MM, options = {}) {
  const variants = []
  for (let index = 0; index < diameters.length; index += 1) {
    const diameter = diameters[index]
    const result = calculateMast(
      { ...parameters, barDiameterMm: diameter },
      {
        onProgress: (event) => options.onProgress?.({
          phase: 'variant',
          diameter,
          variantIndex: index,
          variantCount: diameters.length,
          inner: event,
          fraction: (index + event.completed / Math.max(1, event.total)) / diameters.length,
        }),
      },
    )
    const passesStrength = result.envelope.maxUtilization <= 1
    const passesDisplacement = result.envelope.maxTopDisplacementM * 1000 <= parameters.displacementLimitMm
    const passesBuckling = result.envelope.minimumBucklingFactor >= parameters.minimumBucklingFactor
    variants.push({ diameter, result, passesStrength, passesDisplacement, passesBuckling })
    options.onVariant?.({
      diameter,
      index: index + 1,
      total: diameters.length,
      passesStrength,
      passesDisplacement,
      passesBuckling,
    })
  }

  return {
    variants,
    recommended: variants.find((variant) => (
      variant.passesStrength && variant.passesDisplacement && variant.passesBuckling
    )) ?? null,
  }
}
