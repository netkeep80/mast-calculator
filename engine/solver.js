import { calculateCriticalBucklingFactor } from './buckling.js'
import { relativeResidual, solveDenseSystem } from './linear-algebra.js'
import { add3, cross3, dot3, norm3, scale3, sub3, unit3 } from './vector.js'

const degreeOfFreedom = (nodeId, axis) => nodeId * 3 + axis
const zeroMatrix = (size) => Array.from({ length: size }, () => new Array(size).fill(0))

function addMemberMatrix(target, nodeA, nodeB, block) {
  for (let rowAxis = 0; rowAxis < 3; rowAxis += 1) {
    for (let columnAxis = 0; columnAxis < 3; columnAxis += 1) {
      const value = block[rowAxis][columnAxis]
      target[degreeOfFreedom(nodeA, rowAxis)][degreeOfFreedom(nodeA, columnAxis)] += value
      target[degreeOfFreedom(nodeB, rowAxis)][degreeOfFreedom(nodeB, columnAxis)] += value
      target[degreeOfFreedom(nodeA, rowAxis)][degreeOfFreedom(nodeB, columnAxis)] -= value
      target[degreeOfFreedom(nodeB, rowAxis)][degreeOfFreedom(nodeA, columnAxis)] -= value
    }
  }
}

export function analyzeTruss(model, loadCase, parameters) {
  const dofCount = model.nodes.length * 3
  const stiffness = zeroMatrix(dofCount)
  const loadVector = new Array(dofCount).fill(0)

  for (const node of model.nodes) {
    const load = loadCase.nodalLoads[node.id]
    if (!load) throw new Error(`Не найдена нагрузка узла ${node.id}`)
    for (let axis = 0; axis < 3; axis += 1) loadVector[degreeOfFreedom(node.id, axis)] = load[axis]
  }

  let totalMassKg = 0
  const memberGeometry = model.members.map((member) => {
    const nodeA = model.nodes[member.nodeA]
    const nodeB = model.nodes[member.nodeB]
    if (!nodeA || !nodeB) throw new Error(`Некорректный стержень ${member.id}`)
    const delta = sub3(nodeB.position, nodeA.position)
    const lengthM = norm3(delta)
    const direction = unit3(delta)
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const inertiaM4 = Math.PI * member.diameterM ** 4 / 64
    const axialStiffness = member.youngModulusPa * areaM2 / lengthM
    totalMassKg += areaM2 * lengthM * member.densityKgM3
    const block = Array.from({ length: 3 }, (_, row) => (
      Array.from({ length: 3 }, (_, column) => axialStiffness * direction[row] * direction[column])
    ))
    addMemberMatrix(stiffness, member.nodeA, member.nodeB, block)
    return { lengthM, direction, areaM2, inertiaM4 }
  })

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
  freeDofs.forEach((globalDof, index) => { displacementVector[globalDof] = solved.solution[index] })

  const reactionVector = stiffness.map((row, rowIndex) => {
    let value = -loadVector[rowIndex]
    for (let column = 0; column < dofCount; column += 1) value += row[column] * displacementVector[column]
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

  const memberResults = model.members.map((member, index) => {
    const geometry = memberGeometry[index]
    const relativeDisplacement = sub3(displacements[member.nodeB], displacements[member.nodeA])
    const axialExtensionM = dot3(relativeDisplacement, geometry.direction)
    const axialForceN = member.youngModulusPa * geometry.areaM2 * axialExtensionM / geometry.lengthM
    const stressPa = axialForceN / geometry.areaM2
    const tensionCapacityN = member.yieldStrengthPa * geometry.areaM2 / parameters.materialSafetyFactor
    const effectiveLengthM = member.effectiveLengthFactor * geometry.lengthM
    const eulerCapacityN = Math.PI ** 2 * member.youngModulusPa * geometry.inertiaM4
      / effectiveLengthM ** 2
      / parameters.materialSafetyFactor
    const radiusOfGyrationM = Math.sqrt(geometry.inertiaM4 / geometry.areaM2)
    const slenderness = effectiveLengthM / radiusOfGyrationM
    const mode = axialForceN >= 0 ? 'tension' : 'compression'
    const designCapacityN = mode === 'tension' ? tensionCapacityN : Math.min(tensionCapacityN, eulerCapacityN)

    return {
      memberId: member.id,
      lengthM: geometry.lengthM,
      axialForceN,
      stressPa,
      tensionCapacityN,
      eulerCapacityN,
      designCapacityN,
      slenderness,
      utilization: Math.abs(axialForceN) / Math.max(designCapacityN, Number.EPSILON),
      mode,
    }
  })

  const geometricStiffness = zeroMatrix(dofCount)
  for (const member of model.members) {
    const geometry = memberGeometry[member.id]
    const axialForceN = memberResults[member.id].axialForceN
    const coefficient = axialForceN / geometry.lengthM
    const block = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => (
      coefficient * ((row === column ? 1 : 0) - geometry.direction[row] * geometry.direction[column])
    )))
    addMemberMatrix(geometricStiffness, member.nodeA, member.nodeB, block)
  }
  const reducedGeometric = freeDofs.map((row) => freeDofs.map((column) => geometricStiffness[row][column]))
  const buckling = calculateCriticalBucklingFactor(reducedStiffness, reducedGeometric)
  const bucklingModeVector = new Array(dofCount).fill(0)
  freeDofs.forEach((globalDof, index) => { bucklingModeVector[globalDof] = buckling.mode[index] ?? 0 })
  const bucklingMode = model.nodes.map((node) => [
    bucklingModeVector[degreeOfFreedom(node.id, 0)],
    bucklingModeVector[degreeOfFreedom(node.id, 1)],
    bucklingModeVector[degreeOfFreedom(node.id, 2)],
  ])

  const nodeResiduals = model.nodes.map((node) => add3(loadCase.nodalLoads[node.id], reactions[node.id]))
  for (const member of model.members) {
    const force = scale3(memberGeometry[member.id].direction, memberResults[member.id].axialForceN)
    nodeResiduals[member.nodeA] = add3(nodeResiduals[member.nodeA], force)
    nodeResiduals[member.nodeB] = sub3(nodeResiduals[member.nodeB], force)
  }
  const loadScale = Math.max(1, ...loadCase.nodalLoads.map(norm3))
  const maximumNodeEquilibriumResidual = Math.max(...nodeResiduals.map(norm3)) / loadScale

  let momentResidual = [0, 0, 0]
  let momentScale = 1
  for (const node of model.nodes) {
    const external = add3(loadCase.nodalLoads[node.id], reactions[node.id])
    const moment = cross3(node.position, external)
    momentResidual = add3(momentResidual, moment)
    momentScale = Math.max(momentScale, norm3(moment))
  }

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
    buckling: {
      criticalLoadFactor: buckling.factor,
      mode: bucklingMode,
      residual: buckling.residual,
      eigenResidual: buckling.eigenResidual,
      iterations: buckling.iterations,
    },
    diagnostics: {
      relativeResidual: residual,
      minPivotRatio: solved.minPivotRatio,
      freeDofCount: freeDofs.length,
      maximumNodeEquilibriumResidual,
      globalMomentResidual: norm3(momentResidual) / momentScale,
    },
  }
}
