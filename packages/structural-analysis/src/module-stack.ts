import {
  choleskyDecomposition,
  matrixVectorMultiply,
  solveCholeskyFactor,
  vectorNorm,
} from '../../numerics/index.js'
import type { NumericMatrix, NumericVector } from '../../numerics/index.js'
import type { LoadCase, Vector3 } from './contracts.js'
import type { GeneratedMastModel } from './geometry.js'

const DOF_PER_NODE = 6
const INTERFACE_NODE_COUNT = 3
const INTERFACE_DOF_COUNT = DOF_PER_NODE * INTERFACE_NODE_COUNT
const MODULE_DOF_COUNT = INTERFACE_DOF_COUNT * 2

type MutableVector = number[]
type MutableMatrix = number[][]
type Matrix3 = readonly [Vector3, Vector3, Vector3]

type ModuleDefinition = GeneratedMastModel['modules'][number]
type MastNode = GeneratedMastModel['nodes'][number]

interface MemberGeometry {
  readonly dofs: readonly number[]
  readonly rotation: Matrix3
  readonly transform: NumericMatrix
  readonly lengthM: number
  readonly globalStiffness: NumericMatrix
}

interface ModuleLoadGeometry {
  readonly memberId: number
  readonly dofs: number[]
  readonly rotation: MutableMatrix
  readonly transform: MutableMatrix
  readonly lengthM: number
}

interface MatrixPartitions {
  readonly kbb: MutableMatrix
  readonly kbt: MutableMatrix
  readonly ktb: MutableMatrix
  readonly ktt: MutableMatrix
}

interface CompiledModule extends ModuleDefinition, MatrixPartitions {
  readonly dofs: number[]
  readonly localByGlobal: Map<number, number>
  readonly loadGeometry: ModuleLoadGeometry[]
  readonly stiffness: MutableMatrix
}

interface ModuleStage {
  readonly moduleIndex: number
  readonly interfaceMatrix: MutableMatrix
  readonly factor: MutableMatrix
  readonly upperCondensedStiffness: MutableMatrix
  readonly condensedStiffness: MutableMatrix
}

export interface CompiledModuleStack {
  readonly method: 'module-schur-top-down-v1'
  readonly interfaceDofCount: number
  readonly moduleDofCount: number
  readonly modules: CompiledModule[]
  readonly stages: ModuleStage[]
  readonly baseCondensedStiffness: MutableMatrix
  readonly interfaceFactorizationCount: number
}

interface InterfaceAction {
  readonly nodeId: number
  readonly forceN: number[]
  readonly momentNm: number[]
}

interface InterfaceResultant {
  readonly forceN: number[]
  readonly momentNm: number[]
}

export interface ModuleStackState {
  readonly moduleIndex: number
  readonly moduleNumber: number
  readonly bottomNodeIds: number[]
  readonly topNodeIds: number[]
  readonly memberIds: number[]
  readonly topStructuralFromAbove: InterfaceAction[]
  readonly topDirectApplied: InterfaceAction[]
  readonly topAppliedFromAbove: InterfaceAction[]
  readonly bottomReactionFromBelow: InterfaceAction[]
  readonly topStructuralResultantFromAbove: InterfaceResultant
  readonly topDirectResultant: InterfaceResultant
  readonly topResultantFromAbove: InterfaceResultant
  readonly bottomResultantFromBelow: InterfaceResultant
  readonly bottomDisplacement: number[]
  readonly topDisplacement: number[]
}

export interface ModuleStackSolution {
  readonly method: CompiledModuleStack['method']
  readonly displacementVector: Float64Array
  readonly interfaces: number[][]
  readonly modules: ModuleStackState[]
  readonly condensedBaseLoad: number[] | undefined
  readonly interfaceEquilibriumResidual: number
  readonly displacementNorm: number
}

const zeros = (size: number): MutableVector => new Array<number>(size).fill(0)
const zeroMatrix = (rows: number, columns = rows): MutableMatrix => (
  Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
)
const globalDof = (nodeId: number, axis: number): number => nodeId * DOF_PER_NODE + axis

const interfaceDofs = (nodeIds: readonly number[]): number[] => nodeIds.flatMap((nodeId) => (
  Array.from({ length: DOF_PER_NODE }, (_, axis) => globalDof(nodeId, axis))
))

