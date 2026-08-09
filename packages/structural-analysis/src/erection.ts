import type { ResolvedProject } from '../../domain/contracts.js'
import {
  add3,
  cross3,
  dot3,
  norm3,
  scale3,
  sub3,
  unit3,
  type MutableVector3,
  type Vector3,
} from '../../numerics/index.js'
import type { GeneratedMastModel } from './geometry.js'
import type { BuiltLoadCase } from './loads.js'
import { analyzeFrame, compileFrameSystem, type FrameAnalysisResult } from './solver.js'

const GRAVITY_M_S2 = 9.80665
const DOF_PER_NODE = 6
const TRANSLATIONAL_DOF_COUNT = 3

type Position3 = [number, number, number]
type Restraint6 = [boolean, boolean, boolean, boolean, boolean, boolean]

export const ERECTION_MODEL_ID = 'tilt-up-quasi-static-hinge-v1' as const

export interface ErectionStateInput {
  readonly angleDeg: number
  readonly hingeNodeIds: readonly [number, number]
  readonly attachmentNodeId: number
  readonly anchorPointM: readonly [number, number, number]
  readonly gaugeNodeId?: number
  /** Positive or negative rotation around hingeNodeIds[0] -> hingeNodeIds[1]. */
  readonly rotationSense?: 1 | -1
}

export type ErectionInfeasibleReason =
  | 'singular-cable-geometry'
  | 'cable-would-need-compression'
  | 'singular-gauge-geometry'

export interface ErectionGeometryProvenance {
  readonly model: typeof ERECTION_MODEL_ID
  readonly angleDeg: number
  readonly hingeNodeIds: readonly [number, number]
  readonly hingeAxis: readonly [number, number, number]
  readonly attachmentNodeId: number
  readonly attachmentPointM: readonly [number, number, number]
  readonly anchorPointM: readonly [number, number, number]
  readonly cableDirection: readonly [number, number, number]
  readonly gaugeNodeId: number
  readonly gaugeTranslationAxis: 0 | 1 | 2
  readonly rotationSense: 1 | -1
}

export interface ErectionEquilibriumOk {
  readonly status: 'ok'
  readonly geometry: ErectionGeometryProvenance
  readonly requiredCableTensionN: number
  readonly gravityMomentAboutHingeNm: number
  readonly cableMomentArmM: number
  readonly gaugeMomentArmM: number
  readonly gaugeReactionN: number
  readonly normalizedGaugeReaction: number
  readonly physicalSteelWeightN: number
  readonly physicalEquipmentWeightN: number
  readonly loadCase: BuiltLoadCase
  readonly analysis: FrameAnalysisResult
}

export interface ErectionEquilibriumInfeasible {
  readonly status: 'infeasible'
  readonly reason: ErectionInfeasibleReason
  readonly geometry: ErectionGeometryProvenance
  readonly gravityMomentAboutHingeNm: number
  readonly cableMomentArmM: number
  readonly requiredCableTensionN: number | null
  readonly gaugeMomentArmM: number
}

export type ErectionEquilibriumResult = ErectionEquilibriumOk | ErectionEquilibriumInfeasible

function assertNode(model: GeneratedMastModel, nodeId: number, role: string) {
  const node = model.nodes[nodeId]
  if (!node) throw new RangeError(`${role}: node ${nodeId} does not exist`)
  return node
}

function position(value: readonly number[], role: string): Position3 {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new RangeError(`${role} must be a finite [x, y, z] coordinate`)
  }
  return [value[0]!, value[1]!, value[2]!]
}

function rotateVectorAroundAxis(vector: Vector3, axis: Vector3, angleRad: number): MutableVector3 {
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)
  return add3(
    add3(scale3(vector, cosine), scale3(cross3(axis, vector), sine)),
    scale3(axis, dot3(axis, vector) * (1 - cosine)),
  )
}

function rotatePointAroundLine(
  point: Vector3,
  linePoint: Vector3,
  axis: Vector3,
  angleRad: number,
): Position3 {
  const rotated = rotateVectorAroundAxis(sub3(point, linePoint), axis, angleRad)
  const result = add3(linePoint, rotated)
  return [result[0], result[1], result[2]]
}

