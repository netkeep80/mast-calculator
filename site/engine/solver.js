import { relativeResidual, solveDenseSystem } from './linear-algebra.js'
import { dot3, norm3, sub3, unit3 } from './vector.js'

const degreeOfFreedom = (nodeId, axis) => nodeId * 3 + axis

export function analyzeTruss(model, loadCase, parameters) {
  const dofCount = model.nodes.length * 3
  const stiffness = Array.from({ length: dofCount }, () => new Array(dofCount).fill(0))
  const loadVector = new Array(dofCount).fill(0)

  for (const node of model.nodes) {
    const load = loadCase.nodalLoads[node.id]
    if (!load) throw new Error(`Не найдена нагрузка узла ${node.id}`)
    for (let axis = 0; axis < 3; axis += 1) {
      loadVector[degreeOfFreedom(node.id, axis)] = load[axis]
    }
  }

  let totalMassKg = 0
  for (const member of model.members) {
    const nodeA = model.nodes[member.nodeA]
    const nodeB = model.nodes[member.nodeB]
    if (!nodeA || !nodeB) throw new Error(`Некорректный стержень ${member.id}`)

    const delta = sub3(nodeB.position, nodeA.position)
    const lengthM = norm3(delta)
    const direction = unit3(delta)
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const axialStiffness = member.youngModulusPa * areaM2 / lengthM
    totalMassKg += areaM2 * lengthM * member.densityKgM3

    for (let rowAxis = 0; rowAxis < 3; rowAxis += 1) {
      for (let columnAxis = 0; columnAxis < 3; columnAxis += 1) {
        const value = axialStiffness * direction[rowAxis] * direction[columnAxis]
        stiffness[degreeOfFreedom(member.nodeA, rowAxis)][degreeOfFreedom(member.nodeA, columnAxis)] += value
        stiffness[degreeOfFreedom(member.nodeB, rowAxis)][degreeOfFreedom(member.nodeB, columnAxis)] += value
        stiffness[degreeOfFreedom(member.nodeA, rowAxis)][degreeOfFreedom(member.nodeB, columnAxis)] -= value
        stiffness[degreeOfFreedom(member.nodeB, rowAxis)][degreeOfFreedom(member.nodeA, columnAxis)] -= value
      }
    }
  }

  const freeDofs = []
  for (const node of model.nodes) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (!node.restrained[axis]) freeDofs.push(degreeOfFreedom(node.id, axis))
    }
  }

  const reducedStiffness = freeDofs.map((row) => freeDofs.map((column) => stiffness[row][column]))
  const reducedLoad = freeDofs.map((index) => loadVector[index])
  const solved = solveDenseSystem(reducedStiffness, reducedLoad)
  const residual = relativeResidual(reducedStiffness, solved.solution, reducedLoad)

  const displacementVector = new Array(dofCount).fill(0)
  freeDofs.forEach((globalDof, index) => {
    displacementVector[globalDof] = solved.solution[index]
  })

  const reactionVector = stiffness.map((row, rowIndex) => {
    let value = -loadVector[rowIndex]
    for (let column = 0; column < dofCount; column += 1) {
      value += row[column] * displacementVector[column]
    }
    return value
  })

  const displacements = model.nodes.map((node) => [
    displacementVector[degreeOfFreedom(node.id, 0)],
    displacementVector[degreeOfFreedom(node.id, 1)],
    displacementVector[degreeOfFreedom(node.id, 2)],
  ])
  const reactions = model.nodes.map((node) => [
    reactionVector[degreeOfFreedom(node.id, 0)],
    reactionVector[degreeOfFreedom(node.id, 1)],
    reactionVector[degreeOfFreedom(node.id, 2)],
  ])

  const memberResults = model.members.map((member) => {
    const nodeA = model.nodes[member.nodeA]
    const nodeB = model.nodes[member.nodeB]
    const lengthM = norm3(sub3(nodeB.position, nodeA.position))
    const direction = unit3(sub3(nodeB.position, nodeA.position))
    const relativeDisplacement = sub3(displacements[member.nodeB], displacements[member.nodeA])
    const axialExtensionM = dot3(relativeDisplacement, direction)
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const inertiaM4 = Math.PI * member.diameterM ** 4 / 64
    const axialForceN = member.youngModulusPa * areaM2 * axialExtensionM / lengthM
    const stressPa = axialForceN / areaM2
    const tensionCapacityN = member.yieldStrengthPa * areaM2 / parameters.materialSafetyFactor
    const eulerCapacityN = Math.PI ** 2 * member.youngModulusPa * inertiaM4
      / (member.effectiveLengthFactor * lengthM) ** 2
      / parameters.materialSafetyFactor
    const mode = axialForceN >= 0 ? 'tension' : 'compression'
    const designCapacityN = mode === 'tension'
      ? tensionCapacityN
      : Math.min(tensionCapacityN, eulerCapacityN)

    return {
      memberId: member.id,
      lengthM,
      axialForceN,
      stressPa,
      tensionCapacityN,
      eulerCapacityN,
      designCapacityN,
      utilization: Math.abs(axialForceN) / Math.max(designCapacityN, Number.EPSILON),
      mode,
    }
  })

  const maxDisplacementM = Math.max(...displacements.map(norm3))
  const maxTopDisplacementM = Math.max(...model.topNodeIds.map((nodeId) => norm3(displacements[nodeId])))
  const critical = memberResults.reduce((current, candidate) => (
    candidate.utilization > current.utilization ? candidate : current
  ), memberResults[0])

  return {
    displacements,
    reactions,
    memberResults,
    maxDisplacementM,
    maxTopDisplacementM,
    maxUtilization: critical.utilization,
    criticalMemberId: critical.memberId,
    totalMassKg,
    diagnostics: {
      relativeResidual: residual,
      minPivotRatio: solved.minPivotRatio,
      freeDofCount: freeDofs.length,
    },
  }
}