const addVectors = (left: NumericVector, right: NumericVector): number[] => (
  left.map((value, index) => value + (right[index] ?? 0))
)
const subtractVectors = (left: NumericVector, right: NumericVector): number[] => (
  left.map((value, index) => value - (right[index] ?? 0))
)

function addMatrices(left: NumericMatrix, right: NumericMatrix): MutableMatrix {
  return left.map((row, rowIndex) => row.map(
    (value, column) => value + (right[rowIndex]?.[column] ?? 0),
  ))
}

function subtractMatrices(left: NumericMatrix, right: NumericMatrix): MutableMatrix {
  return left.map((row, rowIndex) => row.map(
    (value, column) => value - (right[rowIndex]?.[column] ?? 0),
  ))
}

function multiplyMatrices(left: NumericMatrix, right: NumericMatrix): MutableMatrix {
  const result = zeroMatrix(left.length, right[0]?.length ?? 0)
  for (let row = 0; row < left.length; row += 1) {
    const leftRow = left[row]!
    const resultRow = result[row]!
    for (let shared = 0; shared < right.length; shared += 1) {
      const factor = leftRow[shared] ?? 0
      if (factor === 0) continue
      const rightRow = right[shared]!
      for (let column = 0; column < resultRow.length; column += 1) {
        resultRow[column] = (resultRow[column] ?? 0) + factor * (rightRow[column] ?? 0)
      }
    }
  }
  return result
}

function symmetrize(matrix: NumericMatrix): MutableMatrix {
  const result = matrix.map((row) => [...row])
  for (let row = 0; row < result.length; row += 1) {
    for (let column = 0; column < row; column += 1) {
      const value = ((result[row]![column] ?? 0) + (result[column]![row] ?? 0)) / 2
      result[row]![column] = value
      result[column]![row] = value
    }
  }
  return result
}

function partitionModuleMatrix(matrix: NumericMatrix): MatrixPartitions {
  const slice = (rowStart: number, columnStart: number): MutableMatrix => Array.from(
    { length: INTERFACE_DOF_COUNT },
    (_, row) => matrix[rowStart + row]!.slice(columnStart, columnStart + INTERFACE_DOF_COUNT),
  )
  return {
    kbb: slice(0, 0),
    kbt: slice(0, INTERFACE_DOF_COUNT),
    ktb: slice(INTERFACE_DOF_COUNT, 0),
    ktt: slice(INTERFACE_DOF_COUNT, INTERFACE_DOF_COUNT),
  }
}

function inverseTimesMatrix(lower: NumericMatrix, matrix: NumericMatrix): MutableMatrix {
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  const result = zeroMatrix(rows, columns)
  for (let column = 0; column < columns; column += 1) {
    const rhs = matrix.map((row) => row[column] ?? 0)
    const solution = solveCholeskyFactor(lower, rhs)
    for (let row = 0; row < rows; row += 1) result[row]![column] = solution[row] ?? 0
  }
  return result
}

const multiply3Vector = (matrix: Matrix3, vector: Vector3): number[] => [
  matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
  matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
  matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
]

