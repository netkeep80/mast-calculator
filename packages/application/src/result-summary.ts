import type { ProjectPackageV1 } from '../../domain/contracts.js'
import type {
  calculateGuyedProject,
  calculateProject,
  optimizeAndCalculateProject,
} from './use-cases.js'
import { immutablePublicResult } from './immutability.js'

export const RESULT_SUMMARY_SCHEMA = 'mast-calculator/result-summary/v1' as const

export interface ResultSummaryProvenance {
  readonly toolVersion: string
  readonly coreVersion: string
  readonly command: string
  readonly generatedAt?: string
  readonly gitSha?: string
  readonly gitRef?: string
  readonly runId?: string
}

export interface ResultSummaryOptions {
  readonly provenance: ResultSummaryProvenance
  readonly optimization?: ReturnType<typeof optimizeAndCalculateProject>['optimization'] | null
}

type BareResult = ReturnType<typeof calculateProject>
type GuyedResult = ReturnType<typeof calculateGuyedProject>
type OptimizationJob = ReturnType<typeof optimizeAndCalculateProject>

function sourceSummary(projectPackage: ProjectPackageV1, provenance: ResultSummaryProvenance) {
  return {
    inputSchema: projectPackage.schema,
    metadata: projectPackage.metadata ?? null,
    project: projectPackage.project,
    guys: projectPackage.guys ?? null,
    provenance: {
      toolVersion: provenance.toolVersion,
      coreVersion: provenance.coreVersion,
      command: provenance.command,
      ...(provenance.generatedAt === undefined ? {} : { generatedAt: provenance.generatedAt }),
      ...(provenance.gitSha === undefined ? {} : { gitSha: provenance.gitSha }),
      ...(provenance.gitRef === undefined ? {} : { gitRef: provenance.gitRef }),
      ...(provenance.runId === undefined ? {} : { runId: provenance.runId }),
    },
  }
}

function optimizationSummary(optimization: ResultSummaryOptions['optimization']) {
  if (!optimization) return null
  return {
    recommendedDiameterMm: optimization.recommendedDiameter,
    evaluatedCount: optimization.evaluatedCount,
    availableCount: optimization.availableCount,
    variants: optimization.variants.map((variant) => ({ ...variant })),
  }
}

function connectionSummary(result: BareResult) {
  const configurator = result.connections?.configurator
  const geometry = configurator?.geometry
  const selected = result.connections?.bolt?.selected
  const criticalWeld = result.connections?.weld?.critical?.check
  return {
    passes: result.connections?.passes !== false,
    mode: configurator?.mode ?? result.parameters.jointConfiguratorMode,
    bolt: geometry ? {
      diameterMm: geometry.bolt.diameterMm,
      lengthMm: geometry.bolt.lengthMm,
      propertyClass: configurator?.selected?.boltClass ?? result.parameters.jointBoltClass,
      utilization: selected?.utilization ?? null,
    } : null,
    clearanceNutThreadMm: geometry?.bottomClearanceNut.threadDiameterMm ?? null,
    weldRequiredPhysicalLengthMm: criticalWeld?.requiredPhysicalLengthMm ?? null,
  }
}

function commonGeometry(parameters: BareResult['parameters'] | GuyedResult['parameters']) {
  return {
    moduleCount: parameters.moduleCount,
    moduleHeightMm: parameters.moduleHeightMm,
    mastHeightM: parameters.moduleCount * parameters.moduleHeightMm / 1000,
    barDiameterMm: parameters.barDiameterMm,
    moduleDiametersMm: parameters.moduleDiametersMm ?? null,
    reinforcementClass: parameters.reinforcementClass,
    ribCutLengthMm: parameters.ribCutLengthMm,
  }
}

function bareResultPayload(result: BareResult) {
  return {
    passes: result.envelope.maxUtilization <= 1
      && result.envelope.maxTopDisplacementM * 1000 <= result.parameters.displacementLimitMm
      && result.envelope.minimumBucklingFactor >= result.parameters.minimumBucklingFactor
      && result.connections?.passes !== false,
    geometry: commonGeometry(result.parameters),
    response: {
      maxUtilization: result.envelope.maxUtilization,
      topDisplacementMm: result.envelope.maxTopDisplacementM * 1000,
      minimumBucklingFactor: result.envelope.minimumBucklingFactor,
      governingWindDirectionDeg: result.envelope.governing.windDirectionDeg,
    },
    connection: connectionSummary(result),
    capacities: {
      lateralCriticalForceKgf: result.lateralCapacity?.criticalForceKgf ?? null,
      staticMaximumTopMassKg: result.staticPayloadCapacity?.maximumTopEquipmentMassKg ?? null,
      heightDesignMaximumM: result.heightCapacity?.design?.maximumHeightM ?? null,
      heightDesignMaximumModules: result.heightCapacity?.design?.maximumModules ?? null,
      craneMaximumEndPayloadMassKg: result.craneBoomCapacity?.maximumEndPayloadMassKg ?? null,
    },
    verification: result.verification ? {
      status: result.verification.status,
      counts: { ...result.verification.counts },
    } : null,
    warnings: [...result.warnings],
  }
}

/** Stable machine-readable summary for a normal application calculation. */
export function createBareResultSummary(
  projectPackage: ProjectPackageV1,
  result: BareResult,
  options: ResultSummaryOptions,
) {
  return immutablePublicResult({
    schema: RESULT_SUMMARY_SCHEMA,
    mode: 'bare' as const,
    ...sourceSummary(projectPackage, options.provenance),
    result: bareResultPayload(result),
    optimization: optimizationSummary(options.optimization),
  })
}

/** Stable machine-readable summary for a guy-wire application calculation. */
export function createGuyedResultSummary(
  projectPackage: ProjectPackageV1,
  result: GuyedResult,
  options: ResultSummaryOptions,
) {
  return immutablePublicResult({
    schema: RESULT_SUMMARY_SCHEMA,
    mode: 'guyed' as const,
    ...sourceSummary(projectPackage, options.provenance),
    result: {
      passes: result.passes,
      geometry: commonGeometry(result.parameters),
      response: {
        maxUtilization: result.envelope.maxUtilization,
        topDisplacementMm: result.envelope.maxTopDisplacementM * 1000,
        minimumBucklingFactor: result.envelope.minimumBucklingFactor,
        maximumCableUtilization: result.envelope.maximumCableUtilization,
        governingWindDirectionDeg: result.envelope.governing.windDirectionDeg,
      },
      guys: {
        cableCount: result.cableSystem.cables.length,
        totalCableLengthM: result.cableSystem.totalCableLengthM,
        totalCableMassKg: result.cableSystem.totalCableMassKg,
        maximumCableUtilization: result.envelope.maximumCableUtilization,
        slackCableCount: result.envelope.governing.slackCableCount,
      },
      warnings: [...result.warnings],
    },
    optimization: optimizationSummary(options.optimization),
  })
}

/** Stable machine-readable summary for optimize, including the no-recommendation case. */
export function createOptimizationResultSummary(
  projectPackage: ProjectPackageV1,
  output: OptimizationJob,
  options: Omit<ResultSummaryOptions, 'optimization'>,
) {
  return immutablePublicResult({
    schema: RESULT_SUMMARY_SCHEMA,
    mode: 'optimization' as const,
    ...sourceSummary(projectPackage, options.provenance),
    effectiveProject: output.projectInput,
    result: output.result ? bareResultPayload(output.result) : null,
    optimization: optimizationSummary(output.optimization),
  })
}
