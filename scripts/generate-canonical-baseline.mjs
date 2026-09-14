import { calculateMast } from '../packages/application/index.js'
import { calculateCompleteMastWithConfiguredJoint } from '../packages/application/index.js'
import { calculateGuyedMast } from '../packages/engineering/index.js'
import {
  buildDesignPackage,
  designResultFromPackage,
  parseDesignPackage,
  serializeDesignPackage,
} from '../packages/design/index.js'
import { buildDetailedMastModel } from '../packages/design/index.js'
import { createMastObj } from '../packages/design/index.js'
import { resolvedProject } from '../tests/helpers/resolved-project.js'
import {
  CANONICAL_SCENARIO_SCHEMA,
  CANONICAL_SCENARIOS,
} from '../tests/fixtures/canonical/scenarios-v1.js'

const BASELINE_SCHEMA = 'mast-calculator/canonical-baseline/v2'

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null

function numericChecksum(values) {
  const numbers = values.map(Number).filter(Number.isFinite)
  return {
    count: numbers.length,
    sum: numbers.reduce((sum, value) => sum + value, 0),
    weightedSum: numbers.reduce((sum, value, index) => sum + value * (index + 1), 0),
    absoluteSum: numbers.reduce((sum, value) => sum + Math.abs(value), 0),
    maxAbs: numbers.reduce((best, value) => Math.max(best, Math.abs(value)), 0),
  }
}

function dofVector(analysis) {
  return analysis.displacements.flatMap((displacement, nodeId) => [
    ...displacement,
    ...(analysis.rotations?.[nodeId] ?? [0, 0, 0]),
  ])
}

function baseReactionVector(result, analysis) {
  return result.model.baseNodeIds.flatMap((nodeId) => [
    ...(analysis.reactions?.[nodeId] ?? [0, 0, 0]),
    ...(analysis.reactionMoments?.[nodeId] ?? [0, 0, 0]),
  ])
}

function criticalMember(analysis) {
  if (!analysis?.memberResults?.length) return null
  return analysis.memberResults.reduce((best, member) => (
    Number(member.utilization ?? 0) > Number(best.utilization ?? 0) ? member : best
  ), analysis.memberResults[0])
}

function projectMast(result) {
  const analysis = result.envelope?.governing?.analysis ?? result.analysis
  const dofs = dofVector(analysis)
  const reactions = baseReactionVector(result, analysis)
  const member = criticalMember(analysis)
  const selected = result.connections?.configurator?.selected
  const geometry = result.connections?.configurator?.geometry
  return {
    topology: {
      modules: result.model.moduleCount,
      nodes: result.model.nodes.length,
      members: result.model.members.length,
      baseNodes: result.model.baseNodeIds.length,
      topNodes: result.model.topNodeIds.length,
      moduleDiametersMm: result.model.moduleDiametersMm ?? null,
    },
    loads: {
      selfWeightN: finite(result.loads?.selfWeightN),
      iceWeightN: finite(result.loads?.iceWeightN),
      totalAppliedLoadN: result.loads?.totalAppliedLoad?.map(finite) ?? null,
    },
    state: {
      dofChecksum: numericChecksum(dofs),
      baseReactionChecksum: numericChecksum(reactions),
      topDisplacementM: finite(result.envelope?.maxTopDisplacementM),
      maxUtilization: finite(result.envelope?.maxUtilization),
      minimumBucklingFactor: finite(result.envelope?.minimumBucklingFactor),
      eigenResidual: finite(analysis?.buckling?.eigenResidual),
      globalSchurRelativeDifference: finite(analysis?.modular?.relativeDisplacementDifference),
      interfaceEquilibriumResidual: finite(analysis?.modular?.interfaceEquilibriumResidual),
    },
    criticalMember: member ? {
      memberId: member.memberId,
      utilization: finite(member.utilization),
      localEndForcesChecksum: numericChecksum(member.localEndForces ?? []),
    } : null,
    connection: {
      jointCount: result.connections?.jointCount ?? 0,
      boltClass: selected?.boltClass ?? null,
      boltDiameterMm: geometry?.bolt?.diameterMm ?? null,
      boltLengthMm: geometry?.bolt?.lengthMm ?? null,
      boltUtilization: finite(result.connections?.bolt?.selected?.utilization ?? 0),
      criticalWeldLengthMm: finite(result.connections?.weld?.critical?.check?.requiredPhysicalLengthMm),
    },
  }
}

function projectGuys(result) {
  return {
    topology: {
      modules: result.model.moduleCount,
      members: result.model.members.length,
      tiers: result.cableSystem.tiers.length,
      cables: result.cableSystem.cables.length,
    },
    envelope: {
      topDisplacementM: finite(result.envelope.maxTopDisplacementM),
      maxUtilization: finite(result.envelope.maxUtilization),
      minimumBucklingFactor: finite(result.envelope.minimumBucklingFactor),
      maximumCableUtilization: finite(result.envelope.maximumCableUtilization),
    },
    cables: {
      totalLengthM: finite(result.cableSystem.totalLengthM),
      totalMassKg: finite(result.cableSystem.totalMassKg),
      tensionChecksum: numericChecksum(result.envelope.governing?.cableTensionsN ?? []),
    },
    nonlinear: {
      allConverged: result.envelope.cases.every((item) => item.converged),
      maximumIterations: Math.max(...result.envelope.cases.map((item) => item.iterations)),
    },
  }
}