function localUniformLoadVector(distributedLocal: NumericVector, length: number): number[] {
  const qx = distributedLocal[0] ?? 0
  const qy = distributedLocal[1] ?? 0
  const qz = distributedLocal[2] ?? 0
  const vector = zeros(12)
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

function transformVectorToGlobal(local: NumericVector, transform: NumericMatrix): number[] {
  return Array.from({ length: local.length }, (_, globalRow) => (
    local.reduce((sum, value, localRow) => sum + (transform[localRow]?.[globalRow] ?? 0) * value, 0)
  ))
}

function assembleModuleStiffness(
  module: ModuleDefinition,
  memberGeometry: readonly MemberGeometry[],
): CompiledModule {
  const dofs = [
    ...interfaceDofs(module.bottomNodeIds),
    ...interfaceDofs(module.topNodeIds),
  ]
  const localByGlobal = new Map(dofs.map((dof, index) => [dof, index]))
  const stiffnessRaw = zeroMatrix(MODULE_DOF_COUNT)
  const loadGeometry: ModuleLoadGeometry[] = []

  for (const memberId of module.memberIds) {
    const geometry = memberGeometry[memberId]
    if (!geometry) throw new Error(`Модуль ${module.number}: отсутствует геометрия ребра ${memberId}`)
    loadGeometry.push({
      memberId,
      dofs: [...geometry.dofs],
      rotation: geometry.rotation.map((row) => [...row]),
      transform: geometry.transform.map((row) => [...row]),
      lengthM: geometry.lengthM,
    })
    for (let row = 0; row < geometry.dofs.length; row += 1) {
      const localRow = localByGlobal.get(geometry.dofs[row]!)
      if (localRow == null) throw new Error(`Ребро ${memberId} выходит за границы модуля ${module.number}`)
      for (let column = 0; column < geometry.dofs.length; column += 1) {
        const localColumn = localByGlobal.get(geometry.dofs[column]!)
        if (localColumn == null) throw new Error(`Ребро ${memberId} выходит за границы модуля ${module.number}`)
        stiffnessRaw[localRow]![localColumn] = (stiffnessRaw[localRow]![localColumn] ?? 0)
          + (geometry.globalStiffness[row]?.[column] ?? 0)
      }
    }
  }

  const stiffness = symmetrize(stiffnessRaw)
  return {
    ...module,
    dofs,
    localByGlobal,
    loadGeometry,
    stiffness,
    ...partitionModuleMatrix(stiffness),
  }
}

export function compileModuleStack(
  model: GeneratedMastModel,
  memberGeometry: readonly MemberGeometry[],
): CompiledModuleStack | null {
  if (!Array.isArray(model.modules) || model.modules.length !== model.moduleCount) return null
  if (model.modules.length === 0) return null

  const modules = model.modules.map((module) => assembleModuleStiffness(module, memberGeometry))
  const stages = new Array<ModuleStage>(modules.length)
  let upperCondensedStiffness = zeroMatrix(INTERFACE_DOF_COUNT)

  // TOP -> DOWN. The already processed upper stack is represented exactly by
  // an 18-DOF Schur stiffness at the three top nodes of the next module.
  for (let index = modules.length - 1; index >= 0; index -= 1) {
    const module = modules[index]!
    const interfaceMatrix = symmetrize(addMatrices(module.ktt, upperCondensedStiffness))
    const factor = choleskyDecomposition(interfaceMatrix)
    const inverseKtb = inverseTimesMatrix(factor, module.ktb)
    const condensedStiffness = symmetrize(subtractMatrices(
      module.kbb,
      multiplyMatrices(module.kbt, inverseKtb),
    ))
    stages[index] = {
      moduleIndex: index,
      interfaceMatrix,
      factor,
      upperCondensedStiffness,
      condensedStiffness,
    }
    upperCondensedStiffness = condensedStiffness
  }

  return {
    method: 'module-schur-top-down-v1',
    interfaceDofCount: INTERFACE_DOF_COUNT,
    moduleDofCount: MODULE_DOF_COUNT,
    modules,
    stages,
    baseCondensedStiffness: upperCondensedStiffness,
    interfaceFactorizationCount: stages.length,
  }
}

function addModuleEntry(
  target: MutableVector,
  module: CompiledModule,
  globalDegree: number,
  value: number,
): void {
  const local = module.localByGlobal.get(globalDegree)
  if (local == null) throw new Error(`DOF ${globalDegree} не принадлежит модулю ${module.number}`)
  target[local] = (target[local] ?? 0) + value
}

function ownerModuleIndex(model: GeneratedMastModel, node: MastNode): number {
  const level = Number.isInteger(node.level) ? node.level : Math.floor(node.id / 3)
  if (level <= 0) return 0
  return Math.min(model.moduleCount - 1, level - 1)
}

function buildModuleLoadVectors(
  model: GeneratedMastModel,
  stack: CompiledModuleStack,
  loadCase: LoadCase,
): number[][] {
  const loads = stack.modules.map(() => zeros(MODULE_DOF_COUNT))

  // Every member belongs to exactly one physical module. Distributed loads
  // are converted to the same consistent nodal vector as the global solver.
  for (const module of stack.modules) {
    const target = loads[module.index]!
    for (const geometry of module.loadGeometry) {
      const distributedGlobal = loadCase.memberDistributedLoads?.[geometry.memberId] ?? [0, 0, 0]
      const rotation = geometry.rotation as unknown as Matrix3
      const distributedLocal = multiply3Vector(rotation, distributedGlobal)
      const localEquivalent = localUniformLoadVector(distributedLocal, geometry.lengthM)
      const globalEquivalent = transformVectorToGlobal(localEquivalent, geometry.transform)
      for (let index = 0; index < geometry.dofs.length; index += 1) {
        addModuleEntry(target, module, geometry.dofs[index]!, globalEquivalent[index] ?? 0)
      }
    }
  }

  // A direct nodal load at a shared interface is owned exactly once: by the
  // module immediately below it. Therefore module vectors sum to the original
  // global load vector without double counting an interface.
  for (const node of model.nodes) {
    const moduleIndex = ownerModuleIndex(model, node)
    const module = stack.modules[moduleIndex]!
    const force = loadCase.nodalLoads[node.id] ?? [0, 0, 0]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      addModuleEntry(loads[moduleIndex]!, module, globalDof(node.id, axis), force[axis] ?? 0)
      addModuleEntry(loads[moduleIndex]!, module, globalDof(node.id, axis + 3), moment[axis] ?? 0)
    }
  }

  return loads
}

