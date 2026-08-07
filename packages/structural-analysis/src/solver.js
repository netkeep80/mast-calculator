import {
  addBandValue,
  createSymmetricBandMatrix,
  factorSymmetricBand,
  relativeBandResidual,
  solveSymmetricBandFactor,
} from '../../numerics/index.js'
import { calculateCriticalBucklingFactorBanded } from './buckling.js'
import { add3, cross3, norm3, scale3, sub3, unit3 } from '../../numerics/index.js'

const DOF_PER_NODE = 6
const degreeOfFreedom = (nodeId, axis) => nodeId * DOF_PER_NODE + axis
const zeroMatrix = (size) => Array.from({ length: size }, () => new Array(size).fill(0))
const zeroVector = (size) => new Float64Array(size)

const multiply3Vector = (matrix, vector) => [
  matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
  matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
  matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
]

function addSubmatrix(target, indices, values) {
  for (let row = 0; row < indices.length; row += 1) {
    for (let column = 0; column < indices.length; column += 1) {
      target[indices[row]][indices[column]] += values[row][column]
    }
  }
}

function localAxes(delta) {
  const ex = unit3(delta)
  const reference = Math.abs(ex[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
  const ey = unit3(cross3(reference, ex))
  const ez = unit3(cross3(ex, ey))
  return [ex, ey, ez]
}

function transformation12(rotation) {
  const transform = zeroMatrix(12)
  for (const offset of [0, 3, 6, 9]) {
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        transform[offset + row][offset + column] = rotation[row][column]
      }
    }
  }
  return transform
}

function multiplyMatrixVector(matrix, vector) {
  const result = new Float64Array(matrix.length)
  for (let row = 0; row < matrix.length; row += 1) {
    let value = 0
    for (let column = 0; column < vector.length; column += 1) value += matrix[row][column] * vector[column]
    result[row] = value
  }
  return result
}

function multiplyMatrices(left, right) {
  const rows = left.length
  const columns = right[0].length
  const inner = right.length
  const result = Array.from({ length: rows }, () => new Array(columns).fill(0))
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < inner; index += 1) {
      const factor = left[row][index]
      if (factor === 0) continue
      for (let column = 0; column < columns; column += 1) result[row][column] += factor * right[index][column]
    }
  }
  return result
}

function transposeMatrix(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]))
}

function transformMatrixToGlobal(local, transform) {
  return multiplyMatrices(multiplyMatrices(transposeMatrix(transform), local), transform)
}

function transformVectorToGlobal(local, transform) {
  return multiplyMatrixVector(transposeMatrix(transform), local)
}

function localFrameStiffness(E, G, area, inertia, torsionConstant, length) {
  const matrix = zeroMatrix(12)
  const axial = E * area / length
  const torsion = G * torsionConstant / length
  const bending = E * inertia
  const a = 12 * bending / length ** 3
  const b = 6 * bending / length ** 2
  const c = 4 * bending / length
  const d = 2 * bending / length

  addSubmatrix(matrix, [0, 6], [[axial, -axial], [-axial, axial]])
  addSubmatrix(matrix, [3, 9], [[torsion, -torsion], [-torsion, torsion]])
  addSubmatrix(matrix, [1, 5, 7, 11], [
    [a, b, -a, b],
    [b, c, -b, d],
    [-a, -b, a, -b],
    [b, d, -b, c],
  ])
  addSubmatrix(matrix, [2, 4, 8, 10], [
    [a, -b, -a, -b],
    [-b, c, b, d],
    [-a, b, a, b],
    [-b, d, b, c],
  ])
  return matrix
}

function localUniformLoadVector(distributedLocal, length) {
  const [qx, qy, qz] = distributedLocal
  const vector = zeroVector(12)
  vector[0] = qx * length / 2
  vector[6] = qx * length / 2
  vector[1] = qy * length / 2
  vector[5] = qy * length ** 2 / 12
  vector[7] = qy * length / 2
  vector[11] = -qy * length ** 2 / 12
  vector[2] = qz * length / 2
  vector[4] = -qz * length ** 2 / 12
  vector[8] = qz * length / 2
  vector[10] = qz * length ** 2 / 12
  return vector
}

