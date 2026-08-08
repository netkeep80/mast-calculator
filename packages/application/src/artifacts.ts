import {
  buildDesignPackage,
  type DesignPackageMetadata,
} from '../../design/index.js'
import {
  createCalculationCsv,
  createCalculationProjectHtml,
} from '../../reporting/index.js'
import { toApplicationError } from './errors.js'
import { immutablePublicResult } from './immutability.js'
import type { calculateCompleteMastWithConfiguredJoint } from './complete-calculation.js'

type CalculatedProject = ReturnType<typeof calculateCompleteMastWithConfiguredJoint>
type ReportingBuildInfo = NonNullable<Parameters<typeof createCalculationProjectHtml>[3]>

export interface TextArtifact {
  readonly mediaType: string
  readonly content: string
}

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

/** Build the calculation project HTML; browser/CLI/Desktop adapters decide where it is stored. */
export function createCalculationProjectArtifact(
  result: CalculatedProject,
  generatedAt = new Date().toISOString(),
  buildInfo: ReportingBuildInfo = {},
): Readonly<TextArtifact> {
  try {
    return immutablePublicResult({
      mediaType: 'text/html;charset=utf-8',
      content: createCalculationProjectHtml(result, result.parameters, generatedAt, buildInfo),
    })
  } catch (error) {
    throw toApplicationError(error)
  }
}

/** Build the member-envelope CSV; download/file-system mechanics stay in the adapter. */
export function createCalculationCsvArtifact(result: CalculatedProject): Readonly<TextArtifact> {
  try {
    return immutablePublicResult({
      mediaType: 'text/csv;charset=utf-8',
      content: createCalculationCsv(result),
    })
  } catch (error) {
    throw toApplicationError(error)
  }
}
