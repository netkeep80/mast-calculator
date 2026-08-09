import type { ResolvedProject } from '../../domain/contracts.js'
import {
  addBandValue,
  createSymmetricBandMatrix,
  dotProduct,
  largestGeneralizedEigenpairsBanded,
  multiplySymmetricBand,
  vectorNorm2,
  type SymmetricBandMatrix,
} from '../../numerics/index.js'
import type { GeneratedMastModel } from './geometry.js'
import { compileFrameSystem } from './solver.js'

const DOF_PER_NODE = 6
const TRANSLATIONAL_DOF_COUNT = 3

type CompiledFrameSystem = ReturnType<typeof compileFrameSystem>

export const MODAL_MASS_MODEL_ID = 'frame-lumped-translational-v1' as const

export interface ModalMassComponents {
  readonly steelKg: number
  readonly iceKg: number
  readonly equipmentKg: number
  readonly totalKg: number
}

export interface ModalMassModel {
  readonly id: typeof MODAL_MASS_MODEL_ID
  readonly matrixType: 'diagonal-nodal-lumped-translational'
  readonly rotationalInertiaIncluded: false
  readonly reliabilityFactorsApplied: false
  readonly connectionHardwareMassIncluded: false
  readonly physicalMassKg: ModalMassComponents
  readonly activeTranslationalMassKg: readonly [number, number, number]
  readonly note: string
}

export interface ModalMassAssembly {
  readonly matrix: SymmetricBandMatrix
  readonly model: ModalMassModel
}

export interface ModalParticipation {
  readonly effectiveMassKg: number
  readonly activeMassRatio: number
}

export interface NaturalMode {
  readonly number: number
  readonly angularFrequencyRadS: number
  readonly frequencyHz: number
  readonly omegaSquared: number
  readonly generalizedEigenResidual: number
  readonly dynamicEquationResidual: number
  readonly normalization: 'mass-normalized'
  readonly translations: readonly (readonly [number, number, number])[]
  readonly rotations: readonly (readonly [number, number, number])[]
  readonly participation: {
    readonly x: ModalParticipation
    readonly y: ModalParticipation
    readonly z: ModalParticipation
  }
}

export interface NaturalModesResult {
  readonly solver: 'banded-generalized-subspace-rayleigh-ritz'
  readonly massModel: ModalMassModel
  readonly modes: readonly NaturalMode[]
  readonly iterations: number
  readonly subspaceDimension: number
}

export interface NaturalModesOptions {
  readonly modeCount?: number
  readonly tolerance?: number
  readonly maxIterations?: number
}

function memberLengthM(model: GeneratedMastModel, member: GeneratedMastModel['members'][number]): number {
  const pointA = model.nodes[member.nodeA]?.position
  const pointB = model.nodes[member.nodeB]?.position
  if (!pointA || !pointB) throw new Error(`Некорректный стержень ${member.id} при сборке массы`)
  return Math.hypot(
    pointB[0] - pointA[0],
    pointB[1] - pointA[1],
    pointB[2] - pointA[2],
  )
}

function modalPhysicalMass(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
): { nodalMassKg: number[]; components: ModalMassComponents } {
  const nodalMassKg = model.nodes.map(() => 0)
  const iceThicknessM = Math.max(0, parameters.iceThicknessMm) / 1000
  const iceDensityKgM3 = Math.max(0, parameters.iceDensityKgM3)
  let steelKg = 0
  let iceKg = 0

  for (const member of model.members) {
    const lengthM = memberLengthM(model, member)
    const steelAreaM2 = Math.PI * member.diameterM ** 2 / 4
    const outerDiameterM = member.diameterM + 2 * iceThicknessM
    const iceAreaM2 = Math.PI * Math.max(0, outerDiameterM ** 2 - member.diameterM ** 2) / 4
    const memberSteelKg = member.densityKgM3 * steelAreaM2 * lengthM
    const memberIceKg = iceDensityKgM3 * iceAreaM2 * lengthM
    const memberMassKg = memberSteelKg + memberIceKg
    steelKg += memberSteelKg
    iceKg += memberIceKg
    nodalMassKg[member.nodeA] = nodalMassKg[member.nodeA]! + memberMassKg / 2
    nodalMassKg[member.nodeB] = nodalMassKg[member.nodeB]! + memberMassKg / 2
  }

  const equipmentKg = Math.max(0, Number(parameters.equipmentMassKg))
  if (model.topNodeIds.length > 0) {
    const perTopNodeKg = equipmentKg / model.topNodeIds.length
    for (const nodeId of model.topNodeIds) nodalMassKg[nodeId] = nodalMassKg[nodeId]! + perTopNodeKg
  }

  return {
    nodalMassKg,
    components: {
      steelKg,
      iceKg,
      equipmentKg,
      totalKg: steelKg + iceKg + equipmentKg,
    },
  }
}