function localGeometricStiffness(axialForceN, length) {
  const matrix = zeroMatrix(12)
  if (!Number.isFinite(axialForceN) || Math.abs(axialForceN) < 1e-12) return matrix
  const factor = axialForceN / (30 * length)
  const l = length
  const l2 = l * l
  const yz = [
    [36, 3 * l, -36, 3 * l],
    [3 * l, 4 * l2, -3 * l, -l2],
    [-36, -3 * l, 36, -3 * l],
    [3 * l, -l2, -3 * l, 4 * l2],
  ].map((row) => row.map((value) => value * factor))
  addSubmatrix(matrix, [1, 5, 7, 11], yz)
  const xz = [
    [36, -3 * l, -36, -3 * l],
    [-3 * l, 4 * l2, 3 * l, -l2],
    [-36, 3 * l, 36, 3 * l],
    [-3 * l, -l2, 3 * l, 4 * l2],
  ].map((row) => row.map((value) => value * factor))
  addSubmatrix(matrix, [2, 4, 8, 10], xz)
  return matrix
}

function elementGlobalDofs(member) {
  return [
    ...Array.from({ length: 6 }, (_, axis) => degreeOfFreedom(member.nodeA, axis)),
    ...Array.from({ length: 6 }, (_, axis) => degreeOfFreedom(member.nodeB, axis)),
  ]
}

function memberActionResult(localEndForces) {
  const axialA = -localEndForces[0]
  const axialB = localEndForces[6]
  return {
    axialForceAtAN: axialA,
    axialForceAtBN: axialB,
  }
}

function buildFreeDofs(model, dofCount) {
  const freeDofs = []
  const reducedIndexByGlobalDof = new Int32Array(dofCount).fill(-1)
  for (const node of model.nodes) {
    for (let axis = 0; axis < DOF_PER_NODE; axis += 1) {
      if (node.restrained[axis]) continue
      const globalDof = degreeOfFreedom(node.id, axis)
      reducedIndexByGlobalDof[globalDof] = freeDofs.length
      freeDofs.push(globalDof)
    }
  }
  return { freeDofs, reducedIndexByGlobalDof }
}

function elementGeometry(model, member, reducedIndexByGlobalDof) {
  const nodeA = model.nodes[member.nodeA]
  const nodeB = model.nodes[member.nodeB]
  if (!nodeA || !nodeB) throw new Error(`Некорректный стержень ${member.id}`)
  const delta = sub3(nodeB.position, nodeA.position)
  const lengthM = norm3(delta)
  const rotation = localAxes(delta)
  const transform = transformation12(rotation)
  const areaM2 = Math.PI * member.diameterM ** 2 / 4
  const inertiaM4 = Math.PI * member.diameterM ** 4 / 64
  const torsionConstantM4 = Math.PI * member.diameterM ** 4 / 32
  const shearModulusPa = member.youngModulusPa / (2 * (1 + member.poissonRatio))
  const localStiffness = localFrameStiffness(
    member.youngModulusPa,
    shearModulusPa,
    areaM2,
    inertiaM4,
    torsionConstantM4,
    lengthM,
  )
  const globalStiffness = transformMatrixToGlobal(localStiffness, transform)
  const dofs = elementGlobalDofs(member)
  const reducedDofs = dofs.map((dof) => reducedIndexByGlobalDof[dof])
  return {
    lengthM,
    rotation,
    transform,
    dofs,
    reducedDofs,
    areaM2,
    inertiaM4,
    torsionConstantM4,
    shearModulusPa,
    localStiffness,
    globalStiffness,
  }
}

