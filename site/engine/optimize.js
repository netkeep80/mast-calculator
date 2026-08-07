import { calculateMast } from './calculate.js'
import { STANDARD_DIAMETERS_MM } from './catalog.js'

export { STANDARD_DIAMETERS_MM }

function variantPasses(variant) {
  return variant.passesStrength
    && variant.passesDisplacement
    && variant.passesBuckling
    && variant.passesConnection
}

export function selectUniformDiameter(parameters, diameters = STANDARD_DIAMETERS_MM, options = {}) {
  const orderedDiameters = [...diameters].sort((left, right) => left - right)
  const variants = []
  const stopAtFirstPassing = options.stopAtFirstPassing ?? true
  // This API deliberately optimizes one uniform diameter. An explicit mixed
  // module profile belongs to the normal calculation path and must not shadow
  // the candidate diameter being evaluated here.
  const { moduleDiametersMm: _ignoredProfile, ...uniformParameters } = parameters

  for (let index = 0; index < orderedDiameters.length; index += 1) {
    const diameter = orderedDiameters[index]
    const result = calculateMast(
      { ...uniformParameters, barDiameterMm: diameter },
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
    const passesConnection = result.connections?.passes !== false
    const variant = {
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

    // Диаметры проверяются по возрастанию. В режиме auto каждый вариант уже
    // содержит собственную минимальную согласованную конфигурацию болта/гаек.
    // Первый вариант, проходящий каркас И соединение, является минимальным
    // пригодным комплектом и позволяет не считать более крупную арматуру.
    if (stopAtFirstPassing && variantPasses(variant)) break
  }

  return {
    variants,
    recommended: variants.find(variantPasses) ?? null,
    evaluatedCount: variants.length,
    availableCount: orderedDiameters.length,
  }
}
