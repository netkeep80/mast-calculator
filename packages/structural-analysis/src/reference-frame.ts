import { calculateCriticalBucklingFactor } from './buckling.js'
import type { GeneratedMastModel } from './geometry.js'
import type { BuiltLoadCase } from './loads.js'
import { relativeResidual, solveDenseSystem, type NumericMatrix } from '../../numerics/index.js'

// Verification-only third solver. It intentionally does not import solver.js,
// module-stack.js or banded.js: geometry, element matrices, load assembly and
// member-force recovery are implemented here independently so CI can detect a
// shared implementation error in the two production solve paths.

const DOF_PER_NODE = 6
const ZERO_TOLERANCE = 1e-12

type DenseMatrix = number[][]
type Vector3 = readonly [number, number, number]
type MutableVector3 = [number, number, number]
type MastMember = GeneratedMastModel['members'][number]
type Rotation3 = [MutableVector3, MutableVector3, MutableVector3]

interface ReferenceMemberGeometry {
  memberId: number
  lengthM: number
  rotation: Rotation3
  transform: DenseMatrix
  dofs: number[]
  reducedDofs: number[]
  localStiffness: DenseMatrix
  globalStiffness: DenseMatrix
  areaM2: number
  inertiaM4: number
  torsionConstantM4: number
  shearModulusPa: number
}

export interface IndependentDenseSystem {
  method: 'independent-dense-gaussian-reference-v1'
  dofCount: number
  freeDofs: number[]
  reducedIndex: Int32Array
  reducedStiffness: DenseMatrix
  memberGeometry: ReferenceMemberGeometry[]
}

interface ReferenceMemberLoad {
  distributedGlobal: Vector3
  distributedLocal: number[]
  localEquivalentLoad: number[]
}

export interface IndependentDenseOptions {
  includeBuckling?: boolean
}

const globalDof = (nodeId: number, axis: number): number => nodeId * DOF_PER_NODE + axis
const zeroVector = (size: number): number[] => new Array<number>(size).fill(0)
const zeroMatrix = (rows: number, columns = rows): DenseMatrix => Array.from(
  { length: rows },
  () => new Array<number>(columns).fill(0),
)

const subtract3 = (left: Vector3, right: Vector3): MutableVector3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
]

const cross3 = (left: Vector3, right: Vector3): MutableVector3 => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
]

const norm3 = (value: Vector3): number => Math.hypot(value[0], value[1], value[2])

function unit3(value: Vector3): MutableVector3 {
  const length = norm3(value)
  if (!(length > ZERO_TOLERANCE)) throw new Error('Reference solver: нулевая длина вектора')
  return [value[0] / length, value[1] / length, value[2] / length]
}

function localAxes(delta: Vector3): Rotation3 {
  const x = unit3(delta)
  const reference: MutableVector3 = Math.abs(x[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
  const y = unit3(cross3(reference, x))
  const z = unit3(cross3(x, y))
  return [x, y, z]
}

function transformation12(rotation: Rotation3): DenseMatrix {
  const transform = zeroMatrix(12)
  for (const offset of [0, 3, 6, 9]) {
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        transform[offset + row]![offset + column] = rotation[row]![column]!
      }
    }
  }
  return transform
}

function transpose(matrix: DenseMatrix): DenseMatrix {
  return Array.from({ length: matrix[0]?.length ?? 0 }, (_, column) => (
    matrix.map((row) => row[column]!)
  ))
}

function multiplyMatrices(left: DenseMatrix, right: DenseMatrix): DenseMatrix {
  const result = zeroMatrix(left.length, right[0]?.length ?? 0)
  for (let row = 0; row < left.length; row += 1) {
    for (let shared = 0; shared < right.length; shared += 1) {
      const factor = left[row]![shared]!
      if (factor === 0) continue
      for (let column = 0; column < result[row]!.length; column += 1) {
        result[row]![column] = result[row]![column]! + factor * right[shared]![column]!
      }
    }
  }
  return result
}

function multiplyMatrixVector(matrix: readonly (readonly number[])[], vector: ArrayLike<number>): number[] {
  return matrix.map((row) => row.reduce(
    (sum, value, column) => sum + value * vector[column]!,
    0,
  ))
}

function transformMatrixToGlobal(localMatrix: DenseMatrix, transform: DenseMatrix): DenseMatrix {
  return multiplyMatrices(multiplyMatrices(transpose(transform), localMatrix), transform)
}

function transformVectorToGlobal(localVector: ArrayLike<number>, transform: DenseMatrix): number[] {
  return multiplyMatrixVector(transpose(transform), localVector)
}

