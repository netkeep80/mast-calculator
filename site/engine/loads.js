import { dot3, norm3, scale3, sub3, unit3 } from './vector.js'

const GRAVITY = 9.80665

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

export function buildLoadCase(model, parameters) {
  // В frame-модели собственный вес, лёд и ветер на стержни являются
  // распределёнными нагрузками. В nodalLoads остаются только нагрузки,
  // приложенные непосредственно к расчётным узлам (оборудование и доп. силы).
  const nodalLoads = model.nodes.map(() => [0, 0, 0])
  const nodalMoments = model.nodes.map(() => [0, 0, 0])
  const memberDistributedLoads = model.members.map(() => [0, 0, 0])
  const memberLoadDetails = model.members.map(() => null)

  const directionRad = parameters.windDirectionDeg * Math.PI / 180
  const wind = [Math.cos(directionRad), Math.sin(directionRad), 0]
  const iceThicknessM = Math.max(0, parameters.iceThicknessMm ?? 0) / 1000
  const iceDensityKgM3 = Math.max(0, parameters.iceDensityKgM3 ?? 900)
  let selfWeightN = 0
  let iceWeightN = 0
  let memberWindN = 0
  let distributedResultant = [0, 0, 0]

  const addNodeLoad = (nodeId, load) => {
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

    const steelWeightPerLengthN = member.densityKgM3
      * steelAreaM2
      * GRAVITY
      * parameters.deadLoadFactor
    const iceWeightPerLengthN = iceDensityKgM3
      * iceAreaM2
      * GRAVITY
      * parameters.deadLoadFactor

    const steelWeightN = steelWeightPerLengthN * lengthM
    const memberIceWeightN = iceWeightPerLengthN * lengthM
    selfWeightN += steelWeightN
    iceWeightN += memberIceWeightN

    // Для цилиндрического стержня учитываем только компонент скорости/давления,
    // нормальный к его оси. Вектор (wind - axis*(axis·wind)) одновременно задаёт
    // направление силы и коэффициент пространственной проекции.
    const axisWindProjection = dot3(axis, wind)
    const windNormal = sub3(wind, scale3(axis, axisWindProjection))
    const windCoefficientNPerM = parameters.windPressurePa
      * parameters.dragCoefficient
      * outerDiameterM
      * parameters.windLoadFactor
    const windPerLength = scale3(windNormal, windCoefficientNPerM)
    const windForceN = norm3(windPerLength) * lengthM
    memberWindN += windForceN

    const gravityPerLength = [0, 0, -(steelWeightPerLengthN + iceWeightPerLengthN)]
    const distributed = add3(windPerLength, gravityPerLength)
    memberDistributedLoads[member.id] = distributed
    memberLoadDetails[member.id] = {
      memberId: member.id,
      lengthM,
      steelWeightPerLengthN,
      iceWeightPerLengthN,
      windForcePerLengthN: [...windPerLength],
      resultantForcePerLengthN: [...distributed],
    }
    distributedResultant = add3(distributedResultant, scale3(distributed, lengthM))
  }

  // equipmentMassKg is a physical mass. It is converted to a design force by
  // m*g*equipmentLoadFactor. extra*LoadN fields are already forces in newtons
  // and therefore are not multiplied by the equipment factor a second time.
  const equipmentWeightN = parameters.equipmentMassKg * GRAVITY * parameters.equipmentLoadFactor
  const equipmentWindN = parameters.windPressurePa
    * parameters.equipmentDragCoefficient
    * parameters.equipmentWindAreaM2
    * parameters.windLoadFactor
  const extraHorizontalLoadN = Number(parameters.extraHorizontalLoadN ?? 0)
  const extraVerticalLoadN = Number(parameters.extraVerticalLoadN ?? 0)
  const horizontalN = equipmentWindN + extraHorizontalLoadN
  const verticalN = equipmentWeightN + extraVerticalLoadN

  const topCount = Math.max(model.topNodeIds.length, 1)
  for (const nodeId of model.topNodeIds) {
    addNodeLoad(nodeId, [
      wind[0] * horizontalN / topCount,
      wind[1] * horizontalN / topCount,
      -verticalN / topCount,
    ])
  }

  const nodalResultant = nodalLoads.reduce(
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
    selfWeightN,
    iceWeightN,
    memberWindN,
    equipmentWeightN,
    equipmentWindN,
    extraHorizontalLoadN,
    extraVerticalLoadN,
    topHorizontalLoadN: horizontalN,
    topVerticalLoadN: verticalN,
    windDirectionDeg: parameters.windDirectionDeg,
  }
}