function determineBandwidth(memberGeometry) {
  let bandwidth = 0
  for (const geometry of memberGeometry) {
    const reduced = geometry.reducedDofs.filter((index) => index >= 0)
    for (const left of reduced) {
      for (const right of reduced) bandwidth = Math.max(bandwidth, Math.abs(left - right))
    }
  }
  return bandwidth
}

function assembleElementBand(matrix, reducedDofs, values) {
  for (let localRow = 0; localRow < 12; localRow += 1) {
    const row = reducedDofs[localRow]
    if (row < 0) continue
    for (let localColumn = 0; localColumn < 12; localColumn += 1) {
      const column = reducedDofs[localColumn]
      if (column < 0 || row < column) continue
      addBandValue(matrix, row, column, values[localRow][localColumn])
    }
  }
}

export function compileFrameSystem(model, parameters = {}) {
  const dofCount = model.nodes.length * DOF_PER_NODE
  const { freeDofs, reducedIndexByGlobalDof } = buildFreeDofs(model, dofCount)
  const geometry = model.members.map((member) => elementGeometry(model, member, reducedIndexByGlobalDof))
  const bandwidth = determineBandwidth(geometry)
  const reducedStiffness = createSymmetricBandMatrix(freeDofs.length, bandwidth)
  for (const member of model.members) {
    const item = geometry[member.id]
    assembleElementBand(reducedStiffness, item.reducedDofs, item.globalStiffness)
  }
  const factorization = factorSymmetricBand(reducedStiffness)
  const totalMassKg = model.members.reduce(
    (sum, member) => sum + geometry[member.id].areaM2 * geometry[member.id].lengthM * member.densityKgM3,
    0,
  )
  return {
    method: 'symmetric-band-cholesky',
    dofCount,
    freeDofs,
    reducedIndexByGlobalDof,
    reducedStiffness,
    factorization,
    bandwidth,
    memberGeometry: geometry,
    totalMassKg,
    factorizationCount: 1,
    parameters,
  }
}

function assembleLoadVector(model, loadCase, system) {
  const loadVector = zeroVector(system.dofCount)
  for (const node of model.nodes) {
    const force = loadCase.nodalLoads[node.id]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    if (!force) throw new Error(`Не найдена нагрузка узла ${node.id}`)
    for (let axis = 0; axis < 3; axis += 1) {
      loadVector[degreeOfFreedom(node.id, axis)] += force[axis]
      loadVector[degreeOfFreedom(node.id, axis + 3)] += moment[axis]
    }
  }

  const memberLoads = model.members.map((member) => {
    const geometry = system.memberGeometry[member.id]
    const distributedGlobal = loadCase.memberDistributedLoads?.[member.id] ?? [0, 0, 0]
    const distributedLocal = multiply3Vector(geometry.rotation, distributedGlobal)
    const localEquivalentLoad = localUniformLoadVector(distributedLocal, geometry.lengthM)
    const globalEquivalentLoad = transformVectorToGlobal(localEquivalentLoad, geometry.transform)
    for (let index = 0; index < 12; index += 1) loadVector[geometry.dofs[index]] += globalEquivalentLoad[index]
    return { distributedGlobal, distributedLocal, localEquivalentLoad }
  })
  return { loadVector, memberLoads }
}

function buildDisplacements(model, system, solution) {
  const displacementVector = zeroVector(system.dofCount)
  system.freeDofs.forEach((globalDof, index) => { displacementVector[globalDof] = solution[index] })
  const displacements = model.nodes.map((node) => [
    displacementVector[degreeOfFreedom(node.id, 0)],
    displacementVector[degreeOfFreedom(node.id, 1)],
    displacementVector[degreeOfFreedom(node.id, 2)],
  ])
  const rotations = model.nodes.map((node) => [
    displacementVector[degreeOfFreedom(node.id, 3)],
    displacementVector[degreeOfFreedom(node.id, 4)],
    displacementVector[degreeOfFreedom(node.id, 5)],
  ])
  return { displacementVector, displacements, rotations }
}

