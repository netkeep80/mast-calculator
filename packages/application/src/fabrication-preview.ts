import type { ProjectInput } from '../../domain/contracts.js'
import { resolveProjectInput, validateProjectInput } from '../../domain/index.js'
import { reinforcementMassPerMeterKg } from '../../design/index.js'
import { toApplicationError } from './errors.js'
import { immutablePublicResult } from './immutability.js'

/** Presentation-neutral fabrication preview shared by browser/CLI/Desktop adapters. */
export function previewRibFabrication(input: ProjectInput) {
  try {
    const parameters = resolveProjectInput(validateProjectInput(input))
    const massPerMeterKg = reinforcementMassPerMeterKg(parameters.barDiameterMm, parameters.densityKgM3)
    const ribLengthM = parameters.ribCutLengthMm / 1000
    return immutablePublicResult({
      diameterMm: parameters.barDiameterMm,
      ribCutLengthMm: parameters.ribCutLengthMm,
      ribLengthM,
      massPerMeterKg,
      ribMassKg: massPerMeterKg * ribLengthM,
      densityKgM3: parameters.densityKgM3,
    })
  } catch (error) {
    throw toApplicationError(error)
  }
}
