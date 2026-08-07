import { calculateMast } from './calculate.js'
import { STANDARD_DIAMETERS_MM } from './catalog.js'

export { STANDARD_DIAMETERS_MM }

export function selectUniformDiameter(parameters, diameters = STANDARD_DIAMETERS_MM, options = {}) {
  const orderedDiameters = [...diameters].sort((left, right) => left - right)
  const variants = []
  const stopAtFirstPassing = options.stopAtFirstPassing ?? true

  for (let index = 0; index < orderedDiameters.length; index += 1) {
    const diameter = orderedDiameters[index]
    const result = calculateMast(
      { ...parameters, barDiameterMm: diameter },
      {
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
    const variant = { diameter, result, passesStrength, passesDisplacement, passesBuckling }
    variants.push(variant)
    options.onVariant?.({
      diameter,
      index: index + 1,
      total: orderedDiameters.length,
      passesStrength,
      passesDisplacement,
      passesBuckling,
    })

    // Диаметры проверяются по возрастанию. Как только первый кандидат проходит
    // все три ограничения, он уже является минимальным подходящим; расчёт более
    // крупных диаметров ничего не меняет в ответе и только тратит CPU.
    if (stopAtFirstPassing && passesStrength && passesDisplacement && passesBuckling) break
  }

  return {
    variants,
    recommended: variants.find((variant) => (
      variant.passesStrength && variant.passesDisplacement && variant.passesBuckling
    )) ?? null,
    evaluatedCount: variants.length,
    availableCount: orderedDiameters.length,
  }
}
