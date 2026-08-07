import {
  choleskyDecomposition,
  matrixVectorMultiply,
  solveCholeskyFactor,
  vectorNorm,
} from './linear-algebra.js'

const DOF_PER_NODE = 6
const INTERFACE_NODE_COUNT = 3
const INTERFACE_DOF_COUNT = DOF_PER_NODE * INTERFACE_NODE_COUNT
const MODULE_DOF_COUNT = INTERFACE_DOF_COUNT * 2

const zeros = (size) => new Array(size).fill(0)
const zeroMatrix = (rows, columns = rows) => Array.from({ length: rows }, () => new Array(columns).fill(0))
const globalDof = (nodeId, axis) => nodeId * DOF_PER_NODE + axis

const interfaceDofs = (nodeIds) => nodeIds.flatMap((nodeId) => (
  Array.from({ length: DOF_PER_NODE }, (_, axis) => globalDof(nodeId, axis))
))

const addVectors = (left, right) => left.map((value, index) => value + right[index])
const subtractVectors = (left, right) => left.map((value, index) => value - right[index])

function addMatrices(left, right) {
  return left.map((row, rowIndex) => row.map((value, column) => value + right[rowIndex][column]))
}

function subtractMatrices(left, right) {
  return left.map((row, rowIndex) => row.map((value, column) => value - right[rowIndex][column]))
}

function multiplyMatrices(left, right) {
  const result = zeroMatrix(left.length, right[0]?.length ?? 0)
  for (let row = 0; row < left.length; row += 1) {
    for (let shared = 0; shared < right.length; shared += 1) {
      const factor = left[row][shared]
      if (factor === 0) continue
      for (let column = 0; column < result[row].length; column += 1) {
        result[row][column] += factor * right[shared][column]
      }
    }
  }
  return result
}

function symmetrize(matrix) {
  const result = matrix.map((row) => [...row])
  for (let row = 0; row < result.length; row += 1) {
    for (let column = 0; column < row; column += 1) {
      const value = (result[row][column] + result[column][row]) / 2
      result[row][column] = value
      result[column][row] = value
    }
  }
  return result
}

function partitionModuleMatrix(matrix) {
  const slice = (rowStart, columnStart) => Array.from(
    { length: INTERFACE_DOF_COUNT },
    (_, row) => matrix[rowStart + row].slice(columnStart, columnStart + INTERFACE_DOF_COUNT),
  )
  return {
    kbb: slice(0, 0),
    kbt: slice(0, INTERFACE_DOF_COUNT),
    ktb: slice(INTERFACE_DOF_COUNT, 0),
    ktt: slice(INTERFACE_DOF_COUNT, INTERFACE_DOF_COUNT),
  }
}

function inverseTimesMatrix(lower, matrix) {
  const rows = matrix.length
  const columns = matrix[0]?.length ?? 0
  const result = zeroMatrix(rows, columns)
  for (let column = 0; column < columns; column += 1) {
    const rhs = matrix.map((row) => row[column])
    const solution = solveCholeskyFactor(lower, rhs)
    for (let row = 0; row < rows; row += 1) result[row][column] = solution[row]
  }
  return result
}

function assembleModuleStiffness(module, memberGeometry) {
  const dofs = [
    ...interfaceDofs(module.bottomNodeIds),
    ...interfaceDofs(module.topNodeIds),
  ]
  const localByGlobal = new Map(dofs.map((dof, index) => [dof, index]))
  const stiffness = zeroMatrix(MODULE_DOF_COUNT)

  for (const memberId of module.memberIds) {
    const geometry = memberGeometry[memberId]
    if (!geometry) throw new Error(`Модуль ${module.number}: отсутствует геометрия ребра ${memberId}`)
    for (let row = 0; row < geometry.dofs.length; row += 1) {
      const localRow = localByGlobal.get(geometry.dofs[row])
      if (localRow == null) throw new Error(`Ребро ${memberId} выходит за границы модуля ${module.number}`)
      for (let column = 0; column < geometry.dofs.length; column += 1) {
        const localColumn = localByGlobal.get(geometry.dofs[column])
        if (localColumn == null) throw new Error(`Ребро ${memberId} выходит за границы модуля ${module.number}`)
        stiffness[localRow][localColumn] += geometry.globalStiffness[row][column]
      }
    }
  }

  return {
    ...module,
    dofs,
    localByGlobal,
    stiffness: symmetrize(stiffness),
    ...partitionModuleMatrix(stiffness),
  }
}