function momentAboutAxisNm(
  axisPoint: Vector3,
  axis: Vector3,
  loadPoint: Vector3,
  forceN: Vector3,
): number {
  return dot3(axis, cross3(sub3(loadPoint, axisPoint), forceN))
}

function zeroRestraint(): Restraint6 {
  return [false, false, false, false, false, false]
}

function gaugeAxis(
  hingePoint: Vector3,
  hingeAxis: Vector3,
  gaugePoint: Vector3,
): { axis: 0 | 1 | 2; momentArmM: number } {
  const tangent = cross3(hingeAxis, sub3(gaugePoint, hingePoint))
  let selected: 0 | 1 | 2 = 0
  for (let axis = 1 as 1 | 2; axis < TRANSLATIONAL_DOF_COUNT; axis = (axis + 1) as 1 | 2) {
    if (Math.abs(tangent[axis]) > Math.abs(tangent[selected])) selected = axis
    if (axis === 2) break
  }
  const unitForce: MutableVector3 = [0, 0, 0]
  unitForce[selected] = 1
  return {
    axis: selected,
    momentArmM: momentAboutAxisNm(hingePoint, hingeAxis, gaugePoint, unitForce),
  }
}

function transformedErectionModel(
  source: GeneratedMastModel,
  input: ErectionStateInput,
): { model: GeneratedMastModel; geometry: ErectionGeometryProvenance; gaugeMomentArmM: number } {
  if (!Number.isFinite(input.angleDeg) || input.angleDeg < 0 || input.angleDeg > 90) {
    throw new RangeError('erection angle must be within 0..90 degrees')
  }
  const [hingeAId, hingeBId] = input.hingeNodeIds
  if (hingeAId === hingeBId) throw new RangeError('hinge nodes must be distinct')
  const hingeA = assertNode(source, hingeAId, 'hinge A')
  const hingeB = assertNode(source, hingeBId, 'hinge B')
  assertNode(source, input.attachmentNodeId, 'cable attachment')
  const rotationSense = input.rotationSense ?? 1
  const hingeVector = sub3(hingeB.position, hingeA.position)
  if (!(norm3(hingeVector) > 1e-9)) throw new RangeError('hinge axis length must be positive')
  const hingeAxis = unit3(hingeVector)
  const angleRad = rotationSense * (input.angleDeg - 90) * Math.PI / 180

  const nodes = source.nodes.map((node) => ({
    ...node,
    position: rotatePointAroundLine(node.position, hingeA.position, hingeAxis, angleRad),
    restrained: zeroRestraint(),
  }))

  for (const nodeId of input.hingeNodeIds) {
    const node = nodes[nodeId]!
    node.restrained = [true, true, true, false, false, false]
  }

  const gaugeNodeId = input.gaugeNodeId ?? input.attachmentNodeId
  if (input.hingeNodeIds.includes(gaugeNodeId)) {
    throw new RangeError('gauge node must not lie on the hinge')
  }
  const gaugeNode = nodes[gaugeNodeId]
  if (!gaugeNode) throw new RangeError(`gauge node ${gaugeNodeId} does not exist`)
  const gauge = gaugeAxis(hingeA.position, hingeAxis, gaugeNode.position)
  gaugeNode.restrained[gauge.axis] = true

  const attachmentPointM = nodes[input.attachmentNodeId]!.position
  const anchorPointM = position(input.anchorPointM, 'anchorPointM')
  const cableVector = sub3(anchorPointM, attachmentPointM)
  if (!(norm3(cableVector) > 1e-9)) throw new RangeError('anchor point must differ from cable attachment point')
  const cableDirection = unit3(cableVector)

  return {
    model: {
      ...source,
      nodes,
      members: source.members.map((member) => ({ ...member })),
      modules: source.modules.map((module) => ({
        ...module,
        bottomNodeIds: [...module.bottomNodeIds],
        topNodeIds: [...module.topNodeIds],
        memberIds: [...module.memberIds],
      })),
      baseNodeIds: [...source.baseNodeIds],
      topNodeIds: [...source.topNodeIds],
      moduleDiametersMm: [...source.moduleDiametersMm],
      stiffnessModel: { ...source.stiffnessModel },
    },
    geometry: {
      model: ERECTION_MODEL_ID,
      angleDeg: input.angleDeg,
      hingeNodeIds: [hingeAId, hingeBId],
      hingeAxis: [hingeAxis[0], hingeAxis[1], hingeAxis[2]],
      attachmentNodeId: input.attachmentNodeId,
      attachmentPointM: [...attachmentPointM],
      anchorPointM: [...anchorPointM],
      cableDirection: [cableDirection[0], cableDirection[1], cableDirection[2]],
      gaugeNodeId,
      gaugeTranslationAxis: gauge.axis,
      rotationSense,
    },
    gaugeMomentArmM: gauge.momentArmM,
  }
}

