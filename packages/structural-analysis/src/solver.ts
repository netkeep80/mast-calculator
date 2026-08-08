import type { ResolvedProject } from '../../domain/contracts.js'
import {
  add3,
  addBandValue,
  createSymmetricBandMatrix,
  cross3,
  factorSymmetricBand,
  norm3,
  relativeBandResidual,
  scale3,
  solveSymmetricBandFactor,
  sub3,
  unit3,
  type MutableVector3,
  type SymmetricBandFactorization,
  type SymmetricBandMatrix,
  type Vector3,
} from '../../numerics/index.js'
import { calculateCriticalBucklingFactorBanded } from './buckling.js'
import type { GeneratedMastModel } from './geometry.js'
import type { BuiltLoadCase } from './loads.js'

const DOF_PER_NODE = 6

type DenseMatrix = number[][]
type MastMember = GeneratedMastModel['members'][number]
type MastNode = GeneratedMastModel['nodes'][number]

type Rotation3 = [MutableVector3, MutableVector3, MutableVector3]

interface MemberGeometry {
  lengthM: number
  rotation: Rotation3
  transform: DenseMatrix
  dofs: number[]
  reducedDofs: number[]
  areaM2: number
  inertiaM4: number
  torsionConstantM4: number
  shearModulusPa: number
  localStiffness: DenseMatrix
  globalStiffness: DenseMatrix
}

interface CompiledFrameSystem {
  method: 'symmetric-band-cholesky'
  dofCount: number
  freeDofs: number[]
  reducedIndexByGlobalDof: Int32Array
  reducedStiffness: SymmetricBandMatrix
  factorization: SymmetricBandFactorization
  bandwidth: number
  memberGeometry: MemberGeometry[]
  totalMassKg: number
  factorizationCount: 1
  parameters: ResolvedProject
}

interface MemberLoad {
  distributedGlobal: Vector3
  distributedLocal: MutableVector3
  localEquivalentLoad: Float64Array
}

export interface FrameMemberResult {
  memberId: number
  lengthM: number
  localAxes: number[][]
  distributedLoadLocalNPerM: number[]
  localEndForces: number[]
  axialForceAtAN: number
  axialForceAtBN: number
}

export interface FrameAnalysisResult {
  solver: 'linear-3d-frame-euler-bernoulli'
  linearSystemSolver: 'symmetric-band-cholesky'
  degreesOfFreedomPerNode: 6
  displacements: MutableVector3[]
  rotations: MutableVector3[]
  reactions: MutableVector3[]
  reactionMoments: MutableVector3[]
  memberResults: FrameMemberResult[]
  maxDisplacementM: number
  maxTopDisplacementM: number
  maxUtilization: null
  criticalMemberId: null
  totalMassKg: number
  buckling: {
    criticalLoadFactor: number
    mode: MutableVector3[]
    rotations: MutableVector3[]
    residual: number
    eigenResidual: number
    iterations: number
  }
  diagnostics: {
    relativeResidual: number
    minPivotRatio: number
    freeDofCount: number
    stiffnessBandwidth: number
    stiffnessFactorizationCount: number
    maximumNodeEquilibriumResidual: number
    globalMomentResidual: number
  }
}

const degreeOfFreedom = (nodeId: number, axis: number): number => nodeId * DOF_PER_NODE + axis
const zeroMatrix = (size: number): DenseMatrix => Array.from({ length: size }, () => new Array<number>(size).fill(0))
const zeroVector = (size: number): Float64Array => new Float64Array(size)

const multiply3Vector = (matrix: Rotation3, vector: Vector3): MutableVector3 => [
  matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
  matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
  matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
]

function addSubmatrix(target: DenseMatrix, indices: readonly number[], values: readonly (readonly number[])[]): void {
  for (let row = 0; row < indices.length; row += 1) {
    for (let column = 0; column < indices.length; column += 1) {
      const targetRow = target[indices[row]!]!
      const targetColumn = indices[column]!
      targetRow[targetColumn] = targetRow[targetColumn]! + values[row]![column]!
    }
  }
}

