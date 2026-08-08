import type { GeneratedMastModel } from '../../structural-analysis/index.js'

const EPSILON_M = 1e-9

type Vector3 = [number, number, number]
type MastMember = GeneratedMastModel['members'][number]

interface JointDemandMemberResult {
  localEndForces: readonly number[]
  localAxes: readonly (readonly number[])[]
}

interface JointDemandAnalysis {
  memberResults: readonly (JointDemandMemberResult | undefined)[]
}

const add3 = (left: readonly number[], right: readonly number[]): Vector3 => [
  left[0]! + right[0]!,
  left[1]! + right[1]!,
  left[2]! + right[2]!,
]
const scale3 = (value: readonly number[], scalar: number): Vector3 => [
  value[0]! * scalar,
  value[1]! * scalar,
  value[2]! * scalar,
]
const dot3 = (left: readonly number[], right: readonly number[]): number => (
  left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!
)
const norm3 = (value: readonly number[]): number => Math.hypot(value[0]!, value[1]!, value[2]!)
const sub3 = (left: readonly number[], right: readonly number[]): Vector3 => [
  left[0]! - right[0]!,
  left[1]! - right[1]!,
  left[2]! - right[2]!,
]
const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value))

function localToGlobal(local: readonly number[], axes: readonly (readonly number[])[]): Vector3 {
  return [0, 1, 2].map((globalAxis) => (
    axes[0]![globalAxis]! * local[0]!
    + axes[1]![globalAxis]! * local[1]!
    + axes[2]![globalAxis]! * local[2]!
  )) as Vector3
}

function memberEndAtNode(
  model: GeneratedMastModel,
  analysis: JointDemandAnalysis,
  member: MastMember,
  nodeId: number,
) {
  const result = analysis.memberResults[member.id]
  if (!result?.localEndForces?.length || !result?.localAxes?.length) {
    throw new Error(`Для ребра ${member.id} отсутствуют frame end-forces`)
  }
  const isA = member.nodeA === nodeId
  const isB = member.nodeB === nodeId
  if (!isA && !isB) throw new Error(`Ребро ${member.id} не связано с узлом ${nodeId}`)
  const offset = isA ? 0 : 6
  return {
    forceGlobalN: localToGlobal(result.localEndForces.slice(offset, offset + 3), result.localAxes),
    momentGlobalNm: localToGlobal(result.localEndForces.slice(offset + 3, offset + 6), result.localAxes),
  }
}

function incidentMembers(model: GeneratedMastModel, nodeId: number): MastMember[] {
  return model.members.filter((member) => member.nodeA === nodeId || member.nodeB === nodeId)
}

function otherNode(model: GeneratedMastModel, member: MastMember, nodeId: number) {
  const node = model.nodes[member.nodeA === nodeId ? member.nodeB : member.nodeA]
  if (!node) throw new Error(`Для ребра ${member.id} отсутствует связанный узел`)
  return node
}

export interface JointDemandSplitOptions {
  boltAxis?: readonly number[]
  jointEffectiveRadiusMm?: unknown
}

export function splitJointDemandForBolt(
  forceGlobalN: readonly number[],
  momentGlobalNm: readonly number[],
  options: JointDemandSplitOptions = {},
) {
  const axis = options.boltAxis ?? [0, 0, 1]
  const axisNorm = norm3(axis)
  if (!(axisNorm > Number.EPSILON)) throw new Error('Ось соединительного болта не может быть нулевой')
  const unitAxis = scale3(axis, 1 / axisNorm)
  const leverArmMm = Number(options.jointEffectiveRadiusMm)
  if (!Number.isFinite(leverArmMm) || leverArmMm <= 0) {
    throw new Error('Эффективный радиус межмодульного узла должен быть положительным')
  }
  const leverArmM = leverArmMm / 1000

  const forceMagnitudeN = norm3(forceGlobalN)
  const signedAxialForceN = dot3(forceGlobalN, unitAxis)
  const directTensionN = Math.max(0, -signedAxialForceN)
  const contactCompressionN = Math.max(0, signedAxialForceN)
  const directShearVectorN = sub3(forceGlobalN, scale3(unitAxis, signedAxialForceN))
  const directShearN = norm3(directShearVectorN)
  const cosineToAxis = forceMagnitudeN > Number.EPSILON
    ? clampUnit(signedAxialForceN / forceMagnitudeN)
    : 1
  const angleToPositiveBoltAxisDeg = Math.acos(cosineToAxis) * 180 / Math.PI
  const acuteAngleToBoltAxisDeg = Math.acos(Math.abs(cosineToAxis)) * 180 / Math.PI
  const transverseForceFraction = forceMagnitudeN > Number.EPSILON
    ? directShearN / forceMagnitudeN
    : 0
  const torsionNm = Math.abs(dot3(momentGlobalNm, unitAxis))
  const bendingMomentVectorNm = sub3(momentGlobalNm, scale3(unitAxis, dot3(momentGlobalNm, unitAxis)))
  const bendingMomentNm = norm3(bendingMomentVectorNm)
  const momentEquivalentTensionN = bendingMomentNm / leverArmM
  const torsionEquivalentShearN = torsionNm / leverArmM
  const tensionN = directTensionN + momentEquivalentTensionN
  const shearN = directShearN + torsionEquivalentShearN

  return {
    boltAxis: [...unitAxis],
    jointEffectiveRadiusMm: leverArmMm,
    forceGlobalN: [...forceGlobalN],
    forceMagnitudeN,
    momentGlobalNm: [...momentGlobalNm],
    signedAxialForceN,
    directTensionN,
    contactCompressionN,
    directShearVectorN,
    directShearN,
    shearFromInclinedForceN: directShearN,
    angleToPositiveBoltAxisDeg,
    acuteAngleToBoltAxisDeg,
    transverseForceFraction,
    bendingMomentNm,
    torsionNm,
    momentEquivalentTensionN,
    torsionEquivalentShearN,
    tensionN,
    shearN,
  }
}

