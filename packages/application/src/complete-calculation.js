import { calculateAssemblyMass } from '../../design/index.js'
import { calculateCompleteMast } from './calculate.js'
import { calculateCraneBoomCapacity } from '../../engineering/index.js'
import { repairMixedDiameterVerificationPassport } from '../../engineering/index.js'

/**
 * Transitional complete-result assembler used by the canonical application use case.
 * Every enrichment returns a new value; the calculated base object is never mutated here.
 */
export function calculateCompleteMastWithConfiguredJoint(inputParameters, options = {}) {
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
