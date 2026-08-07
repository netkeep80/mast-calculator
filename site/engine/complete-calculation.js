import { calculateAssemblyMass } from './assembly-mass.js'
import { calculateCompleteMast } from './calculate.js'
import { calculateCraneBoomCapacity } from './crane-boom-capacity.js'
import { repairMixedDiameterVerificationPassport } from './mixed-diameter-verification.js'

// Public compatibility name introduced with prototype 1.2. The canonical FEM
// implementation remains in calculate.js. Prototype 1.4 enriches the complete
// user-facing result with fabrication mass and a separate horizontal-boom
// capacity. Both reuse the same physical frame model and the fixed joint selected
// by calculateCompleteMast; they do not create a competing production FEM path.
export function calculateCompleteMastWithConfiguredJoint(inputParameters, options = {}) {
  const result = calculateCompleteMast(inputParameters, options)
  repairMixedDiameterVerificationPassport(result.verification, result)
  result.assemblyMass = calculateAssemblyMass(result)
  result.craneBoomCapacity = calculateCraneBoomCapacity(result.model, result.parameters, {
    stepDeg: result.parameters.lateralCapacityStepDeg,
  })
  return result
}