function assembleModalMassForSystem(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  system: CompiledFrameSystem,
): ModalMassAssembly {
  const { nodalMassKg, components } = modalPhysicalMass(model, parameters)
  const matrix = createSymmetricBandMatrix(system.freeDofs.length, 0)
  const active: [number, number, number] = [0, 0, 0]

  for (const node of model.nodes) {
    const massKg = nodalMassKg[node.id] ?? 0
    for (let axis = 0; axis < TRANSLATIONAL_DOF_COUNT; axis += 1) {
      const globalDof = node.id * DOF_PER_NODE + axis
      const reducedDof = system.reducedIndexByGlobalDof[globalDof] ?? -1
      if (reducedDof < 0) continue
      addBandValue(matrix, reducedDof, reducedDof, massKg)
      active[axis] = (active[axis] ?? 0) + massKg
    }
  }

  return {
    matrix,
    model: {
      id: MODAL_MASS_MODEL_ID,
      matrixType: 'diagonal-nodal-lumped-translational',
      rotationalInertiaIncluded: false,
      reliabilityFactorsApplied: false,
      connectionHardwareMassIncluded: false,
      physicalMassKg: components,
      activeTranslationalMassKg: active,
      note: 'Physical member steel, physical ice and top equipment mass are lumped equally to member/top nodes. Load reliability factors are never inertia mass. Rotational inertia and connection hardware mass are intentionally outside v1.',
    },
  }
}

export function assembleModalMass(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
): ModalMassAssembly {
  return assembleModalMassForSystem(model, parameters, compileFrameSystem(model, parameters))
}

function massNormalize(vector: readonly number[], mass: SymmetricBandMatrix): number[] {
  const product = multiplySymmetricBand(mass, vector)
  const modalMass = dotProduct(vector, product)
  if (!(modalMass > 1e-14)) throw new Error('Собственная форма имеет нулевую модальную массу')
  const scale = 1 / Math.sqrt(modalMass)
  const normalized = vector.map((value) => value * scale)

  let governingIndex = -1
  let governingMagnitude = 0
  for (let index = 0; index < normalized.length; index += 1) {
    const magnitude = Math.abs(normalized[index]!)
    if (magnitude > governingMagnitude) {
      governingMagnitude = magnitude
      governingIndex = index
    }
  }
  if (governingIndex >= 0 && normalized[governingIndex]! < 0) return normalized.map((value) => -value)
  return normalized
}

function dynamicResidual(
  stiffness: SymmetricBandMatrix,
  mass: SymmetricBandMatrix,
  vector: readonly number[],
  omegaSquared: number,
): number {
  const stiffnessPart = multiplySymmetricBand(stiffness, vector)
  const massPart = multiplySymmetricBand(mass, vector)
  const residual = new Float64Array(vector.length)
  for (let index = 0; index < residual.length; index += 1) {
    residual[index] = stiffnessPart[index]! - omegaSquared * massPart[index]!
  }
  return vectorNorm2(residual) / Math.max(
    Number.EPSILON,
    vectorNorm2(stiffnessPart),
    omegaSquared * vectorNorm2(massPart),
  )
}

