import { calculateCompleteMast } from './calculate.js'

// Public compatibility name introduced with prototype 1.2. The canonical
// implementation now lives directly in calculate.js so every caller — UI,
// tests, performance regression and API consumers — gets exactly the same
// fixed-physical-joint semantics.
export function calculateCompleteMastWithConfiguredJoint(inputParameters, options = {}) {
  return calculateCompleteMast(inputParameters, options)
}