function addSubmatrix(target: DenseMatrix, indices: readonly number[], values: readonly (readonly number[])[]): void {
  for (let row = 0; row < indices.length; row += 1) {
    for (let column = 0; column < indices.length; column += 1) {
      const targetRow = target[indices[row]!]!
      const targetColumn = indices[column]!
      targetRow[targetColumn] = targetRow[targetColumn]! + values[row]![column]!
    }
  }
}

function localElasticStiffness(member: MastMember, lengthM: number) {
  const diameter = member.diameterM
  const area = Math.PI * diameter ** 2 / 4
  const inertia = Math.PI * diameter ** 4 / 64
  const torsionConstant = Math.PI * diameter ** 4 / 32
  const shearModulus = member.youngModulusPa / (2 * (1 + member.poissonRatio))
  const axial = member.youngModulusPa * area / lengthM
  const torsion = shearModulus * torsionConstant / lengthM
  const bending = member.youngModulusPa * inertia
  const k12 = 12 * bending / lengthM ** 3
  const k6 = 6 * bending / lengthM ** 2
  const k4 = 4 * bending / lengthM
  const k2 = 2 * bending / lengthM
  const matrix = zeroMatrix(12)

  addSubmatrix(matrix, [0, 6], [[axial, -axial], [-axial, axial]])
  addSubmatrix(matrix, [3, 9], [[torsion, -torsion], [-torsion, torsion]])
  addSubmatrix(matrix, [1, 5, 7, 11], [
    [k12, k6, -k12, k6],
    [k6, k4, -k6, k2],
    [-k12, -k6, k12, -k6],
    [k6, k2, -k6, k4],
  ])
  addSubmatrix(matrix, [2, 4, 8, 10], [
    [k12, -k6, -k12, -k6],
    [-k6, k4, k6, k2],
    [-k12, k6, k12, k6],
    [-k6, k2, k6, k4],
  ])

  return { matrix, area, inertia, torsionConstant, shearModulus }
}

function localUniformLoad(distributedLocal: ArrayLike<number>, lengthM: number): number[] {
  const qx = distributedLocal[0]!
  const qy = distributedLocal[1]!
  const qz = distributedLocal[2]!
  const equivalent = zeroVector(12)
  equivalent[0] = qx * lengthM / 2
  equivalent[6] = qx * lengthM / 2
  equivalent[1] = qy * lengthM / 2
  equivalent[5] = qy * lengthM ** 2 / 12
  equivalent[7] = qy * lengthM / 2
  equivalent[11] = -qy * lengthM ** 2 / 12
  equivalent[2] = qz * lengthM / 2
  equivalent[4] = -qz * lengthM ** 2 / 12
  equivalent[8] = qz * lengthM / 2
  equivalent[10] = qz * lengthM ** 2 / 12
  return equivalent
}

function localGeometricStiffness(axialForceN: number, lengthM: number): DenseMatrix {
  const matrix = zeroMatrix(12)
  if (!Number.isFinite(axialForceN) || Math.abs(axialForceN) < ZERO_TOLERANCE) return matrix
  const factor = axialForceN / (30 * lengthM)
  const l2 = lengthM ** 2
  const yz = [
    [36, 3 * lengthM, -36, 3 * lengthM],
    [3 * lengthM, 4 * l2, -3 * lengthM, -l2],
    [-36, -3 * lengthM, 36, -3 * lengthM],
    [3 * lengthM, -l2, -3 * lengthM, 4 * l2],
  ].map((row) => row.map((value) => value * factor))
  addSubmatrix(matrix, [1, 5, 7, 11], yz)
  const xz = [
    [36, -3 * lengthM, -36, -3 * lengthM],
    [-3 * lengthM, 4 * l2, 3 * lengthM, -l2],
    [-36, 3 * lengthM, 36, 3 * lengthM],
    [-3 * lengthM, -l2, 3 * lengthM, 4 * l2],
  ].map((row) => row.map((value) => value * factor))
  addSubmatrix(matrix, [2, 4, 8, 10], xz)
  return matrix
}

function memberGlobalDofs(member: MastMember): number[] {
  return [
    ...Array.from({ length: DOF_PER_NODE }, (_, axis) => globalDof(member.nodeA, axis)),
    ...Array.from({ length: DOF_PER_NODE }, (_, axis) => globalDof(member.nodeB, axis)),
  ]
}

function buildFreeDofMap(model: GeneratedMastModel) {
  const dofCount = model.nodes.length * DOF_PER_NODE
  const freeDofs: number[] = []
  const reducedIndex = new Int32Array(dofCount).fill(-1)
  for (const node of model.nodes) {
    for (let axis = 0; axis < DOF_PER_NODE; axis += 1) {
      if (node.restrained[axis]) continue
      const dof = globalDof(node.id, axis)
      reducedIndex[dof] = freeDofs.length
      freeDofs.push(dof)
    }
  }
  return { dofCount, freeDofs, reducedIndex }
}

