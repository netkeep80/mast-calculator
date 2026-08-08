import type { ResolvedProject } from '../../domain/contracts.js'
import {
  calculateConnectionChecks,
  calculateGuyedMast,
} from '../../engineering/index.js'

export const GUYED_CONNECTION_ENVELOPE_METHOD = 'fixed-selected-joint-guyed-connection-envelope-v1' as const

type GuyedResult = ReturnType<typeof calculateGuyedMast>

/**
 * Recheck one already-selected physical intermodule joint against every nonlinear
 * guyed frame case. The guy solver already exposes the canonical member-end
 * N/V/T/M actions, so this deliberately reuses the normal connection layer
 * instead of introducing a second bolt/weld model.
 */
export function attachGuyedConnectionEnvelope(
  guyedResult: GuyedResult,
  selectedProjectParameters: ResolvedProject,
) {
  const requestedMode = selectedProjectParameters.jointConfiguratorMode
  const fixedParameters: ResolvedProject = {
    ...selectedProjectParameters,
    jointConfiguratorMode: 'manual',
  }
  const connections = calculateConnectionChecks({
    parameters: fixedParameters,
    model: guyedResult.model,
    cases: guyedResult.cases,
  })
  const selectedBolt = connections.bolt.selected
  const criticalWeld = connections.weld.critical
  const structuralAndCablePasses = guyedResult.passes
  const connectionPasses = connections.passes

  const connectionEnvelope = {
    method: GUYED_CONNECTION_ENVELOPE_METHOD,
    physicalJointSource: 'bare-project-selected' as const,
    requestedMode,
    checkMode: 'manual' as const,
    caseCount: guyedResult.cases.length,
    capacityChecksUseFixedSelectedJoint: true as const,
    passes: connectionPasses,
    maximumBoltUtilization: selectedBolt.applicable ? selectedBolt.utilization : 0,
    governingBoltDemand: selectedBolt.governingDemand,
    governingBoltCheck: selectedBolt.governingCheck,
    criticalWeld,
    selectedJoint: {
      boltDiameterMm: fixedParameters.jointBoltDiameterMm,
      boltClass: fixedParameters.jointBoltClass,
      boltLengthMm: fixedParameters.jointBoltLengthMm,
      clearanceNutThreadMm: fixedParameters.jointClearanceNutThreadMm,
      threadEngagementFactor: fixedParameters.jointThreadEngagementFactor,
      effectiveRadiusMm: fixedParameters.jointEffectiveRadiusMm,
      weldConsumableId: fixedParameters.weldConsumableId,
      weldLegMm: fixedParameters.weldLegMm,
      weldSegmentsPerEnd: fixedParameters.weldSegmentsPerEnd,
    },
    scope: {
      checked: 'intermodule bolt/nuts and member-end welds from nonlinear guyed frame actions',
      excluded: 'local guy attachment bracket/eye, anchor, turnbuckle, thimble/clamps and soil capacity',
    },
  }

  const warnings = [...guyedResult.warnings]
  warnings.push('Межмодульные болт/гайки и сварные концы повторно проверены по N/V/T/M всей нелинейной guyed-огибающей с тем же физическим узлом, который выбран основным расчётом проекта. Местный узел крепления растяжки, анкер, талреп, коуш/зажимы и грунт остаются отдельными проверками.')
  if (!connectionPasses) {
    warnings.unshift('Нелинейная guyed-огибающая превышает несущую способность выбранного межмодульного соединения или его сварных концов.')
  }

  return {
    ...guyedResult,
    structuralAndCablePasses,
    connections: {
      ...connections,
      requestedMode,
      capacityChecksUseFixedSelectedJoint: true as const,
    },
    connectionEnvelope,
    passes: structuralAndCablePasses && connectionPasses,
    warnings,
  }
}