function physicalErectionLoads(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  geometry: ErectionGeometryProvenance,
): {
  memberDistributedLoads: MutableVector3[]
  nodalGravityLoads: MutableVector3[]
  selfWeightN: number
  equipmentWeightN: number
  gravityMomentAboutHingeNm: number
} {
  const hingePoint = model.nodes[geometry.hingeNodeIds[0]]!.position
  const hingeAxis = geometry.hingeAxis
  const memberDistributedLoads: MutableVector3[] = model.members.map(() => [0, 0, 0])
  const nodalGravityLoads: MutableVector3[] = model.nodes.map(() => [0, 0, 0])
  let selfWeightN = 0
  let gravityMomentAboutHingeNm = 0

  for (const member of model.members) {
    const nodeA = model.nodes[member.nodeA]!
    const nodeB = model.nodes[member.nodeB]!
    const lengthM = norm3(sub3(nodeB.position, nodeA.position))
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const weightPerLengthN = member.densityKgM3 * areaM2 * GRAVITY_M_S2
    const distributed: MutableVector3 = [0, 0, -weightPerLengthN]
    memberDistributedLoads[member.id] = distributed
    const resultant = scale3(distributed, lengthM)
    const midpoint = scale3(add3(nodeA.position, nodeB.position), 0.5)
    selfWeightN += weightPerLengthN * lengthM
    gravityMomentAboutHingeNm += momentAboutAxisNm(hingePoint, hingeAxis, midpoint, resultant)
  }

  const equipmentWeightN = Math.max(0, Number(parameters.equipmentMassKg)) * GRAVITY_M_S2
  const topCount = Math.max(1, model.topNodeIds.length)
  for (const nodeId of model.topNodeIds) {
    const load: MutableVector3 = [0, 0, -equipmentWeightN / topCount]
    nodalGravityLoads[nodeId] = add3(nodalGravityLoads[nodeId]!, load)
    gravityMomentAboutHingeNm += momentAboutAxisNm(
      hingePoint,
      hingeAxis,
      model.nodes[nodeId]!.position,
      load,
    )
  }

  return {
    memberDistributedLoads,
    nodalGravityLoads,
    selfWeightN,
    equipmentWeightN,
    gravityMomentAboutHingeNm,
  }
}

function sumVectors(values: readonly Vector3[]): MutableVector3 {
  return values.reduce<MutableVector3>((sum, value) => add3(sum, value), [0, 0, 0])
}

function buildErectionLoadCase(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  geometry: ErectionGeometryProvenance,
  tensionN: number,
  physical: ReturnType<typeof physicalErectionLoads>,
): BuiltLoadCase {
  const nodalLoads = physical.nodalGravityLoads.map((load) => [...load] as MutableVector3)
  const cableForce = scale3(geometry.cableDirection, tensionN)
  nodalLoads[geometry.attachmentNodeId] = add3(nodalLoads[geometry.attachmentNodeId]!, cableForce)
  const distributedResultant = sumVectors(model.members.map((member) => (
    scale3(physical.memberDistributedLoads[member.id]!, norm3(sub3(
      model.nodes[member.nodeB]!.position,
      model.nodes[member.nodeA]!.position,
    )))
  )))
  const nodalResultant = sumVectors(nodalLoads)
  const totalAppliedLoad = add3(distributedResultant, nodalResultant)

  return {
    nodalLoads,
    nodalMoments: model.nodes.map(() => [0, 0, 0]),
    memberDistributedLoads: physical.memberDistributedLoads.map((load) => [...load]),
    memberLoadDetails: model.members.map(() => null),
    totalAppliedLoad,
    distributedResultant,
    nodalResultant,
    selfWeightN: physical.selfWeightN,
    iceWeightN: 0,
    memberWindN: 0,
    equipmentWeightN: physical.equipmentWeightN,
    equipmentWindN: 0,
    equipmentWindReferenceHeightM: 0,
    equipmentCharacteristicMeanWindPressurePa: 0,
    equipmentDesignMeanWindPressurePa: 0,
    windActionProvenance: parameters.windActionProvenance,
    topPointLoadN: [0, 0, 0],
    topHorizontalLoadN: 0,
    topVerticalLoadN: physical.equipmentWeightN,
    windDirectionDeg: parameters.windDirectionDeg,
  }
}

