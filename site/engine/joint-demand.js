const EPSILON_M = 1e-9

const add3 = (left, right) => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2],
]
const scale3 = (value, scalar) => value.map((component) => component * scalar)
const dot3 = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
const norm3 = (value) => Math.hypot(value[0], value[1], value[2])
const sub3 = (left, right) => left.map((value, index) => value - right[index])

function localToGlobal(local, axes) {
  return [0, 1, 2].map((globalAxis) => (
    axes[0][globalAxis] * local[0]
    + axes[1][globalAxis] * local[1]
    + axes[2][globalAxis] * local[2]
  ))
}

function memberEndAtNode(model, analysis, member, nodeId) {
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

function incidentMembers(model, nodeId) {
  return model.members.filter((member) => member.nodeA === nodeId || member.nodeB === nodeId)
}

function otherNode(model, member, nodeId) {
  return model.nodes[member.nodeA === nodeId ? member.nodeB : member.nodeA]
}

export function splitJointDemandForBolt(forceGlobalN, momentGlobalNm, options = {}) {
  const axis = options.boltAxis ?? [0, 0, 1]
  const axisNorm = norm3(axis)
  if (!(axisNorm > Number.EPSILON)) throw new Error('Ось соединительного болта не может быть нулевой')
  const unitAxis = scale3(axis, 1 / axisNorm)
  const leverArmMm = Number(options.jointEffectiveRadiusMm)
  if (!Number.isFinite(leverArmMm) || leverArmMm <= 0) {
    throw new Error('Эффективный радиус межмодульного узла должен быть положительным')
  }
  const leverArmM = leverArmMm / 1000

  // localEndForces — силы, действующие на отсечённую верхнюю часть member.
  // Для upward member положительная проекция на +boltAxis соответствует
  // сжатию стыка: верхняя часть получает вверх реакцию нижней. Она не
  // растягивает болт. Отрицательная проекция означает разделяющее усилие.
  const signedAxialForceN = dot3(forceGlobalN, unitAxis)
  const directTensionN = Math.max(0, -signedAxialForceN)
  const contactCompressionN = Math.max(0, signedAxialForceN)
  const directShearVectorN = sub3(forceGlobalN, scale3(unitAxis, signedAxialForceN))
  const directShearN = norm3(directShearVectorN)
  const torsionNm = Math.abs(dot3(momentGlobalNm, unitAxis))
  const bendingMomentVectorNm = sub3(momentGlobalNm, scale3(unitAxis, dot3(momentGlobalNm, unitAxis)))
  const bendingMomentNm = norm3(bendingMomentVectorNm)
  const momentEquivalentTensionN = bendingMomentNm / leverArmM
  const torsionEquivalentShearN = torsionNm / leverArmM

  // Compression is not converted into fictitious bolt tension. To remain
  // conservative without an exact contact-pressure model, however, it also
  // is not credited as relief against the prying component M/r_eff.
  const tensionN = directTensionN + momentEquivalentTensionN

  return {
    boltAxis: [...unitAxis],
    jointEffectiveRadiusMm: leverArmMm,
    forceGlobalN: [...forceGlobalN],
    momentGlobalNm: [...momentGlobalNm],
    signedAxialForceN,
    directTensionN,
    contactCompressionN,
    directShearN,
    bendingMomentNm,
    torsionNm,
    momentEquivalentTensionN,
    torsionEquivalentShearN,
    tensionN,
    shearN: directShearN + torsionEquivalentShearN,
  }
}

export function buildIntermoduleJointResultants(model, analysis) {
  const elevations = model.nodes.map((node) => node.position[2])
  const minimumZ = Math.min(...elevations)
  const maximumZ = Math.max(...elevations)
  const moduleHeightM = (maximumZ - minimumZ) / Math.max(1, model.moduleCount)
  const resultants = []

  for (const node of model.nodes) {
    const z = node.position[2]
    if (z <= minimumZ + EPSILON_M || z >= maximumZ - EPSILON_M) continue
    const incident = incidentMembers(model, node.id)
    const upperMembers = incident.filter((member) => otherNode(model, member, node.id).position[2] > z + EPSILON_M)
    if (upperMembers.length !== 2) {
      throw new Error(`Межмодульный узел ${node.id}: ожидались два ребра верхней ножки, найдено ${upperMembers.length}`)
    }

    let forceGlobalN = [0, 0, 0]
    let momentGlobalNm = [0, 0, 0]
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

export function buildIntermoduleJointDemands(model, analysis, options = {}) {
  return buildIntermoduleJointResultants(model, analysis).map((resultant) => ({
    ...resultant,
    ...splitJointDemandForBolt(resultant.forceGlobalN, resultant.momentGlobalNm, options),
  }))
}

export function memberEndWeldDemand(member, result, end) {
  const offset = end === 'A' ? 0 : 6
  if (!result?.localEndForces?.length) throw new Error(`Для ребра ${member.id} отсутствуют end-forces`)
  const forces = result.localEndForces
  return {
    memberId: member.id,
    end,
    nodeId: end === 'A' ? member.nodeA : member.nodeB,
    axialForceN: forces[offset],
    shearForceN: Math.hypot(forces[offset + 1], forces[offset + 2]),
    torsionNm: forces[offset + 3],
    bendingNm: Math.hypot(forces[offset + 4], forces[offset + 5]),
  }
}

export function buildMemberEndWeldDemands(model, analysis) {
  const demands = []
  for (const member of model.members) {
    const result = analysis.memberResults[member.id]
    demands.push(memberEndWeldDemand(member, result, 'A'))
    demands.push(memberEndWeldDemand(member, result, 'B'))
  }
  return demands
}