function independentMemberGeometry(
  model: GeneratedMastModel,
  member: MastMember,
  reducedIndex: Int32Array,
): ReferenceMemberGeometry {
  const start = model.nodes[member.nodeA]?.position
  const end = model.nodes[member.nodeB]?.position
  if (!start || !end) throw new Error(`Reference solver: некорректное ребро ${member.id}`)
  const delta = subtract3(start, end).map((value) => -value) as MutableVector3
  const lengthM = norm3(delta)
  if (!(lengthM > ZERO_TOLERANCE)) throw new Error(`Reference solver: нулевая длина ребра ${member.id}`)
  const rotation = localAxes(delta)
  const transform = transformation12(rotation)
  const elastic = localElasticStiffness(member, lengthM)
  const globalStiffness = transformMatrixToGlobal(elastic.matrix, transform)
  const dofs = memberGlobalDofs(member)
  return {
    memberId: member.id,
    lengthM,
    rotation,
    transform,
    dofs,
    reducedDofs: dofs.map((dof) => reducedIndex[dof]!),
    localStiffness: elastic.matrix,
    globalStiffness,
    areaM2: elastic.area,
    inertiaM4: elastic.inertia,
    torsionConstantM4: elastic.torsionConstant,
    shearModulusPa: elastic.shearModulus,
  }
}

function assembleReducedMatrix(target: DenseMatrix, reducedDofs: readonly number[], elementMatrix: DenseMatrix): void {
  for (let localRow = 0; localRow < 12; localRow += 1) {
    const row = reducedDofs[localRow]!
    if (row < 0) continue
    for (let localColumn = 0; localColumn < 12; localColumn += 1) {
      const column = reducedDofs[localColumn]!
      if (column < 0) continue
      target[row]![column] = target[row]![column]! + elementMatrix[localRow]![localColumn]!
    }
  }
}

export function compileIndependentDenseSystem(model: GeneratedMastModel): IndependentDenseSystem {
  const { dofCount, freeDofs, reducedIndex } = buildFreeDofMap(model)
  const memberGeometry = model.members.map((member) => independentMemberGeometry(model, member, reducedIndex))
  const reducedStiffness = zeroMatrix(freeDofs.length)
  for (const geometry of memberGeometry) {
    assembleReducedMatrix(reducedStiffness, geometry.reducedDofs, geometry.globalStiffness)
  }
  return {
    method: 'independent-dense-gaussian-reference-v1',
    dofCount,
    freeDofs,
    reducedIndex,
    reducedStiffness,
    memberGeometry,
  }
}

function assembleLoads(model: GeneratedMastModel, loadCase: BuiltLoadCase, system: IndependentDenseSystem) {
  const loadVector = zeroVector(system.dofCount)
  const memberLoads: ReferenceMemberLoad[] = new Array<ReferenceMemberLoad>(model.members.length)

  for (const node of model.nodes) {
    const force = loadCase.nodalLoads[node.id] ?? [0, 0, 0]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      const forceDof = globalDof(node.id, axis)
      const momentDof = globalDof(node.id, axis + 3)
      loadVector[forceDof] = loadVector[forceDof]! + force[axis]!
      loadVector[momentDof] = loadVector[momentDof]! + moment[axis]!
    }
  }

  for (const member of model.members) {
    const geometry = system.memberGeometry[member.id]!
    const distributedGlobal = loadCase.memberDistributedLoads?.[member.id] ?? [0, 0, 0]
    const distributedLocal = multiplyMatrixVector(geometry.rotation, distributedGlobal)
    const localEquivalentLoad = localUniformLoad(distributedLocal, geometry.lengthM)
    const globalEquivalentLoad = transformVectorToGlobal(localEquivalentLoad, geometry.transform)
    for (let index = 0; index < 12; index += 1) {
      const dof = geometry.dofs[index]!
      loadVector[dof] = loadVector[dof]! + globalEquivalentLoad[index]!
    }
    memberLoads[member.id] = {
      distributedGlobal,
      distributedLocal,
      localEquivalentLoad,
    }
  }

  return { loadVector, memberLoads }
}

