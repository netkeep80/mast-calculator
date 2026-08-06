import { calculateMast } from './calculate.js'

export const STANDARD_DIAMETERS_MM = Object.freeze([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40])

export function selectUniformDiameter(parameters, diameters = STANDARD_DIAMETERS_MM) {
  const variants = []
  for (const diameter of diameters) {
    const result = calculateMast({ ...parameters, barDiameterMm: diameter })
    const passesStrength = result.envelope.maxUtilization <= 1
    const passesDisplacement = result.envelope.maxTopDisplacementM * 1000 <= parameters.displacementLimitMm
    const passesBuckling = result.envelope.minimumBucklingFactor >= parameters.minimumBucklingFactor
    variants.push({ diameter, result, passesStrength, passesDisplacement, passesBuckling })
  }

  return {
    variants,
    recommended: variants.find((variant) => (
      variant.passesStrength && variant.passesDisplacement && variant.passesBuckling
    )) ?? null,
  }
}
