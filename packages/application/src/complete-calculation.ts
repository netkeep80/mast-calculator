import { calculateAssemblyMass } from '../../design/index.js'
import {
  calculateCraneBoomCapacity,
  repairMixedDiameterVerificationPassport,
} from '../../engineering/index.js'
import { calculateCompleteMast } from './calculate.js'

/**
 * Complete-result assembler used by the canonical application use case.
 * Every enrichment returns a new value; the calculated base object is never mutated here.
 */
export function calculateCompleteMastWithConfiguredJoint(
  inputParameters: Parameters<typeof calculateCompleteMast>[0],
  options: Parameters<typeof calculateCompleteMast>[1] = {},
) {
  const calculated = calculateCompleteMast(inputParameters, options)
  const verification = repairMixedDiameterVerificationPassport(calculated.verification, calculated)
  const withVerification = { ...calculated, verification }
  const assemblyMass = calculateAssemblyMass(withVerification)
  const craneBoomCapacity = calculateCraneBoomCapacity(calculated.model, calculated.parameters, {
    stepDeg: calculated.parameters.lateralCapacityStepDeg,
  })
  return {
    ...calculated,
    verification,
    assemblyMass,
    craneBoomCapacity,
  }
}
