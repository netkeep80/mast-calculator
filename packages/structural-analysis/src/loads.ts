import type { ResolvedProject } from '../../domain/contracts.js'
import { meanWindPressureAtHeightPa } from '../../domain/index.js'
import type { Vector3 as NumericVector3 } from '../../numerics/index.js'
import { dot3, norm3, scale3, sub3, unit3 } from '../../numerics/index.js'
import type { GeneratedMastModel } from './geometry.js'

const GRAVITY = 9.80665

type MutableVector3 = [number, number, number]

interface LoadCaseOptions {
  readonly topPointLoadN?: readonly number[]
}

interface MemberLoadDetail {
  readonly memberId: number
  readonly lengthM: number
  readonly characteristicSteelWeightPerLengthN: number
  readonly steelWeightPerLengthN: number
  readonly characteristicIceWeightPerLengthN: number
  readonly iceWeightPerLengthN: number
  readonly windReferenceHeightM: number
  readonly characteristicMeanWindPressurePa: number
  readonly designMeanWindPressurePa: number
  readonly windForcePerLengthN: MutableVector3
  readonly resultantForcePerLengthN: MutableVector3
}

export interface BuiltLoadCase {
  nodalLoads: MutableVector3[]
  nodalMoments: MutableVector3[]
  memberDistributedLoads: MutableVector3[]
  memberLoadDetails: Array<MemberLoadDetail | null>
  totalAppliedLoad: MutableVector3
  distributedResultant: MutableVector3
  nodalResultant: MutableVector3
  selfWeightCharacteristicN: number
  selfWeightN: number
  iceWeightCharacteristicN: number
  iceWeightN: number
  memberWindN: number
  equipmentWeightCharacteristicN: number
  equipmentWeightN: number
  equipmentWindN: number
  equipmentWindReferenceHeightM: number
  equipmentCharacteristicMeanWindPressurePa: number
  equipmentDesignMeanWindPressurePa: number
  loadActionProvenance: ResolvedProject['loadActionProvenance']
  windActionProvenance: ResolvedProject['windActionProvenance']
  topPointLoadN: MutableVector3
  topHorizontalLoadN: number
  topVerticalLoadN: number
  windDirectionDeg: number
}

const add3 = (a: NumericVector3, b: NumericVector3): MutableVector3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
]

function normalizedTopPointLoad(options: LoadCaseOptions = {}): MutableVector3 {
  const raw = options.topPointLoadN ?? [0, 0, 0]
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error('Внутренняя точечная нагрузка вершины должна быть вектором [Fx, Fy, Fz]')
  }
  const value = raw.map(Number)
  if (!value.every(Number.isFinite)) {
    throw new Error('Компоненты внутренней точечной нагрузки вершины должны быть конечными числами')
  }
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]
}