function recoverState(
  model: GeneratedMastModel,
  loadCase: BuiltLoadCase,
  system: IndependentDenseSystem,
  memberLoads: readonly ReferenceMemberLoad[],
  displacementVector: readonly number[],
) {
  const equilibriumVector = zeroVector(system.dofCount)
  const memberLocalEndForces: number[][] = new Array<number[]>(model.members.length)

  for (const member of model.members) {
    const geometry = system.memberGeometry[member.id]!
    const elementGlobalDisplacement = geometry.dofs.map((dof) => displacementVector[dof]!)
    const elementLocalDisplacement = multiplyMatrixVector(geometry.transform, elementGlobalDisplacement)
    const elasticEndForces = multiplyMatrixVector(geometry.localStiffness, elementLocalDisplacement)
    const localEndForces = elasticEndForces.map(
      (value, index) => value - memberLoads[member.id]!.localEquivalentLoad[index]!,
    )
    memberLocalEndForces[member.id] = localEndForces
    const globalEndForces = transformVectorToGlobal(localEndForces, geometry.transform)
    for (let index = 0; index < 12; index += 1) {
      const dof = geometry.dofs[index]!
      equilibriumVector[dof] = equilibriumVector[dof]! + globalEndForces[index]!
    }
  }

  for (const node of model.nodes) {
    const force = loadCase.nodalLoads[node.id] ?? [0, 0, 0]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      const forceDof = globalDof(node.id, axis)
      const momentDof = globalDof(node.id, axis + 3)
      equilibriumVector[forceDof] = equilibriumVector[forceDof]! - force[axis]!
      equilibriumVector[momentDof] = equilibriumVector[momentDof]! - moment[axis]!
    }
  }

  const reactions: MutableVector3[] = model.nodes.map((node) => [
    equilibriumVector[globalDof(node.id, 0)]!,
    equilibriumVector[globalDof(node.id, 1)]!,
    equilibriumVector[globalDof(node.id, 2)]!,
  ])
  const reactionMoments: MutableVector3[] = model.nodes.map((node) => [
    equilibriumVector[globalDof(node.id, 3)]!,
    equilibriumVector[globalDof(node.id, 4)]!,
    equilibriumVector[globalDof(node.id, 5)]!,
  ])
  return { equilibriumVector, memberLocalEndForces, reactions, reactionMoments }
}

function independentBuckling(system: IndependentDenseSystem, memberLocalEndForces: readonly (readonly number[])[]) {
  const geometricStiffness = zeroMatrix(system.freeDofs.length)
  for (const geometry of system.memberGeometry) {
    const forces = memberLocalEndForces[geometry.memberId]!
    const axialAtA = -forces[0]!
    const axialAtB = forces[6]!
    const averageAxialN = (axialAtA + axialAtB) / 2
    const localGeometric = localGeometricStiffness(averageAxialN, geometry.lengthM)
    const globalGeometric = transformMatrixToGlobal(localGeometric, geometry.transform)
    assembleReducedMatrix(geometricStiffness, geometry.reducedDofs, globalGeometric)
  }
  return calculateCriticalBucklingFactor(system.reducedStiffness as NumericMatrix, geometricStiffness as NumericMatrix)
}

export function analyzeIndependentDenseFrame(
  model: GeneratedMastModel,
  loadCase: BuiltLoadCase,
  parameters: Readonly<Record<string, unknown>> = {},
  compiledSystem: IndependentDenseSystem | null = null,
  options: IndependentDenseOptions = {},
) {
  const system = compiledSystem ?? compileIndependentDenseSystem(model)
  const { loadVector, memberLoads } = assembleLoads(model, loadCase, system)
  const reducedLoad = system.freeDofs.map((dof) => loadVector[dof]!)
  const solved = solveDenseSystem(system.reducedStiffness, reducedLoad)
  const displacementVector = zeroVector(system.dofCount)
  system.freeDofs.forEach((dof, index) => {
    displacementVector[dof] = solved.solution[index]!
  })
  const recovered = recoverState(model, loadCase, system, memberLoads, displacementVector)
  const buckling = options.includeBuckling === false
    ? null
    : independentBuckling(system, recovered.memberLocalEndForces)

  let maximumFreeEquilibriumResidual = 0
  for (const dof of system.freeDofs) {
    maximumFreeEquilibriumResidual = Math.max(
      maximumFreeEquilibriumResidual,
      Math.abs(recovered.equilibriumVector[dof]!),
    )
  }
  const loadScale = Math.max(1, ...loadVector.map(Math.abs))

  return {
    method: system.method,
    degreesOfFreedomPerNode: DOF_PER_NODE,
    displacementVector,
    reactions: recovered.reactions,
    reactionMoments: recovered.reactionMoments,
    memberLocalEndForces: recovered.memberLocalEndForces,
    buckling,
    diagnostics: {
      relativeResidual: relativeResidual(system.reducedStiffness, solved.solution, reducedLoad),
      maximumFreeEquilibriumResidual: maximumFreeEquilibriumResidual / loadScale,
      minPivotRatio: solved.minPivotRatio,
      freeDofCount: system.freeDofs.length,
    },
    parameters,
  }
}