function calculateMemberResults(model, parameters, system, memberLoads, displacementVector) {
  const equilibriumVector = zeroVector(system.dofCount)
  const memberResults = model.members.map((member) => {
    const geometry = system.memberGeometry[member.id]
    const load = memberLoads[member.id]
    const elementDisplacementGlobal = Float64Array.from(geometry.dofs, (dof) => displacementVector[dof])
    const elementDisplacementLocal = multiplyMatrixVector(geometry.transform, elementDisplacementGlobal)
    const elasticEndForces = multiplyMatrixVector(geometry.localStiffness, elementDisplacementLocal)
    const localEndForces = Float64Array.from(
      elasticEndForces,
      (value, dof) => value - load.localEquivalentLoad[dof],
    )
    const globalEndForces = transformVectorToGlobal(localEndForces, geometry.transform)
    for (let index = 0; index < 12; index += 1) equilibriumVector[geometry.dofs[index]] += globalEndForces[index]
    return {
      memberId: member.id,
      lengthM: geometry.lengthM,
      localAxes: geometry.rotation.map((axis) => [...axis]),
      distributedLoadLocalNPerM: [...load.distributedLocal],
      localEndForces: [...localEndForces],
      ...memberActionResult(localEndForces),
    }
  })
  return { memberResults, equilibriumVector }
}

function subtractDirectLoads(model, loadCase, equilibriumVector) {
  for (const node of model.nodes) {
    const force = loadCase.nodalLoads[node.id] ?? [0, 0, 0]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      equilibriumVector[degreeOfFreedom(node.id, axis)] -= force[axis]
      equilibriumVector[degreeOfFreedom(node.id, axis + 3)] -= moment[axis]
    }
  }
}

function buildBuckling(model, system, memberResults) {
  const geometric = createSymmetricBandMatrix(system.freeDofs.length, system.bandwidth)
  for (const member of model.members) {
    const geometry = system.memberGeometry[member.id]
    const result = memberResults[member.id]
    const averageAxialN = (result.axialForceAtAN + result.axialForceAtBN) / 2
    const local = localGeometricStiffness(averageAxialN, geometry.lengthM)
    const global = transformMatrixToGlobal(local, geometry.transform)
    assembleElementBand(geometric, geometry.reducedDofs, global)
  }
  return calculateCriticalBucklingFactorBanded(
    system.reducedStiffness,
    system.factorization,
    geometric,
  )
}

function physicalMomentResidual(model, loadCase, memberLoads, system, reactions, reactionMoments) {
  let externalMoment = [0, 0, 0]
  let reactionMoment = [0, 0, 0]
  let momentScale = 1
  for (const node of model.nodes) {
    const nodalLoad = loadCase.nodalLoads[node.id]
    const nodalMoment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    const loadMoment = add3(cross3(node.position, nodalLoad), nodalMoment)
    externalMoment = add3(externalMoment, loadMoment)
    momentScale = Math.max(momentScale, norm3(loadMoment))
    if (node.restrained.some(Boolean)) {
      const supportMoment = add3(cross3(node.position, reactions[node.id]), reactionMoments[node.id])
      reactionMoment = add3(reactionMoment, supportMoment)
      momentScale = Math.max(momentScale, norm3(supportMoment))
    }
  }
  for (const member of model.members) {
    const geometry = system.memberGeometry[member.id]
    const nodeA = model.nodes[member.nodeA]
    const nodeB = model.nodes[member.nodeB]
    const midpoint = scale3(add3(nodeA.position, nodeB.position), 0.5)
    const distributedResultant = scale3(memberLoads[member.id].distributedGlobal, geometry.lengthM)
    const loadMoment = cross3(midpoint, distributedResultant)
    externalMoment = add3(externalMoment, loadMoment)
    momentScale = Math.max(momentScale, norm3(loadMoment))
  }
  return norm3(add3(externalMoment, reactionMoment)) / momentScale
}