function participationForAxis(
  model: GeneratedMastModel,
  reducedIndexByGlobalDof: Int32Array,
  mass: SymmetricBandMatrix,
  mode: readonly number[],
  axis: number,
  activeMassKg: number,
): ModalParticipation {
  const influence = new Float64Array(mass.size)
  for (const node of model.nodes) {
    const reducedDof = reducedIndexByGlobalDof[node.id * DOF_PER_NODE + axis] ?? -1
    if (reducedDof >= 0) influence[reducedDof] = 1
  }
  const massInfluence = multiplySymmetricBand(mass, influence)
  const participationFactor = dotProduct(mode, massInfluence)
  const effectiveMassKg = participationFactor * participationFactor
  return {
    effectiveMassKg,
    activeMassRatio: activeMassKg > 0 ? effectiveMassKg / activeMassKg : 0,
  }
}

function mapModeToNodes(
  model: GeneratedMastModel,
  reducedIndexByGlobalDof: Int32Array,
  vector: readonly number[],
): {
  translations: Array<[number, number, number]>
  rotations: Array<[number, number, number]>
} {
  const component = (nodeId: number, axis: number): number => {
    const reducedDof = reducedIndexByGlobalDof[nodeId * DOF_PER_NODE + axis] ?? -1
    return reducedDof >= 0 ? vector[reducedDof] ?? 0 : 0
  }
  return {
    translations: model.nodes.map((node) => [component(node.id, 0), component(node.id, 1), component(node.id, 2)]),
    rotations: model.nodes.map((node) => [component(node.id, 3), component(node.id, 4), component(node.id, 5)]),
  }
}

export function calculateNaturalModes(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  options: NaturalModesOptions = {},
): NaturalModesResult {
  const system = compileFrameSystem(model, parameters)
  const massAssembly = assembleModalMassForSystem(model, parameters, system)
  const requested = Math.max(1, Math.floor(options.modeCount ?? 6))
  const positiveMassDofs = massAssembly.matrix.rows.reduce(
    (count, row) => count + (row[0]! > 0 ? 1 : 0),
    0,
  )
  const modeCount = Math.min(requested, positiveMassDofs, system.freeDofs.length)
  if (modeCount < 1) throw new Error('В расчётной системе отсутствует активная физическая масса')

  const eigensolution = largestGeneralizedEigenpairsBanded(
    system.reducedStiffness,
    system.factorization,
    massAssembly.matrix,
    {
      eigenpairCount: modeCount,
      tolerance: options.tolerance ?? 1e-8,
      maxIterations: options.maxIterations ?? 100,
      oversampling: 4,
    },
  )

  const active = massAssembly.model.activeTranslationalMassKg
  const modes = eigensolution.eigenpairs.map((pair, index): NaturalMode => {
    const normalized = massNormalize(pair.vector, massAssembly.matrix)
    const omegaSquared = 1 / pair.eigenvalue
    const angularFrequencyRadS = Math.sqrt(omegaSquared)
    const mapped = mapModeToNodes(model, system.reducedIndexByGlobalDof, normalized)
    return {
      number: index + 1,
      angularFrequencyRadS,
      frequencyHz: angularFrequencyRadS / (2 * Math.PI),
      omegaSquared,
      generalizedEigenResidual: pair.residual,
      dynamicEquationResidual: dynamicResidual(
        system.reducedStiffness,
        massAssembly.matrix,
        normalized,
        omegaSquared,
      ),
      normalization: 'mass-normalized',
      translations: mapped.translations,
      rotations: mapped.rotations,
      participation: {
        x: participationForAxis(model, system.reducedIndexByGlobalDof, massAssembly.matrix, normalized, 0, active[0]),
        y: participationForAxis(model, system.reducedIndexByGlobalDof, massAssembly.matrix, normalized, 1, active[1]),
        z: participationForAxis(model, system.reducedIndexByGlobalDof, massAssembly.matrix, normalized, 2, active[2]),
      },
    }
  })

  return {
    solver: 'banded-generalized-subspace-rayleigh-ritz',
    massModel: massAssembly.model,
    modes,
    iterations: eigensolution.iterations,
    subspaceDimension: eigensolution.subspaceDimension,
  }
}