export function buildIntermoduleJointResultants(model: GeneratedMastModel, analysis: JointDemandAnalysis) {
  const elevations = model.nodes.map((node) => node.position[2])
  const minimumZ = Math.min(...elevations)
  const maximumZ = Math.max(...elevations)
  const moduleHeightM = (maximumZ - minimumZ) / Math.max(1, model.moduleCount)
  const resultants: Array<{
    nodeId: number
    level: number
    corner: number
    elevationM: number
    upperMemberIds: number[]
    forceGlobalN: Vector3
    momentGlobalNm: Vector3
  }> = []

  for (const node of model.nodes) {
    const z = node.position[2]
    if (z <= minimumZ + EPSILON_M || z >= maximumZ - EPSILON_M) continue
    const incident = incidentMembers(model, node.id)
    const upperMembers = incident.filter((member) => otherNode(model, member, node.id).position[2] > z + EPSILON_M)
    if (upperMembers.length !== 2) {
      throw new Error(`Межмодульный узел ${node.id}: ожидались два ребра верхней ножки, найдено ${upperMembers.length}`)
    }

    let forceGlobalN: Vector3 = [0, 0, 0]
    let momentGlobalNm: Vector3 = [0, 0, 0]
    for (const member of upperMembers) {
      const end = memberEndAtNode(model, analysis, member, node.id)
      forceGlobalN = add3(forceGlobalN, end.forceGlobalN)
      momentGlobalNm = add3(momentGlobalNm, end.momentGlobalNm)
    }
    resultants.push({
      nodeId: node.id,
      level: Math.round((z - minimumZ) / Math.max(moduleHeightM, Number.EPSILON)),
      corner: node.id % 3,
      elevationM: z,
      upperMemberIds: upperMembers.map((member) => member.id),
      forceGlobalN,
      momentGlobalNm,
    })
  }
  return resultants
}

export function buildIntermoduleJointDemands(
  model: GeneratedMastModel,
  analysis: JointDemandAnalysis,
  options: JointDemandSplitOptions = {},
) {
  return buildIntermoduleJointResultants(model, analysis).map((resultant) => ({
    ...resultant,
    ...splitJointDemandForBolt(resultant.forceGlobalN, resultant.momentGlobalNm, options),
  }))
}

export function memberEndWeldDemand(
  member: MastMember,
  result: JointDemandMemberResult | undefined,
  end: 'A' | 'B',
) {
  const offset = end === 'A' ? 0 : 6
  if (!result?.localEndForces?.length) throw new Error(`Для ребра ${member.id} отсутствуют end-forces`)
  const forces = result.localEndForces
  return {
    memberId: member.id,
    end,
    nodeId: end === 'A' ? member.nodeA : member.nodeB,
    axialForceN: forces[offset]!,
    shearForceN: Math.hypot(forces[offset + 1]!, forces[offset + 2]!),
    torsionNm: forces[offset + 3]!,
    bendingNm: Math.hypot(forces[offset + 4]!, forces[offset + 5]!),
  }
}

export function buildMemberEndWeldDemands(model: GeneratedMastModel, analysis: JointDemandAnalysis) {
  const demands = []
  for (const member of model.members) {
    const result = analysis.memberResults[member.id]
    demands.push(memberEndWeldDemand(member, result, 'A'))
    demands.push(memberEndWeldDemand(member, result, 'B'))
  }
  return demands
}