/**
 * Solves one prescribed tilt-up angle. The remaining rigid rotation about the
 * hinge is removed by one temporary translational gauge restraint. Cable
 * tension is derived from projected moment equilibrium about the hinge, so the
 * artificial gauge reaction must collapse to numerical zero in the FEM solve.
 */
export function calculateErectionState(
  sourceModel: GeneratedMastModel,
  parameters: ResolvedProject,
  input: ErectionStateInput,
): ErectionEquilibriumResult {
  const transformed = transformedErectionModel(sourceModel, input)
  const { model, geometry, gaugeMomentArmM } = transformed
  const hingePoint = model.nodes[geometry.hingeNodeIds[0]]!.position
  const physical = physicalErectionLoads(model, parameters, geometry)
  const cableMomentArmM = momentAboutAxisNm(
    hingePoint,
    geometry.hingeAxis,
    geometry.attachmentPointM,
    geometry.cableDirection,
  )
  const characteristicLengthM = Math.max(
    1,
    norm3(sub3(geometry.attachmentPointM, hingePoint)),
  )
  if (Math.abs(gaugeMomentArmM) <= 1e-9 * characteristicLengthM) {
    return {
      status: 'infeasible',
      reason: 'singular-gauge-geometry',
      geometry,
      gravityMomentAboutHingeNm: physical.gravityMomentAboutHingeNm,
      cableMomentArmM,
      requiredCableTensionN: null,
      gaugeMomentArmM,
    }
  }
  if (Math.abs(cableMomentArmM) <= 1e-9 * characteristicLengthM) {
    return {
      status: 'infeasible',
      reason: 'singular-cable-geometry',
      geometry,
      gravityMomentAboutHingeNm: physical.gravityMomentAboutHingeNm,
      cableMomentArmM,
      requiredCableTensionN: null,
      gaugeMomentArmM,
    }
  }

  const rawTensionN = -physical.gravityMomentAboutHingeNm / cableMomentArmM
  const loadScaleN = Math.max(1, physical.selfWeightN + physical.equipmentWeightN)
  if (rawTensionN < -1e-10 * loadScaleN) {
    return {
      status: 'infeasible',
      reason: 'cable-would-need-compression',
      geometry,
      gravityMomentAboutHingeNm: physical.gravityMomentAboutHingeNm,
      cableMomentArmM,
      requiredCableTensionN: rawTensionN,
      gaugeMomentArmM,
    }
  }
  const requiredCableTensionN = Math.max(0, rawTensionN)
  const loadCase = buildErectionLoadCase(model, parameters, geometry, requiredCableTensionN, physical)
  const compiled = compileFrameSystem(model, parameters)
  const analysis = analyzeFrame(model, loadCase, parameters, compiled)
  const gaugeReactionN = analysis.reactions[geometry.gaugeNodeId]![geometry.gaugeTranslationAxis]
  const normalizedGaugeReaction = Math.abs(gaugeReactionN) / Math.max(
    1,
    physical.selfWeightN + physical.equipmentWeightN + requiredCableTensionN,
  )

  return {
    status: 'ok',
    geometry,
    requiredCableTensionN,
    gravityMomentAboutHingeNm: physical.gravityMomentAboutHingeNm,
    cableMomentArmM,
    gaugeMomentArmM,
    gaugeReactionN,
    normalizedGaugeReaction,
    physicalSteelWeightN: physical.selfWeightN,
    physicalEquipmentWeightN: physical.equipmentWeightN,
    loadCase,
    analysis,
  }
}

export function projectedMomentAboutAxis(
  axisPoint: readonly [number, number, number],
  axisDirection: readonly [number, number, number],
  loadPoint: readonly [number, number, number],
  forceN: readonly [number, number, number],
): number {
  return momentAboutAxisNm(axisPoint, unit3(axisDirection), loadPoint, forceN)
}