function projectStaticPayload(result) {
  return {
    maximumTopMassKg: finite(result.maximumTopEquipmentMassKg),
    additionalTopMassKg: finite(result.additionalTopEquipmentMassKg),
    utilizationAtLimit: finite(result.utilizationAtLimit),
    boltUtilizationAtLimit: finite(result.boltUtilizationAtLimit),
    bucklingFactorAtLimit: finite(result.bucklingFactorAtLimit),
    governingMode: result.governingMode,
  }
}

function projectLateral(result) {
  return {
    criticalForceN: finite(result.criticalForceN),
    memberLimitForceN: finite(result.memberLimitForceN),
    globalBucklingForceN: finite(result.globalBucklingForceN),
    boltLimitForceN: finite(result.boltLimitForceN),
    governingMode: result.governingMode,
    directionDeg: finite(result.directionDeg),
  }
}

function projectCraneBoom(result) {
  return {
    maximumEndPayloadMassKg: finite(result.maximumEndPayloadMassKg),
    additionalEndPayloadMassKg: finite(result.additionalEndPayloadMassKg),
    configuredEndPayloadMassKg: finite(result.configuredEndPayloadMassKg),
    boomSelfWeightN: finite(result.boomSelfWeightN),
    boomSelfMassEquivalentKg: finite(result.boomSelfMassEquivalentKg),
    governingMode: result.governingMode,
    governingDirectionDeg: finite(result.governingDirectionDeg),
  }
}

function projectHeight(result) {
  return {
    designMaximumModules: result.designMaximumModules,
    designFirstFailModules: result.designFirstFailModules,
    ultimateMaximumModules: result.ultimateMaximumModules,
    ultimateFirstFailModules: result.ultimateFirstFailModules,
    evaluationCount: result.evaluationCount,
  }
}

function projectDesignRoundTrip(result) {
  const packageValue = buildDesignPackage(result, {
    createdAt: '2026-08-08T12:00:00.000Z',
    repository: 'netkeep80/mast-calculator',
    ref: 'canonical-baseline',
    sha: 'canonical-baseline',
  })
  const serialized = serializeDesignPackage(packageValue)
  const parsed = parseDesignPackage(serialized)
  const restored = designResultFromPackage(parsed)
  const mesh = buildDetailedMastModel(restored)
  const obj = createMastObj(restored)
  const lines = obj.split('\n')
  return {
    schema: parsed.schema,
    serializedBytes: Buffer.byteLength(serialized),
    model: {
      modules: restored.model.moduleCount,
      nodes: restored.model.nodes.length,
      members: restored.model.members.length,
    },
    mesh: {
      structuralMembers: mesh.structuralMembers.length,
      hardwareObjects: mesh.hardware.length,
    },
    obj: {
      bytes: Buffer.byteLength(obj),
      vertexLines: lines.filter((line) => line.startsWith('v ')).length,
      faceLines: lines.filter((line) => line.startsWith('f ')).length,
      hasStructuralGroup: lines.some((line) => line.startsWith('g structural-')),
      hasJointHardwareGroup: lines.some((line) => line.startsWith('g joint-')),
    },
  }
}

const baseline = {
  schema: BASELINE_SCHEMA,
  scenariosSchema: CANONICAL_SCENARIO_SCHEMA,
  cases: {},
}

for (const scenario of CANONICAL_SCENARIOS) {
  if (scenario.kind === 'performance-owner') {
    baseline.cases[scenario.id] = {
      ownerTest: scenario.ownerTest,
      topology: scenario.topology,
    }
    continue
  }

  if (scenario.kind === 'mast') {
    const parameters = resolvedProject(scenario.parameters)
    baseline.cases[scenario.id] = projectMast(calculateCompleteMastWithConfiguredJoint(parameters))
    continue
  }

  if (scenario.kind === 'guyed') {
    const parameters = resolvedProject(scenario.parameters)
    baseline.cases[scenario.id] = projectGuys(calculateGuyedMast(parameters, scenario.guys))
    continue
  }

  if (scenario.kind === 'static-payload') {
    const parameters = resolvedProject(scenario.parameters)
    baseline.cases[scenario.id] = projectStaticPayload(calculateMast(parameters).staticPayloadCapacity)
    continue
  }

  if (scenario.kind === 'lateral-capacity') {
    const parameters = resolvedProject(scenario.parameters)
    baseline.cases[scenario.id] = projectLateral(calculateMast(parameters).lateralCapacity)
    continue
  }

  if (scenario.kind === 'crane-boom') {
    const parameters = resolvedProject(scenario.parameters)
    baseline.cases[scenario.id] = projectCraneBoom(calculateMast(parameters).craneBoomCapacity)
    continue
  }

  if (scenario.kind === 'height-search') {
    const parameters = resolvedProject(scenario.parameters)
    baseline.cases[scenario.id] = projectHeight(calculateMast(parameters).heightCapacity)
    continue
  }

  if (scenario.kind === 'design-round-trip') {
    const parameters = resolvedProject(scenario.parameters)
    baseline.cases[scenario.id] = projectDesignRoundTrip(calculateMast(parameters))
    continue
  }

  throw new Error(`Unsupported canonical scenario kind: ${scenario.kind}`)
}

console.log('===CANONICAL_BASELINE_BEGIN===')
console.log(JSON.stringify(baseline, null, 2))
console.log('===CANONICAL_BASELINE_END===')
