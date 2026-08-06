import { dot3, norm3, sub3, unit3 } from './vector.js'

const GRAVITY = 9.80665

export function buildLoadCase(model, parameters) {
  const loads = model.nodes.map(() => [0, 0, 0])
  const directionRad = parameters.windDirectionDeg * Math.PI / 180
  const wind = [Math.cos(directionRad), Math.sin(directionRad), 0]
  const iceThicknessM = Math.max(0, parameters.iceThicknessMm ?? 0) / 1000
  const iceDensityKgM3 = Math.max(0, parameters.iceDensityKgM3 ?? 900)
  let selfWeightN = 0
  let iceWeightN = 0
  let memberWindN = 0

  const addNodeLoad = (nodeId, load) => {
    const target = loads[nodeId]
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
    const steelAreaM2 = Math.PI * member.diameterM ** 2 / 4
    const outerDiameterM = member.diameterM + 2 * iceThicknessM
    const iceAreaM2 = Math.PI * Math.max(0, outerDiameterM ** 2 - member.diameterM ** 2) / 4
    const steelWeightN = member.densityKgM3 * steelAreaM2 * lengthM * GRAVITY * parameters.deadLoadFactor
    const memberIceWeightN = iceDensityKgM3 * iceAreaM2 * lengthM * GRAVITY * parameters.deadLoadFactor
    selfWeightN += steelWeightN
    iceWeightN += memberIceWeightN
    const gravityLoad = steelWeightN + memberIceWeightN
    addNodeLoad(member.nodeA, [0, 0, -gravityLoad / 2])
    addNodeLoad(member.nodeB, [0, 0, -gravityLoad / 2])

    const axis = unit3(delta)
    const projectedLengthM = lengthM * Math.sqrt(Math.max(0, 1 - dot3(axis, wind) ** 2))
    const windForceN = parameters.windPressurePa
      * parameters.dragCoefficient
      * outerDiameterM
      * projectedLengthM
      * parameters.windLoadFactor
    memberWindN += windForceN
    const halfWind = [wind[0] * windForceN / 2, wind[1] * windForceN / 2, 0]
    addNodeLoad(member.nodeA, halfWind)
    addNodeLoad(member.nodeB, halfWind)
  }

  const equipmentWeightN = parameters.equipmentMassKg * GRAVITY * parameters.equipmentLoadFactor
  const equipmentWindN = parameters.windPressurePa
    * parameters.equipmentDragCoefficient
    * parameters.equipmentWindAreaM2
    * parameters.windLoadFactor
  const horizontalN = equipmentWindN + parameters.extraHorizontalLoadN
  const verticalN = equipmentWeightN + parameters.extraVerticalLoadN

  for (const nodeId of model.topNodeIds) {
    addNodeLoad(nodeId, [wind[0] * horizontalN / 3, wind[1] * horizontalN / 3, -verticalN / 3])
  }

  const totalAppliedLoad = loads.reduce(
    (sum, load) => [sum[0] + load[0], sum[1] + load[1], sum[2] + load[2]],
    [0, 0, 0],
  )

  return {
    nodalLoads: loads,
    totalAppliedLoad,
    selfWeightN,
    iceWeightN,
    memberWindN,
    equipmentWindN,
    windDirectionDeg: parameters.windDirectionDeg,
  }
}