export function buildLoadCase(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  options: LoadCaseOptions = {},
): BuiltLoadCase {
  const nodalLoads: MutableVector3[] = model.nodes.map(() => [0, 0, 0])
  const nodalMoments: MutableVector3[] = model.nodes.map(() => [0, 0, 0])
  const memberDistributedLoads: MutableVector3[] = model.members.map(() => [0, 0, 0])
  const memberLoadDetails: Array<MemberLoadDetail | null> = model.members.map(() => null)
  const topPointLoadN = normalizedTopPointLoad(options)

  const directionRad = parameters.windDirectionDeg * Math.PI / 180
  const wind: MutableVector3 = [Math.cos(directionRad), Math.sin(directionRad), 0]
  const iceThicknessM = Math.max(0, parameters.iceThicknessMm) / 1000
  const iceDensityKgM3 = Math.max(0, parameters.iceDensityKgM3)
  let selfWeightCharacteristicN = 0
  let selfWeightN = 0
  let iceWeightCharacteristicN = 0
  let iceWeightN = 0
  let memberWindN = 0
  let distributedResultant: MutableVector3 = [0, 0, 0]

  const addNodeLoad = (nodeId: number, load: NumericVector3): void => {
    const target = nodalLoads[nodeId]
    if (!target) throw new Error(`Не найден узел ${nodeId}`)
    target[0] += load[0]
    target[1] += load[1]
    target[2] += load[2]
  }

  for (const member of model.members) {
    const nodeA = model.nodes[member.nodeA]
    const nodeB = model.nodes[member.nodeB]
    if (!nodeA || !nodeB) throw new Error(`Некорректная ссылка в стержне ${member.id}`)

    const delta = sub3(nodeB.position, nodeA.position)
    const lengthM = norm3(delta)
    const axis = unit3(delta)
    const steelAreaM2 = Math.PI * member.diameterM ** 2 / 4
    const outerDiameterM = member.diameterM + 2 * iceThicknessM
    const iceAreaM2 = Math.PI * Math.max(0, outerDiameterM ** 2 - member.diameterM ** 2) / 4

    const characteristicSteelWeightPerLengthN = member.densityKgM3 * steelAreaM2 * GRAVITY
    const steelWeightPerLengthN = characteristicSteelWeightPerLengthN * parameters.steelSelfWeightLoadFactor
    const characteristicIceWeightPerLengthN = iceDensityKgM3 * iceAreaM2 * GRAVITY
    const iceWeightPerLengthN = characteristicIceWeightPerLengthN * parameters.iceLoadFactor

    const characteristicSteelWeightN = characteristicSteelWeightPerLengthN * lengthM
    const steelWeightN = steelWeightPerLengthN * lengthM
    const characteristicIceWeightN = characteristicIceWeightPerLengthN * lengthM
    const memberIceWeightN = iceWeightPerLengthN * lengthM
    selfWeightCharacteristicN += characteristicSteelWeightN
    selfWeightN += steelWeightN
    iceWeightCharacteristicN += characteristicIceWeightN
    iceWeightN += memberIceWeightN

    const windReferenceHeightM = Math.max(0, (nodeA.position[2] + nodeB.position[2]) / 2)
    const characteristicMeanWindPressurePa = meanWindPressureAtHeightPa(parameters, windReferenceHeightM)
    const designMeanWindPressurePa = characteristicMeanWindPressurePa * parameters.windLoadFactor

    const axisWindProjection = dot3(axis, wind)
    const windNormal = sub3(wind, scale3(axis, axisWindProjection))
    const windCoefficientNPerM = designMeanWindPressurePa
      * parameters.dragCoefficient
      * outerDiameterM
    const windPerLength = scale3(windNormal, windCoefficientNPerM)
    const windForceN = norm3(windPerLength) * lengthM
    memberWindN += windForceN

    const gravityPerLength: MutableVector3 = [0, 0, -(steelWeightPerLengthN + iceWeightPerLengthN)]
    const distributed = add3(windPerLength, gravityPerLength)
    memberDistributedLoads[member.id] = distributed
    memberLoadDetails[member.id] = {
      memberId: member.id,
      lengthM,
      characteristicSteelWeightPerLengthN,
      steelWeightPerLengthN,
      characteristicIceWeightPerLengthN,
      iceWeightPerLengthN,
      windReferenceHeightM,
      characteristicMeanWindPressurePa,
      designMeanWindPressurePa,
      windForcePerLengthN: [...windPerLength],
      resultantForcePerLengthN: [...distributed],
    }
    distributedResultant = add3(distributedResultant, scale3(distributed, lengthM))
  }

  const equipmentMassKg = Math.max(0, Number(parameters.equipmentMassKg))
  const equipmentWeightCharacteristicN = equipmentMassKg * GRAVITY
  const equipmentWeightN = equipmentWeightCharacteristicN * parameters.equipmentLoadFactor
  const equipmentWindReferenceHeightM = Math.max(0, ...model.topNodeIds.map((nodeId) => model.nodes[nodeId]?.position[2] ?? 0))
  const equipmentCharacteristicMeanWindPressurePa = meanWindPressureAtHeightPa(parameters, equipmentWindReferenceHeightM)
  const equipmentDesignMeanWindPressurePa = equipmentCharacteristicMeanWindPressurePa * parameters.windLoadFactor
  const equipmentWindN = equipmentDesignMeanWindPressurePa
    * parameters.equipmentDragCoefficient
    * parameters.equipmentWindAreaM2

  const topCount = Math.max(model.topNodeIds.length, 1)
  for (const nodeId of model.topNodeIds) {
    addNodeLoad(nodeId, [
      (wind[0] * equipmentWindN + topPointLoadN[0]) / topCount,
      (wind[1] * equipmentWindN + topPointLoadN[1]) / topCount,
      (-equipmentWeightN + topPointLoadN[2]) / topCount,
    ])
  }

  const nodalResultant = nodalLoads.reduce<MutableVector3>(
    (sum, load) => add3(sum, load),
    [0, 0, 0],
  )
  const totalAppliedLoad = add3(distributedResultant, nodalResultant)

  return {
    nodalLoads,
    nodalMoments,
    memberDistributedLoads,
    memberLoadDetails,
    totalAppliedLoad,
    distributedResultant,
    nodalResultant,
    selfWeightCharacteristicN,
    selfWeightN,
    iceWeightCharacteristicN,
    iceWeightN,
    memberWindN,
    equipmentWeightCharacteristicN,
    equipmentWeightN,
    equipmentWindN,
    equipmentWindReferenceHeightM,
    equipmentCharacteristicMeanWindPressurePa,
    equipmentDesignMeanWindPressurePa,
    loadActionProvenance: parameters.loadActionProvenance,
    windActionProvenance: parameters.windActionProvenance,
    topPointLoadN: [...topPointLoadN],
    topHorizontalLoadN: Math.hypot(
      equipmentWindN * wind[0] + topPointLoadN[0],
      equipmentWindN * wind[1] + topPointLoadN[1],
    ),
    topVerticalLoadN: equipmentWeightN - topPointLoadN[2],
    windDirectionDeg: parameters.windDirectionDeg,
  }
}
