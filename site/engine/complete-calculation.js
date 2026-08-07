import { calculateAssemblyMass } from './assembly-mass.js'
import { calculateCompleteMast } from './calculate.js'

// Public compatibility name introduced with prototype 1.2. The canonical FEM
// implementation remains in calculate.js. Prototype 1.3 enriches the complete
// user-facing result with a fabrication mass estimate after all connection and
// weld demands are known; this does not create a second FEM calculation path.
export function calculateCompleteMastWithConfiguredJoint(inputParameters, options = {}) {
  const result = calculateCompleteMast(inputParameters, options)
  result.assemblyMass = calculateAssemblyMass(result)
  return result
}
