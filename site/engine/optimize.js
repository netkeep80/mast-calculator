import { calculateMast } from './calculate.js'

export const STANDARD_DIAMETERS_MM = Object.freeze([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40])

export function selectUniformDiameter(parameters, diameters = STANDARD_DIAMETERS_MM) {
  const variants = []
  for (const diameter of diameters) {
    const result = calculateMast({ ...parameters, barDiameterMm: diameter })
    const passesStrength = result.analysis.maxUtilization <= 1
    const passesDisplacement = result.analysis.maxTopDisplacementM * 1000 <= parameters.displacementLimitMm
    variants.push({ diameter, result, passesStrength, passesDisplacement })
  }

  return {
    variants,
    recommended: variants.find((variant) => variant.passesStrength && variant.passesDisplacement) ?? null,
  }
}