export function compileModuleStack(model, memberGeometry) {
  if (!Array.isArray(model.modules) || model.modules.length !== model.moduleCount) return null
  if (model.modules.length === 0) return null

  const modules = model.modules.map((module) => assembleModuleStiffness(module, memberGeometry))
  const stages = new Array(modules.length)
  let upperCondensedStiffness = zeroMatrix(INTERFACE_DOF_COUNT)

  // Static condensation is performed from the free top toward the rigid
  // foundation. Each stage replaces the entire already-processed upper stack
  // by an exact 18-DOF stiffness at the current module's top interface.
  for (let index = modules.length - 1; index >= 0; index -= 1) {
    const module = modules[index]
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

function addModuleEntry(target, module, globalDegree, value) {
  const local = module.localByGlobal.get(globalDegree)
  if (local == null) throw new Error(`DOF ${globalDegree} не принадлежит модулю ${module.number}`)
  target[local] += value
}

function ownerModuleIndex(model, node) {
  const level = Number.isInteger(node.level) ? node.level : Math.round(node.id / 3)
  if (level <= 0) return 0
  return Math.min(model.moduleCount - 1, level - 1)
}

function buildModuleLoadVectors(model, stack, loadCase, memberLoads) {
  const loads = stack.modules.map(() => zeros(MODULE_DOF_COUNT))

  for (const module of stack.modules) {
    const target = loads[module.index]
    for (const memberId of module.memberIds) {
      const geometryLoad = memberLoads[memberId]
      const globalEquivalent = geometryLoad?.globalEquivalentLoad
      const geometryDofs = geometryLoad?.dofs
      if (!globalEquivalent || !geometryDofs) {
        throw new Error(`Модуль ${module.number}: отсутствует эквивалентная нагрузка ребра ${memberId}`)
      }
      for (let index = 0; index < geometryDofs.length; index += 1) {
        addModuleEntry(target, module, geometryDofs[index], globalEquivalent[index])
      }
    }
  }

  // Direct nodal load at an interface is owned exactly once: by the module
  // immediately below this interface. This makes the sum of module vectors
  // exactly equal to the original global load vector without double counting.
  for (const node of model.nodes) {
    const moduleIndex = ownerModuleIndex(model, node)
    const module = stack.modules[moduleIndex]
    const force = loadCase.nodalLoads[node.id] ?? [0, 0, 0]
    const moment = loadCase.nodalMoments?.[node.id] ?? [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      addModuleEntry(loads[moduleIndex], module, globalDof(node.id, axis), force[axis])
      addModuleEntry(loads[moduleIndex], module, globalDof(node.id, axis + 3), moment[axis])
    }
  }

  return loads
}

function interfaceActions(nodeIds, vector) {
  return nodeIds.map((nodeId, nodeIndex) => {
    const offset = nodeIndex * DOF_PER_NODE
    return {
      nodeId,
      forceN: vector.slice(offset, offset + 3),
      momentNm: vector.slice(offset + 3, offset + 6),
    }
  })
}

function resultant(actions) {
  return actions.reduce((sum, action) => ({
    forceN: sum.forceN.map((value, axis) => value + action.forceN[axis]),
    momentNm: sum.momentNm.map((value, axis) => value + action.momentNm[axis]),
  }), { forceN: [0, 0, 0], momentNm: [0, 0, 0] })
}

export function solveModuleStack(model, stack, loadCase, memberLoads) {
  if (!stack) throw new Error('Для модульного решения отсутствует скомпилированный стек')
  const moduleLoads = buildModuleLoadVectors(model, stack, loadCase, memberLoads)
  const condensedLoads = new Array(stack.modules.length)
  const upperLoads = new Array(stack.modules.length)
  let upperCondensedLoad = zeros(INTERFACE_DOF_COUNT)

  // TOP -> DOWN: condense actual load of every already processed upper module
  // into an equivalent 18-DOF load acting on the top nodes of the module below.
  for (let index = stack.modules.length - 1; index >= 0; index -= 1) {
    const module = stack.modules[index]
    const stage = stack.stages[index]
    const load = moduleLoads[index]
    const fb = load.slice(0, INTERFACE_DOF_COUNT)
    const ft = load.slice(INTERFACE_DOF_COUNT)
    upperLoads[index] = upperCondensedLoad
    const topDrive = addVectors(ft, upperCondensedLoad)
    const topResponse = solveCholeskyFactor(stage.factor, topDrive)
    const condensedLoad = subtractVectors(fb, matrixVectorMultiply(module.kbt, topResponse))
    condensedLoads[index] = condensedLoad
    upperCondensedLoad = condensedLoad
  }

  // The bottom interface is the ideal rigid foundation: u0 = 0. Once all
  // upper stacks are condensed, displacements are recovered BOTTOM -> TOP.
  const interfaces = Array.from({ length: model.moduleCount + 1 }, () => zeros(INTERFACE_DOF_COUNT))
  for (let index = 0; index < stack.modules.length; index += 1) {
    const module = stack.modules[index]
    const stage = stack.stages[index]
    const load = moduleLoads[index]
    const ub = interfaces[index]
    const ft = load.slice(INTERFACE_DOF_COUNT)
    const rhs = subtractVectors(
      addVectors(ft, upperLoads[index]),
      matrixVectorMultiply(module.ktb, ub),
    )
    interfaces[index + 1] = solveCholeskyFactor(stage.factor, rhs)
  }

  const displacementVector = new Float64Array(model.nodes.length * DOF_PER_NODE)
  for (let level = 0; level < interfaces.length; level += 1) {
    const nodeIds = level === 0 ? model.baseNodeIds : model.modules[level - 1].topNodeIds
    for (let nodeIndex = 0; nodeIndex < nodeIds.length; nodeIndex += 1) {
      for (let axis = 0; axis < DOF_PER_NODE; axis += 1) {
        displacementVector[globalDof(nodeIds[nodeIndex], axis)] = interfaces[level][nodeIndex * DOF_PER_NODE + axis]
      }
    }
  }

  const moduleStates = stack.modules.map((module, index) => {
    const displacement = [...interfaces[index], ...interfaces[index + 1]]
    const load = moduleLoads[index]
    const residual = subtractVectors(matrixVectorMultiply(module.stiffness, displacement), load)
    const bottomResidual = residual.slice(0, INTERFACE_DOF_COUNT)
    const topResidual = residual.slice(INTERFACE_DOF_COUNT)
    const topAppliedFromAbove = interfaceActions(module.topNodeIds, topResidual)
    const bottomReactionFromBelow = interfaceActions(module.bottomNodeIds, bottomResidual)
    return {
      moduleIndex: module.index,
      moduleNumber: module.number,
      bottomNodeIds: [...module.bottomNodeIds],
      topNodeIds: [...module.topNodeIds],
      memberIds: [...module.memberIds],
      topAppliedFromAbove,
      bottomReactionFromBelow,
      topResultantFromAbove: resultant(topAppliedFromAbove),
      bottomResultantFromBelow: resultant(bottomReactionFromBelow),
      bottomDisplacement: [...interfaces[index]],
      topDisplacement: [...interfaces[index + 1]],
    }
  })

  let interfaceClosure = 0
  let interfaceScale = 1
  for (let index = 0; index < moduleStates.length - 1; index += 1) {
    const upper = moduleStates[index + 1].bottomReactionFromBelow
    const lower = moduleStates[index].topAppliedFromAbove
    for (let node = 0; node < INTERFACE_NODE_COUNT; node += 1) {
      const pair = [
        ...lower[node].forceN.map((value, axis) => value + upper[node].forceN[axis]),
        ...lower[node].momentNm.map((value, axis) => value + upper[node].momentNm[axis]),
      ]
      interfaceClosure = Math.max(interfaceClosure, ...pair.map(Math.abs))
      interfaceScale = Math.max(
        interfaceScale,
        ...lower[node].forceN.map(Math.abs),
        ...upper[node].forceN.map(Math.abs),
        ...lower[node].momentNm.map(Math.abs),
        ...upper[node].momentNm.map(Math.abs),
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
