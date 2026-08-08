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

const BASELINE_SCHEMA = 'mast-calculator/canonical-baseline/v1'

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
      eigenResidual: finite(analysis?.buckling?.residual),
      globalSchurRelativeDifference: finite(analysis?.modular?.relativeDisplacementDifference),
      interfaceEquilibriumResidual: finite(analysis?.modular?.interfaceEquilibriumResidual),
    },
    criticalMember: member ? {
      memberId: member.memberId ?? member.id ?? null,
      utilization: finite(member.utilization),
      localEndForcesChecksum: numericChecksum(member.localEndForces ?? []),
    } : null,
    connection: {
      jointCount: result.connections?.jointCount ?? null,
      boltClass: selected?.boltClass ?? result.connections?.bolt?.configuredClass ?? null,
      boltDiameterMm: finite(selected?.diameterMm ?? geometry?.bolt?.diameterMm),
      boltLengthMm: finite(geometry?.bolt?.lengthMm),
      boltUtilization: finite(result.connections?.bolt?.selected?.utilization),
      criticalWeldLengthMm: finite(result.connections?.weld?.critical?.check?.requiredPhysicalLengthMm),
    },
  }
}

function projectGuyed(parameters, scenario) {
  const heightM = parameters.moduleCount * parameters.moduleHeightMm / 1000
  const tiers = scenario.tiers.map(({ moduleFraction, ...tier }) => ({
    ...tier,
    heightM: heightM * moduleFraction,
  }))
  const result = calculateGuyedMast(parameters, tiers)
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
      totalLengthM: finite(result.cableSystem.totalCableLengthM),
      totalMassKg: finite(result.cableSystem.totalCableMassKg),
      tensionChecksum: numericChecksum(result.cableEnvelope.map((item) => item.maximumTensionN)),
    },
    nonlinear: {
      allConverged: result.cases.every((item) => item.nonlinear.converged),
      maximumIterations: Math.max(...result.cases.map((item) => item.nonlinear.iterations)),
    },
  }
}

function projectComplete(result, projection) {
  if (projection === 'staticPayload') {
    return {
      maximumTopMassKg: finite(result.staticPayloadCapacity.maximumTotalTopMassKg),
      additionalTopMassKg: finite(result.staticPayloadCapacity.remainingAdditionalMassKg ?? result.staticPayloadCapacity.additionalTopEquipmentMassKg),
      utilizationAtLimit: finite(result.staticPayloadCapacity.utilizationAtLimit),
      boltUtilizationAtLimit: finite(result.staticPayloadCapacity.boltUtilizationAtLimit),
      bucklingFactorAtLimit: finite(result.staticPayloadCapacity.bucklingFactorAtLimit),
      governingMode: result.staticPayloadCapacity.governingMode,
    }
  }
  if (projection === 'lateral') {
    return {
      criticalForceN: finite(result.lateralCapacity.criticalForceN),
      memberLimitForceN: finite(result.lateralCapacity.memberLimitForceN),
      globalBucklingForceN: finite(result.lateralCapacity.globalBucklingForceN),
      boltLimitForceN: finite(result.lateralCapacity.boltLimitForceN),
      governingMode: result.lateralCapacity.governingMode,
      directionDeg: finite(result.lateralCapacity.directionDeg),
    }
  }
  if (projection === 'craneBoom') {
    return {
      maximumEndPayloadMassKg: finite(result.craneBoomCapacity.maximumEndPayloadMassKg),
      additionalEndPayloadMassKg: finite(result.craneBoomCapacity.additionalEndPayloadMassKg),
      configuredEndPayloadMassKg: finite(result.craneBoomCapacity.configuredEndPayloadMassKg),
      boomSelfWeightN: finite(result.craneBoomCapacity.boomSelfWeightN),
      boomSelfMassEquivalentKg: finite(result.craneBoomCapacity.boomSelfMassEquivalentKg),
      governingMode: result.craneBoomCapacity.governingMode,
      governingDirectionDeg: finite(result.craneBoomCapacity.governingDirectionDeg),
    }
  }
  if (projection === 'height') {
    return {
      designMaximumModules: result.heightCapacity.design.maximumModules,
      designFirstFailModules: result.heightCapacity.design.firstFailModules,
      ultimateMaximumModules: result.heightCapacity.ultimateResistance.maximumModules,
      ultimateFirstFailModules: result.heightCapacity.ultimateResistance.firstFailModules,
      evaluationCount: result.heightCapacity.evaluationCount,
    }
  }
  throw new Error(`Неизвестная complete projection: ${projection}`)
}

function projectDesign(result) {
  const designPackage = buildDesignPackage(result, {
    createdAt: '2026-01-01T00:00:00.000Z',
    ref: 'canonical-v1',
    sha: 'canonical-v1',
  })
  const serialized = serializeDesignPackage(designPackage)
  const parsed = parseDesignPackage(serialized)
  const restored = designResultFromPackage(parsed)
  const mesh = buildDetailedMastModel(restored, { radialSegments: 8 })
  const obj = createMastObj(restored, { radialSegments: 8 })
  return {
    schema: parsed.schema,
    serializedBytes: Buffer.byteLength(serialized, 'utf8'),
    model: {
      modules: restored.model.moduleCount,
      nodes: restored.model.nodes.length,
      members: restored.model.members.length,
    },
    mesh: {
      structuralMembers: mesh.statistics.structuralMembers,
      hardwareObjects: mesh.statistics.hardwareObjects,
    },
    obj: {
      bytes: Buffer.byteLength(obj, 'utf8'),
      vertexLines: obj.split('\n').filter((line) => line.startsWith('v ')).length,
      faceLines: obj.split('\n').filter((line) => line.startsWith('f ')).length,
      hasStructuralGroup: /\ng structural_members\n/.test(`\n${obj}`),
      hasJointHardwareGroup: /\ng joint_hardware\n/.test(`\n${obj}`),
    },
  }
}

const completeCache = new Map()
function completeFor(scenario) {
  const key = scenario.cacheKey ?? JSON.stringify(scenario.input)
  if (!completeCache.has(key)) {
    completeCache.set(key, calculateCompleteMastWithConfiguredJoint(resolvedProject(scenario.input)))
  }
  return completeCache.get(key)
}

const cases = {}
for (const scenario of CANONICAL_SCENARIOS) {
  if (scenario.kind === 'performance-owner') {
    cases[scenario.id] = {
      ownerTest: scenario.ownerTest,
      topology: { modules: scenario.input.moduleCount, members: scenario.input.moduleCount * 9 },
    }
    continue
  }
  if (scenario.kind === 'mast') {
    cases[scenario.id] = projectMast(calculateMast(resolvedProject(scenario.input)))
    continue
  }
  if (scenario.kind === 'guys') {
    const parameters = resolvedProject(scenario.input)
    cases[scenario.id] = projectGuyed(parameters, scenario)
    continue
  }
  if (scenario.kind === 'complete-projection') {
    cases[scenario.id] = projectComplete(completeFor(scenario), scenario.projection)
    continue
  }
  if (scenario.kind === 'design') {
    cases[scenario.id] = projectDesign(completeFor(scenario))
    continue
  }
  throw new Error(`Неизвестный canonical scenario kind: ${scenario.kind}`)
}

const baseline = {
  schema: BASELINE_SCHEMA,
  scenariosSchema: CANONICAL_SCENARIO_SCHEMA,
  cases,
}

console.log('===CANONICAL_BASELINE_BEGIN===')
console.log(JSON.stringify(baseline, null, 2))
console.log('===CANONICAL_BASELINE_END===')