function localAxes(delta: Vector3): Rotation3 {
  const ex = unit3(delta)
  const reference: MutableVector3 = Math.abs(ex[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
  const ey = unit3(cross3(reference, ex))
  const ez = unit3(cross3(ex, ey))
  return [ex, ey, ez]
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

function multiplyMatrixVector(matrix: DenseMatrix, vector: ArrayLike<number>): Float64Array {
  const result = new Float64Array(matrix.length)
  for (let row = 0; row < matrix.length; row += 1) {
    let value = 0
    for (let column = 0; column < vector.length; column += 1) value += matrix[row]![column]! * vector[column]!
    result[row] = value
  }
  return result
}

function multiplyMatrices(left: DenseMatrix, right: DenseMatrix): DenseMatrix {
  const rows = left.length
  const columns = right[0]!.length
  const inner = right.length
  const result = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < inner; index += 1) {
      const factor = left[row]![index]!
      if (factor === 0) continue
      for (let column = 0; column < columns; column += 1) {
        result[row]![column] = result[row]![column]! + factor * right[index]![column]!
      }
    }
  }
  return result
}

function transposeMatrix(matrix: DenseMatrix): DenseMatrix {
  return matrix[0]!.map((_, column) => matrix.map((row) => row[column]!))
}

function transformMatrixToGlobal(local: DenseMatrix, transform: DenseMatrix): DenseMatrix {
  return multiplyMatrices(multiplyMatrices(transposeMatrix(transform), local), transform)
}

function transformVectorToGlobal(local: ArrayLike<number>, transform: DenseMatrix): Float64Array {
  return multiplyMatrixVector(transposeMatrix(transform), local)
}

function localFrameStiffness(
  E: number,
  G: number,
  area: number,
  inertia: number,
  torsionConstant: number,
  length: number,
): DenseMatrix {
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

function localUniformLoadVector(distributedLocal: Vector3, length: number): Float64Array {
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

function localGeometricStiffness(axialForceN: number, length: number): DenseMatrix {
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

function elementGlobalDofs(member: MastMember): number[] {
  return [
    ...Array.from({ length: 6 }, (_, axis) => degreeOfFreedom(member.nodeA, axis)),
    ...Array.from({ length: 6 }, (_, axis) => degreeOfFreedom(member.nodeB, axis)),
  ]
}

function memberActionResult(localEndForces: ArrayLike<number>): { axialForceAtAN: number; axialForceAtBN: number } {
  const axialA = -localEndForces[0]!
  const axialB = localEndForces[6]!
  return {
    axialForceAtAN: axialA,
    axialForceAtBN: axialB,
  }
}

function buildFreeDofs(model: GeneratedMastModel, dofCount: number): { freeDofs: number[]; reducedIndexByGlobalDof: Int32Array } {
  const freeDofs: number[] = []
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

function elementGeometry(
  model: GeneratedMastModel,
  member: MastMember,
  reducedIndexByGlobalDof: Int32Array,
): MemberGeometry {
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
  const reducedDofs = dofs.map((dof) => reducedIndexByGlobalDof[dof]!)
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

function determineBandwidth(memberGeometry: readonly MemberGeometry[]): number {
  let bandwidth = 0
  for (const geometry of memberGeometry) {
    const reduced = geometry.reducedDofs.filter((index) => index >= 0)
    for (const left of reduced) {
      for (const right of reduced) bandwidth = Math.max(bandwidth, Math.abs(left - right))
    }
  }
  return bandwidth
}

function assembleElementBand(matrix: SymmetricBandMatrix, reducedDofs: readonly number[], values: DenseMatrix): void {
  for (let localRow = 0; localRow < 12; localRow += 1) {
    const row = reducedDofs[localRow]!
    if (row < 0) continue
    for (let localColumn = 0; localColumn < 12; localColumn += 1) {
      const column = reducedDofs[localColumn]!
      if (column < 0 || row < column) continue
      addBandValue(matrix, row, column, values[localRow]![localColumn]!)
    }
  }
}

export function compileFrameSystem(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
): CompiledFrameSystem {
  const dofCount = model.nodes.length * DOF_PER_NODE
  const { freeDofs, reducedIndexByGlobalDof } = buildFreeDofs(model, dofCount)
  const geometry = model.members.map((member) => elementGeometry(model, member, reducedIndexByGlobalDof))
  const bandwidth = determineBandwidth(geometry)
  const reducedStiffness = createSymmetricBandMatrix(freeDofs.length, bandwidth)
  for (const member of model.members) {
    const item = geometry[member.id]!
    assembleElementBand(reducedStiffness, item.reducedDofs, item.globalStiffness)
  }
  const factorization = factorSymmetricBand(reducedStiffness)
  const totalMassKg = model.members.reduce(
    (sum, member) => sum + geometry[member.id]!.areaM2 * geometry[member.id]!.lengthM * member.densityKgM3,
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

function assembleLoadVector(
  model: GeneratedMastModel,
  loadCase: BuiltLoadCase,
  system: CompiledFrameSystem,
): { loadVector: Float64Array; memberLoads: MemberLoad[] } {
  const loadVector = zeroVector(system.dofCount)
  for (const node of model.nodes) {
    const force = loadCase.nodalLoads[node.id]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    if (!force) throw new Error(`Не найдена нагрузка узла ${node.id}`)
    for (let axis = 0; axis < 3; axis += 1) {
      const forceDof = degreeOfFreedom(node.id, axis)
      const momentDof = degreeOfFreedom(node.id, axis + 3)
      loadVector[forceDof] = loadVector[forceDof]! + force[axis]!
      loadVector[momentDof] = loadVector[momentDof]! + moment[axis]!
    }
  }

  const memberLoads = model.members.map((member): MemberLoad => {
    const geometry = system.memberGeometry[member.id]!
    const distributedGlobal = loadCase.memberDistributedLoads?.[member.id] ?? [0, 0, 0]
    const distributedLocal = multiply3Vector(geometry.rotation, distributedGlobal)
    const localEquivalentLoad = localUniformLoadVector(distributedLocal, geometry.lengthM)
    const globalEquivalentLoad = transformVectorToGlobal(localEquivalentLoad, geometry.transform)
    for (let index = 0; index < 12; index += 1) {
      const dof = geometry.dofs[index]!
      loadVector[dof] = loadVector[dof]! + globalEquivalentLoad[index]!
    }
    return { distributedGlobal, distributedLocal, localEquivalentLoad }
  })
  return { loadVector, memberLoads }
}

function buildDisplacements(
  model: GeneratedMastModel,
  system: CompiledFrameSystem,
  solution: ArrayLike<number>,
): { displacementVector: Float64Array; displacements: MutableVector3[]; rotations: MutableVector3[] } {
  const displacementVector = zeroVector(system.dofCount)
  system.freeDofs.forEach((globalDof, index) => { displacementVector[globalDof] = solution[index]! })
  const displacements: MutableVector3[] = model.nodes.map((node) => [
    displacementVector[degreeOfFreedom(node.id, 0)]!,
    displacementVector[degreeOfFreedom(node.id, 1)]!,
    displacementVector[degreeOfFreedom(node.id, 2)]!,
  ])
  const rotations: MutableVector3[] = model.nodes.map((node) => [
    displacementVector[degreeOfFreedom(node.id, 3)]!,
    displacementVector[degreeOfFreedom(node.id, 4)]!,
    displacementVector[degreeOfFreedom(node.id, 5)]!,
  ])
  return { displacementVector, displacements, rotations }
}

function calculateMemberResults(
  model: GeneratedMastModel,
  system: CompiledFrameSystem,
  memberLoads: readonly MemberLoad[],
  displacementVector: Float64Array,
): { memberResults: FrameMemberResult[]; equilibriumVector: Float64Array } {
  const equilibriumVector = zeroVector(system.dofCount)
  const memberResults = model.members.map((member): FrameMemberResult => {
    const geometry = system.memberGeometry[member.id]!
    const load = memberLoads[member.id]!
    const elementDisplacementGlobal = Float64Array.from(geometry.dofs, (dof) => displacementVector[dof]!)
    const elementDisplacementLocal = multiplyMatrixVector(geometry.transform, elementDisplacementGlobal)
    const elasticEndForces = multiplyMatrixVector(geometry.localStiffness, elementDisplacementLocal)
    const localEndForces = Float64Array.from(
      elasticEndForces,
      (value, dof) => value - load.localEquivalentLoad[dof]!,
    )
    const globalEndForces = transformVectorToGlobal(localEndForces, geometry.transform)
    for (let index = 0; index < 12; index += 1) {
      const dof = geometry.dofs[index]!
      equilibriumVector[dof] = equilibriumVector[dof]! + globalEndForces[index]!
    }
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

function subtractDirectLoads(model: GeneratedMastModel, loadCase: BuiltLoadCase, equilibriumVector: Float64Array): void {
  for (const node of model.nodes) {
    const force = loadCase.nodalLoads[node.id] ?? [0, 0, 0]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      const forceDof = degreeOfFreedom(node.id, axis)
      const momentDof = degreeOfFreedom(node.id, axis + 3)
      equilibriumVector[forceDof] = equilibriumVector[forceDof]! - force[axis]!
      equilibriumVector[momentDof] = equilibriumVector[momentDof]! - moment[axis]!
    }
  }
}

function buildBuckling(
  model: GeneratedMastModel,
  system: CompiledFrameSystem,
  memberResults: readonly FrameMemberResult[],
) {
  const geometric = createSymmetricBandMatrix(system.freeDofs.length, system.bandwidth)
  for (const member of model.members) {
    const geometry = system.memberGeometry[member.id]!
    const result = memberResults[member.id]!
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

function physicalMomentResidual(
  model: GeneratedMastModel,
  loadCase: BuiltLoadCase,
  memberLoads: readonly MemberLoad[],
  system: CompiledFrameSystem,
  reactions: readonly MutableVector3[],
  reactionMoments: readonly MutableVector3[],
): number {
  let externalMoment: MutableVector3 = [0, 0, 0]
  let reactionMoment: MutableVector3 = [0, 0, 0]
  let momentScale = 1
  for (const node of model.nodes) {
    const nodalLoad = loadCase.nodalLoads[node.id]!
    const nodalMoment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    const loadMoment = add3(cross3(node.position, nodalLoad), nodalMoment)
    externalMoment = add3(externalMoment, loadMoment)
    momentScale = Math.max(momentScale, norm3(loadMoment))
    if (node.restrained.some(Boolean)) {
      const supportMoment = add3(cross3(node.position, reactions[node.id]!), reactionMoments[node.id]!)
      reactionMoment = add3(reactionMoment, supportMoment)
      momentScale = Math.max(momentScale, norm3(supportMoment))
    }
  }
  for (const member of model.members) {
    const geometry = system.memberGeometry[member.id]!
    const nodeA = model.nodes[member.nodeA]!
    const nodeB = model.nodes[member.nodeB]!
    const midpoint = scale3(add3(nodeA.position, nodeB.position), 0.5)
    const distributedResultant = scale3(memberLoads[member.id]!.distributedGlobal, geometry.lengthM)
    const loadMoment = cross3(midpoint, distributedResultant)
    externalMoment = add3(externalMoment, loadMoment)
    momentScale = Math.max(momentScale, norm3(loadMoment))
  }
  return norm3(add3(externalMoment, reactionMoment)) / momentScale
}

export function analyzeFrame(
  model: GeneratedMastModel,
  loadCase: BuiltLoadCase,
  parameters: ResolvedProject,
  compiledSystem: CompiledFrameSystem | null = null,
): FrameAnalysisResult {
  const system = compiledSystem ?? compileFrameSystem(model, parameters)
  const { loadVector, memberLoads } = assembleLoadVector(model, loadCase, system)
  const reducedLoad = Float64Array.from(system.freeDofs, (globalDof) => loadVector[globalDof]!)
  const solution = solveSymmetricBandFactor(system.factorization, reducedLoad)
  const residual = relativeBandResidual(system.reducedStiffness, solution, reducedLoad)
  const { displacementVector, displacements, rotations } = buildDisplacements(model, system, solution)
  const { memberResults, equilibriumVector } = calculateMemberResults(
    model,
    system,
    memberLoads,
    displacementVector,
  )
  subtractDirectLoads(model, loadCase, equilibriumVector)

  const reactions: MutableVector3[] = model.nodes.map((node) => [
    equilibriumVector[degreeOfFreedom(node.id, 0)]!,
    equilibriumVector[degreeOfFreedom(node.id, 1)]!,
    equilibriumVector[degreeOfFreedom(node.id, 2)]!,
  ])
  const reactionMoments: MutableVector3[] = model.nodes.map((node) => [
    equilibriumVector[degreeOfFreedom(node.id, 3)]!,
    equilibriumVector[degreeOfFreedom(node.id, 4)]!,
    equilibriumVector[degreeOfFreedom(node.id, 5)]!,
  ])

  let maximumFreeResidual = 0
  for (const globalDof of system.freeDofs) maximumFreeResidual = Math.max(maximumFreeResidual, Math.abs(equilibriumVector[globalDof]!))
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
  const bucklingMode: MutableVector3[] = model.nodes.map((node) => [
    bucklingModeVector[degreeOfFreedom(node.id, 0)]!,
    bucklingModeVector[degreeOfFreedom(node.id, 1)]!,
    bucklingModeVector[degreeOfFreedom(node.id, 2)]!,
  ])
  const bucklingRotations: MutableVector3[] = model.nodes.map((node) => [
    bucklingModeVector[degreeOfFreedom(node.id, 3)]!,
    bucklingModeVector[degreeOfFreedom(node.id, 4)]!,
    bucklingModeVector[degreeOfFreedom(node.id, 5)]!,
  ])

  const maxDisplacementM = Math.max(...displacements.map(norm3))
  const maxTopDisplacementM = Math.max(...model.topNodeIds.map((nodeId) => norm3(displacements[nodeId]!)))
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