function interfaceActions(nodeIds: readonly number[], vector: NumericVector): InterfaceAction[] {
  return nodeIds.map((nodeId, nodeIndex) => {
    const offset = nodeIndex * DOF_PER_NODE
    return {
      nodeId,
      forceN: vector.slice(offset, offset + 3),
      momentNm: vector.slice(offset + 3, offset + 6),
    }
  })
}

function directInterfaceActions(nodeIds: readonly number[], loadCase: LoadCase): InterfaceAction[] {
  return nodeIds.map((nodeId) => ({
    nodeId,
    forceN: [...(loadCase.nodalLoads[nodeId] ?? [0, 0, 0])],
    momentNm: [...(loadCase.nodalMoments?.[nodeId] ?? [0, 0, 0])],
  }))
}

function addInterfaceActions(
  left: readonly InterfaceAction[],
  right: readonly InterfaceAction[],
): InterfaceAction[] {
  return left.map((action, index) => ({
    nodeId: action.nodeId,
    forceN: addVectors(action.forceN, right[index]?.forceN ?? [0, 0, 0]),
    momentNm: addVectors(action.momentNm, right[index]?.momentNm ?? [0, 0, 0]),
  }))
}

function resultant(actions: readonly InterfaceAction[]): InterfaceResultant {
  return actions.reduce<InterfaceResultant>((sum, action) => ({
    forceN: sum.forceN.map((value, axis) => value + (action.forceN[axis] ?? 0)),
    momentNm: sum.momentNm.map((value, axis) => value + (action.momentNm[axis] ?? 0)),
  }), { forceN: [0, 0, 0], momentNm: [0, 0, 0] })
}