export function analyzeFrame(model, loadCase, parameters, compiledSystem = null) {
  const system = compiledSystem ?? compileFrameSystem(model, parameters)
  const { loadVector, memberLoads } = assembleLoadVector(model, loadCase, system)
  const reducedLoad = Float64Array.from(system.freeDofs, (globalDof) => loadVector[globalDof])
  const solution = solveSymmetricBandFactor(system.factorization, reducedLoad)
  const residual = relativeBandResidual(system.reducedStiffness, solution, reducedLoad)
  const { displacementVector, displacements, rotations } = buildDisplacements(model, system, solution)
  const { memberResults, equilibriumVector } = calculateMemberResults(
    model,
    parameters,
    system,
    memberLoads,
    displacementVector,
  )
  subtractDirectLoads(model, loadCase, equilibriumVector)

  const reactions = model.nodes.map((node) => [
    equilibriumVector[degreeOfFreedom(node.id, 0)],
    equilibriumVector[degreeOfFreedom(node.id, 1)],
    equilibriumVector[degreeOfFreedom(node.id, 2)],
  ])
  const reactionMoments = model.nodes.map((node) => [
    equilibriumVector[degreeOfFreedom(node.id, 3)],
    equilibriumVector[degreeOfFreedom(node.id, 4)],
    equilibriumVector[degreeOfFreedom(node.id, 5)],
  ])

  let maximumFreeResidual = 0
  for (const globalDof of system.freeDofs) maximumFreeResidual = Math.max(maximumFreeResidual, Math.abs(equilibriumVector[globalDof]))
  const loadScale = Math.max(1, ...loadVector.map(Math.abs))
  const maximumNodeEquilibriumResidual = maximumFreeResidual / loadScale
  const globalMomentResidual = physicalMomentResidual(
    model,
    loadCase,
    memberLoads,
    system,
    reactions,
    reactionMoments,
  )

  const buckling = buildBuckling(model, system, memberResults)
  const bucklingModeVector = zeroVector(system.dofCount)
  system.freeDofs.forEach((globalDof, index) => { bucklingModeVector[globalDof] = buckling.mode[index] ?? 0 })
  const bucklingMode = model.nodes.map((node) => [
    bucklingModeVector[degreeOfFreedom(node.id, 0)],
    bucklingModeVector[degreeOfFreedom(node.id, 1)],
    bucklingModeVector[degreeOfFreedom(node.id, 2)],
  ])
  const bucklingRotations = model.nodes.map((node) => [
    bucklingModeVector[degreeOfFreedom(node.id, 3)],
    bucklingModeVector[degreeOfFreedom(node.id, 4)],
    bucklingModeVector[degreeOfFreedom(node.id, 5)],
  ])

  const maxDisplacementM = Math.max(...displacements.map(norm3))
  const maxTopDisplacementM = Math.max(...model.topNodeIds.map((nodeId) => norm3(displacements[nodeId])))
  return {
    solver: 'linear-3d-frame-euler-bernoulli',
    linearSystemSolver: system.method,
    degreesOfFreedomPerNode: DOF_PER_NODE,
    displacements,
    rotations,
    reactions,
    reactionMoments,
    memberResults,
    maxDisplacementM,
    maxTopDisplacementM,
    maxUtilization: null,
    criticalMemberId: null,
    totalMassKg: system.totalMassKg,
    buckling: {
      criticalLoadFactor: buckling.factor,
      mode: bucklingMode,
      rotations: bucklingRotations,
      residual: buckling.residual,
      eigenResidual: buckling.eigenResidual,
      iterations: buckling.iterations,
    },
    diagnostics: {
      relativeResidual: residual,
      minPivotRatio: system.factorization.minPivotRatio,
      freeDofCount: system.freeDofs.length,
      stiffnessBandwidth: system.bandwidth,
      stiffnessFactorizationCount: system.factorizationCount,
      maximumNodeEquilibriumResidual,
      globalMomentResidual,
    },
  }
}

export const analyzeTruss = analyzeFrame
