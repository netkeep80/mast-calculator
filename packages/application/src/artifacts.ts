import {
  buildDesignPackage,
  type DesignPackageMetadata,
} from '../../design/index.js'
import { toApplicationError } from './errors.js'
import { immutablePublicResult } from './immutability.js'
import type { calculateCompleteMastWithConfiguredJoint } from './complete-calculation.js'

type CalculatedProject = ReturnType<typeof calculateCompleteMastWithConfiguredJoint>

/** Build the versioned design-workspace package without any browser persistence dependency. */
export function createDesignPackage(
  result: CalculatedProject,
  metadata: DesignPackageMetadata = {},
) {
  try {
    return immutablePublicResult(buildDesignPackage(result, metadata))
  } catch (error) {
    throw toApplicationError(error)
  }
}