export function solveModuleStack(
  model: GeneratedMastModel,
  stack: CompiledModuleStack | null,
  loadCase: LoadCase,
): ModuleStackSolution {
  if (!stack) throw new Error('Для модульного решения отсутствует скомпилированный стек')
  const moduleLoads = buildModuleLoadVectors(model, stack, loadCase)
  const condensedLoads = new Array<number[]>(stack.modules.length)
  const upperLoads = new Array<number[]>(stack.modules.length)
  let upperCondensedLoad = zeros(INTERFACE_DOF_COUNT)

  // TOP -> DOWN: the load of every upper module is condensed into the three
  // top nodes of the module immediately below. This is the exact linear Schur
  // complement, not a hand-made sum of vertical forces.
  for (let index = stack.modules.length - 1; index >= 0; index -= 1) {
    const module = stack.modules[index]!
    const stage = stack.stages[index]!
    const load = moduleLoads[index]!
    const fb = load.slice(0, INTERFACE_DOF_COUNT)
    const ft = load.slice(INTERFACE_DOF_COUNT)
    upperLoads[index] = upperCondensedLoad
    const topDrive = addVectors(ft, upperCondensedLoad)
    const topResponse = solveCholeskyFactor(stage.factor, topDrive)
    const condensedLoad = subtractVectors(fb, matrixVectorMultiply(module.kbt, topResponse))
    condensedLoads[index] = condensedLoad
    upperCondensedLoad = condensedLoad
  }

  // Bottom interface is the ideal rigid foundation: u0 = 0. After the top
  // stack is condensed, interface displacements are recovered BOTTOM -> TOP.
  const interfaces = Array.from({ length: model.moduleCount + 1 }, () => zeros(INTERFACE_DOF_COUNT))
  for (let index = 0; index < stack.modules.length; index += 1) {
    const module = stack.modules[index]!
    const stage = stack.stages[index]!
    const load = moduleLoads[index]!
    const ub = interfaces[index]!
    const ft = load.slice(INTERFACE_DOF_COUNT)
    const rhs = subtractVectors(
      addVectors(ft, upperLoads[index] ?? zeros(INTERFACE_DOF_COUNT)),
      matrixVectorMultiply(module.ktb, ub),
    )
    interfaces[index + 1] = solveCholeskyFactor(stage.factor, rhs)
  }

  const displacementVector = new Float64Array(model.nodes.length * DOF_PER_NODE)
  for (let level = 0; level < interfaces.length; level += 1) {
    const nodeIds = level === 0 ? model.baseNodeIds : model.modules[level - 1]!.topNodeIds
    for (let nodeIndex = 0; nodeIndex < nodeIds.length; nodeIndex += 1) {
      for (let axis = 0; axis < DOF_PER_NODE; axis += 1) {
        displacementVector[globalDof(nodeIds[nodeIndex]!, axis)] = interfaces[level]![nodeIndex * DOF_PER_NODE + axis] ?? 0
      }
    }
  }

  const moduleStates = stack.modules.map<ModuleStackState>((module, index) => {
    const displacement = [...interfaces[index]!, ...interfaces[index + 1]!]
    const load = moduleLoads[index]!
    // K_module*u - f_module gives only the neighbouring-structure interface
    // action because direct nodal loads owned by this module are already in
    // f_module. For the user-facing top-boundary load we must add those direct
    // loads back explicitly; otherwise a one-module mast with a 1 t payload
    // incorrectly reports zero load on its top face.
    const residual = subtractVectors(matrixVectorMultiply(module.stiffness, displacement), load)
    const bottomResidual = residual.slice(0, INTERFACE_DOF_COUNT)
    const topResidual = residual.slice(INTERFACE_DOF_COUNT)
    const topStructuralFromAbove = interfaceActions(module.topNodeIds, topResidual)
    const topDirectApplied = directInterfaceActions(module.topNodeIds, loadCase)
    const topAppliedFromAbove = addInterfaceActions(topStructuralFromAbove, topDirectApplied)
    const bottomReactionFromBelow = interfaceActions(module.bottomNodeIds, bottomResidual)
    return {
      moduleIndex: module.index,
      moduleNumber: module.number,
      bottomNodeIds: [...module.bottomNodeIds],
      topNodeIds: [...module.topNodeIds],
      memberIds: [...module.memberIds],
      topStructuralFromAbove,
      topDirectApplied,
      topAppliedFromAbove,
      bottomReactionFromBelow,
      topStructuralResultantFromAbove: resultant(topStructuralFromAbove),
      topDirectResultant: resultant(topDirectApplied),
      topResultantFromAbove: resultant(topAppliedFromAbove),
      bottomResultantFromBelow: resultant(bottomReactionFromBelow),
      bottomDisplacement: [...interfaces[index]!],
      topDisplacement: [...interfaces[index + 1]!],
    }
  })

  let interfaceClosure = 0
  let interfaceScale = 1
  for (let index = 0; index < moduleStates.length - 1; index += 1) {
    const upper = moduleStates[index + 1]!.bottomReactionFromBelow
    // Closure is an internal-interface check and therefore intentionally uses
    // only the neighbouring structural action, without a direct nodal load
    // that could be owned by the lower module at the same interface.
    const lower = moduleStates[index]!.topStructuralFromAbove
    for (let node = 0; node < INTERFACE_NODE_COUNT; node += 1) {
      const lowerAction = lower[node]!
      const upperAction = upper[node]!
      const pair = [
        ...lowerAction.forceN.map((value, axis) => value + (upperAction.forceN[axis] ?? 0)),
        ...lowerAction.momentNm.map((value, axis) => value + (upperAction.momentNm[axis] ?? 0)),
      ]
      interfaceClosure = Math.max(interfaceClosure, ...pair.map(Math.abs))
      interfaceScale = Math.max(
        interfaceScale,
        ...lowerAction.forceN.map(Math.abs),
        ...upperAction.forceN.map(Math.abs),
        ...lowerAction.momentNm.map(Math.abs),
        ...upperAction.momentNm.map(Math.abs),
      )
    }
  }

  return {
    method: stack.method,
    displacementVector,
    interfaces,
    modules: moduleStates,
    condensedBaseLoad: condensedLoads[0],
    interfaceEquilibriumResidual: interfaceClosure / interfaceScale,
    displacementNorm: vectorNorm(displacementVector),
  }
}
