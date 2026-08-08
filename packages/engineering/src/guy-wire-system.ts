import type { ResolvedProject } from '../../domain/contracts.js'
import {
  DEFAULT_GUY_SAFETY_FACTOR,
  DEFAULT_GUY_TERMINATION_EFFICIENCY,
  DEFAULT_GUY_WIRE_ID,
  calculateGuyWireCapacity,
  getGuyWireSpec,
  type GuyWireCapacity,
  type GuyWireSpec,
} from '../../domain/index.js'
import {
  add3,
  addBandValue,
  cloneSymmetricBandMatrix,
  factorSymmetricBand,
  norm3,
  scale3,
  sub3,
  unit3,
} from '../../numerics/index.js'
import {
  buildLoadCase,
  compileFrameSystem,
  generateMastModel,
  type BuiltLoadCase,
  type GeneratedMastModel,
} from '../../structural-analysis/index.js'
import { analyzeCheckedFrame } from './member-check.js'

const DOF_PER_NODE = 6
const DEG = Math.PI / 180
const TWO_PI = 2 * Math.PI
const PASS_TOLERANCE = 1e-9

type Vector3 = [number, number, number]
type Matrix3 = [Vector3, Vector3, Vector3]
type FrameSystem = ReturnType<typeof compileFrameSystem>
type CheckedAnalysis = ReturnType<typeof analyzeCheckedFrame>
type MastNode = GeneratedMastModel['nodes'][number]
type CableState = ReturnType<typeof cableState>
type GuyCable = ReturnType<typeof buildCable>
type GuyCableSystem = ReturnType<typeof buildGuyWireSystem>
type GuyedLoadCase = ReturnType<typeof solveGuyedLoadCase>

export interface GuyAnalysisOptions {
  safetyFactor: number
  terminationEfficiency: number
  maximumIterations: number
  displacementToleranceM: number
  relativeTensionTolerance: number
}

export interface GuyTierInput {
  id?: string
  heightM?: number
  anchorRadiusM?: number
  anchorDistanceM?: number
  guyCount?: number
  azimuthOffsetDeg?: number
  pretensionN?: number
  wireId?: string
  safetyFactor?: number
  terminationEfficiency?: number
}

export type GuyCalculationOptions = Partial<GuyAnalysisOptions>

interface NormalizedTier {
  id: string
  number: number
  requestedHeightM: number
  level: number
  actualHeightM: number
  heightSnapM: number
  anchorRadiusM: number
  guyCount: number
  azimuthOffsetDeg: number
  pretensionN: number
  wire: GuyWireSpec
  capacity: GuyWireCapacity
}

interface GuyEquivalentLoad {
  cableId: string
  equivalentForceN: Vector3
}

type GuySolverLoadCase = BuiltLoadCase & {
  guyEquivalentResultantN?: Vector3
  guyEquivalentLoads?: GuyEquivalentLoad[]
}

export const DEFAULT_GUY_ANALYSIS_OPTIONS: Readonly<GuyAnalysisOptions> = Object.freeze({
  safetyFactor: DEFAULT_GUY_SAFETY_FACTOR,
  terminationEfficiency: DEFAULT_GUY_TERMINATION_EFFICIENCY,
  maximumIterations: 25,
  displacementToleranceM: 1e-8,
  relativeTensionTolerance: 1e-6,
})

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const globalDof = (nodeId: number, axis: number): number => nodeId * DOF_PER_NODE + axis
const toVector3 = (value: readonly number[]): Vector3 => [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]
const matrixVector3 = (matrix: Matrix3, vector: readonly number[]): Vector3 => [
  matrix[0][0] * (vector[0] ?? 0) + matrix[0][1] * (vector[1] ?? 0) + matrix[0][2] * (vector[2] ?? 0),
  matrix[1][0] * (vector[0] ?? 0) + matrix[1][1] * (vector[1] ?? 0) + matrix[1][2] * (vector[2] ?? 0),
  matrix[2][0] * (vector[0] ?? 0) + matrix[2][1] * (vector[1] ?? 0) + matrix[2][2] * (vector[2] ?? 0),
]

function normalizeAngleRad(value: number): number {
  return ((value % TWO_PI) + TWO_PI) % TWO_PI
}

function angularDistanceRad(left: number, right: number): number {
  const delta = Math.atan2(Math.sin(left - right), Math.cos(left - right))
  return Math.abs(delta)
}

function nodeAzimuth(node: MastNode): number {
  return normalizeAngleRad(Math.atan2(node.position[1], node.position[0]))
}

function levelAttachmentNodes(model: GeneratedMastModel, level: number): MastNode[] {
  const nodes = model.nodes
    .filter((node) => node.level === level)
    .sort((left, right) => nodeAzimuth(left) - nodeAzimuth(right))
  if (nodes.length !== 3) {
    throw new Error(`Уровень ${level}: ожидалось три узла крепления, найдено ${nodes.length}`)
  }
  return nodes
}

function anchorAzimuthRad(tier: Pick<NormalizedTier, 'azimuthOffsetDeg' | 'guyCount'>, cableIndex: number): number {
  return normalizeAngleRad((tier.azimuthOffsetDeg + cableIndex * 360 / tier.guyCount) * DEG)
}

function balancedAttachmentNodes(model: GeneratedMastModel, tier: NormalizedTier): MastNode[] {
  const nodes = levelAttachmentNodes(model, tier.level)
  const slotByCable = Array.from(
    { length: tier.guyCount },
    (_, cableIndex) => Math.floor((cableIndex + 0.5) * 3 / tier.guyCount),
  )
  let best: { assigned: MastNode[]; mismatch: number } | null = null
  for (let shift = 0; shift < 3; shift += 1) {
    const assigned = slotByCable.map((slot) => nodes[(slot + shift) % 3]!)
    const mismatch = assigned.reduce((sum, node, cableIndex) => (
      sum + angularDistanceRad(nodeAzimuth(node), anchorAzimuthRad(tier, cableIndex))
    ), 0)
    if (best == null || mismatch < best.mismatch - 1e-12) best = { assigned, mismatch }
  }
  if (!best) throw new Error(`Ярус ${tier.number}: не удалось распределить точки крепления`)
  return best.assigned
}

function normalizeTier(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  tier: GuyTierInput,
  tierIndex: number,
  options: GuyAnalysisOptions,
): NormalizedTier {
  const moduleHeightM = parameters.moduleHeightMm / 1000
  const requestedHeightM = Number(tier.heightM ?? (tierIndex + 1) * moduleHeightM)
  if (!(requestedHeightM > 0)) throw new Error(`Ярус ${tierIndex + 1}: высота крепления должна быть больше 0`)
  const level = clamp(Math.round(requestedHeightM / moduleHeightM), 1, model.moduleCount)
  const actualHeightM = model.nodes.find((node) => node.level === level)?.position[2]
  if (actualHeightM == null) throw new Error(`Ярус ${tierIndex + 1}: не найден уровень крепления ${level}`)
  const anchorRadiusM = Number(tier.anchorRadiusM ?? tier.anchorDistanceM ?? 5)
  if (!(anchorRadiusM > 0)) throw new Error(`Ярус ${tierIndex + 1}: расстояние до анкера должно быть больше 0`)
  const guyCount = clamp(Math.round(Number(tier.guyCount ?? 3)), 3, 6)
  const azimuthOffsetDeg = Number(tier.azimuthOffsetDeg ?? 0)
  if (!Number.isFinite(azimuthOffsetDeg)) throw new Error(`Ярус ${tierIndex + 1}: азимут должен быть числом`)
  const pretensionN = Number(tier.pretensionN ?? 1000)
  if (!(pretensionN >= 0)) throw new Error(`Ярус ${tierIndex + 1}: преднатяг не может быть отрицательным`)
  const wire = getGuyWireSpec(tier.wireId ?? DEFAULT_GUY_WIRE_ID)
  const capacity = calculateGuyWireCapacity(wire, {
    safetyFactor: tier.safetyFactor ?? options.safetyFactor,
    terminationEfficiency: tier.terminationEfficiency ?? options.terminationEfficiency,
  })
  return {
    id: tier.id ?? `tier-${tierIndex + 1}`,
    number: tierIndex + 1,
    requestedHeightM,
    level,
    actualHeightM,
    heightSnapM: actualHeightM - requestedHeightM,
    anchorRadiusM,
    guyCount,
    azimuthOffsetDeg,
    pretensionN,
    wire,
    capacity,
  }
}

function buildCable(tier: NormalizedTier, cableIndex: number, attachment: MastNode) {
  const azimuthRad = anchorAzimuthRad(tier, cableIndex)
  const azimuthDeg = azimuthRad / DEG
  const anchorPosition: Vector3 = [
    tier.anchorRadiusM * Math.cos(azimuthRad),
    tier.anchorRadiusM * Math.sin(azimuthRad),
    0,
  ]
  const attachmentPosition: Vector3 = [...attachment.position]
  const initialVector = sub3(anchorPosition, attachmentPosition)
  const initialLengthM = norm3(initialVector)
  if (!(initialLengthM > 0)) throw new Error(`Растяжка ${tier.number}.${cableIndex + 1}: нулевая длина`)
  const horizontalSpanM = Math.hypot(initialVector[0], initialVector[1])
  const areaM2 = tier.wire.metallicAreaMm2 * 1e-6
  const youngModulusPa = tier.wire.effectiveYoungModulusGPa * 1e9
  const axialStiffnessNPerM = youngModulusPa * areaM2 / initialLengthM
  return {
    id: `${tier.id}-guy-${cableIndex + 1}`,
    tierId: tier.id,
    tierNumber: tier.number,
    cableNumber: cableIndex + 1,
    attachmentNodeId: attachment.id,
    attachmentLevel: tier.level,
    attachmentPosition,
    anchorPosition,
    anchorAzimuthDeg: azimuthDeg,
    anchorRadiusM: tier.anchorRadiusM,
    initialLengthM,
    horizontalSpanM,
    initialAngleToHorizontalDeg: Math.atan2(attachmentPosition[2], horizontalSpanM) / DEG,
    initialAngleToVerticalDeg: 90 - Math.atan2(attachmentPosition[2], horizontalSpanM) / DEG,
    pretensionN: tier.pretensionN,
    wire: tier.wire,
    capacity: tier.capacity,
    areaM2,
    youngModulusPa,
    axialStiffnessNPerM,
    massKg: tier.wire.massKgM * initialLengthM,
  }
}

export function buildGuyWireSystem(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  tiers: readonly GuyTierInput[] = [],
  inputOptions: Partial<GuyAnalysisOptions> = {},
) {
  const options: GuyAnalysisOptions = { ...DEFAULT_GUY_ANALYSIS_OPTIONS, ...inputOptions }
  const normalizedTiers = tiers.map((tier, index) => normalizeTier(model, parameters, tier, index, options))
  const cables = normalizedTiers.flatMap((tier) => {
    const attachments = balancedAttachmentNodes(model, tier)
    return attachments.map((attachment, cableIndex) => buildCable(tier, cableIndex, attachment))
  })
  return {
    method: 'tension-only-prestressed-straight-cable-newton-v1' as const,
    options,
    tiers: normalizedTiers,
    cables,
    totalCableLengthM: cables.reduce((sum, cable) => sum + cable.initialLengthM, 0),
    totalCableMassKg: cables.reduce((sum, cable) => sum + cable.massKg, 0),
  }
}

export function guyWindDirections(parameters: ResolvedProject): number[] {
  if (!parameters.windEnvelopeEnabled) return [parameters.windDirectionDeg]
  const step = Number(parameters.windEnvelopeStepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 180) {
    throw new Error('Шаг перебора направлений ветра должен быть от 0 до 180°')
  }
  const directions: number[] = []
  for (let angle = 0; angle < 360 - step / 1000; angle += step) directions.push(angle)
  return directions
}

function zeroMatrix3(): Matrix3 {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
}

function cableState(cable: GuyCable, displacement: readonly number[] = [0, 0, 0]) {
  const displacement3 = toVector3(displacement)
  const deformedAttachment = add3(cable.attachmentPosition, displacement3)
  const toAnchor = sub3(cable.anchorPosition, deformedAttachment)
  const currentLengthM = norm3(toAnchor)
  const directionToAnchor = unit3(toAnchor)
  const extensionM = currentLengthM - cable.initialLengthM
  const rawTensionN = cable.pretensionN + cable.axialStiffnessNPerM * extensionM
  const tensionN = Math.max(0, rawTensionN)
  const active = tensionN > 1e-9
  const tangent = zeroMatrix3()
  if (active) {
    const axial = cable.axialStiffnessNPerM
    const geometric = tensionN / Math.max(currentLengthM, Number.EPSILON)
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const nn = directionToAnchor[row]! * directionToAnchor[column]!
        tangent[row]![column] = axial * nn + geometric * ((row === column ? 1 : 0) - nn)
      }
    }
  }
  const forceOnMastN: Vector3 = active ? scale3(directionToAnchor, tensionN) : [0, 0, 0]
  return {
    cableId: cable.id,
    displacement: displacement3,
    deformedAttachment,
    currentLengthM,
    extensionM,
    strain: extensionM / cable.initialLengthM,
    directionToAnchor,
    rawTensionN,
    tensionN,
    active,
    slack: !active,
    tangentStiffnessNPerM: tangent,
    forceOnMastN,
  }
}

function compileWithCableTangents(
  baseSystem: FrameSystem,
  cableSystem: GuyCableSystem,
  states: readonly CableState[],
) {
  const stiffness = cloneSymmetricBandMatrix(baseSystem.reducedStiffness)
  for (let index = 0; index < cableSystem.cables.length; index += 1) {
    const cable = cableSystem.cables[index]!
    const state = states[index]!
    if (!state.active) continue
    for (let rowAxis = 0; rowAxis < 3; rowAxis += 1) {
      const row = baseSystem.reducedIndexByGlobalDof[globalDof(cable.attachmentNodeId, rowAxis)]!
      if (row < 0) continue
      for (let columnAxis = 0; columnAxis <= rowAxis; columnAxis += 1) {
        const column = baseSystem.reducedIndexByGlobalDof[globalDof(cable.attachmentNodeId, columnAxis)]!
        if (column < 0) continue
        addBandValue(stiffness, row, column, state.tangentStiffnessNPerM[rowAxis]![columnAxis]!)
      }
    }
  }
  return {
    ...baseSystem,
    reducedStiffness: stiffness,
    factorization: factorSymmetricBand(stiffness),
    factorizationCount: baseSystem.factorizationCount + 1,
    guyCableMethod: cableSystem.method,
  }
}

function cloneLoadCase(base: BuiltLoadCase): GuySolverLoadCase {
  return {
    ...base,
    nodalLoads: base.nodalLoads.map((load) => [...load] as Vector3),
    nodalMoments: base.nodalMoments.map((moment) => [...moment] as Vector3),
    memberDistributedLoads: base.memberDistributedLoads.map((load) => [...load] as Vector3),
    memberLoadDetails: base.memberLoadDetails.map((detail) => detail == null ? null : { ...detail }),
    totalAppliedLoad: [...base.totalAppliedLoad] as Vector3,
    distributedResultant: [...base.distributedResultant] as Vector3,
    nodalResultant: [...base.nodalResultant] as Vector3,
  }
}

function addForce(target: Vector3, value: readonly number[]): void {
  target[0] += value[0] ?? 0
  target[1] += value[1] ?? 0
  target[2] += value[2] ?? 0
}

function buildNewtonLoadCase(
  baseLoadCase: BuiltLoadCase,
  cableSystem: GuyCableSystem,
  states: readonly CableState[],
): GuySolverLoadCase {
  const loadCase = cloneLoadCase(baseLoadCase)
  let equivalentCableResultantN: Vector3 = [0, 0, 0]
  const equivalentCableLoads: GuyEquivalentLoad[] = []
  for (let index = 0; index < cableSystem.cables.length; index += 1) {
    const cable = cableSystem.cables[index]!
    const state = states[index]!
    if (!state.active) {
      equivalentCableLoads.push({ cableId: cable.id, equivalentForceN: [0, 0, 0] })
      continue
    }
    const tangentTimesU = matrixVector3(state.tangentStiffnessNPerM, state.displacement)
    const equivalentForceN = add3(state.forceOnMastN, tangentTimesU)
    const nodalLoad = loadCase.nodalLoads[cable.attachmentNodeId]
    if (!nodalLoad) throw new Error(`Растяжка ${cable.id}: не найден узел нагрузки ${cable.attachmentNodeId}`)
    addForce(nodalLoad, equivalentForceN)
    equivalentCableResultantN = add3(equivalentCableResultantN, equivalentForceN)
    equivalentCableLoads.push({ cableId: cable.id, equivalentForceN })
  }
  loadCase.nodalResultant = add3(loadCase.nodalResultant, equivalentCableResultantN)
  loadCase.totalAppliedLoad = add3(loadCase.distributedResultant, loadCase.nodalResultant)
  loadCase.guyEquivalentResultantN = equivalentCableResultantN
  loadCase.guyEquivalentLoads = equivalentCableLoads
  return loadCase
}

function maxDisplacementChange(left: readonly (readonly number[])[], right: readonly (readonly number[])[]): number {
  let maximum = 0
  for (let nodeId = 0; nodeId < left.length; nodeId += 1) {
    maximum = Math.max(maximum, norm3(sub3(toVector3(left[nodeId]!), toVector3(right[nodeId]!))))
  }
  return maximum
}

function maxRelativeTensionChange(previous: readonly CableState[], next: readonly CableState[]): number {
  let maximum = 0
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index]!
    const after = next[index]!
    const scale = Math.max(1, before.tensionN, after.tensionN)
    maximum = Math.max(maximum, Math.abs(before.tensionN - after.tensionN) / scale)
  }
  return maximum
}

function correctFreeNodeResiduals(
  analysis: CheckedAnalysis,
  system: FrameSystem,
  cableSystem: GuyCableSystem,
  states: readonly CableState[],
): void {
  const corrected = analysis.reactions.map((reaction) => [...reaction] as Vector3)
  for (let index = 0; index < cableSystem.cables.length; index += 1) {
    const cable = cableSystem.cables[index]!
    const state = states[index]!
    if (!state.active) continue
    const ku = matrixVector3(state.tangentStiffnessNPerM, state.displacement)
    const reaction = corrected[cable.attachmentNodeId]
    if (!reaction) throw new Error(`Растяжка ${cable.id}: не найден узел реакции ${cable.attachmentNodeId}`)
    addForce(reaction, ku)
  }
  let maximumFreeResidualN = 0
  for (const globalDegree of system.freeDofs) {
    const nodeId = Math.floor(globalDegree / DOF_PER_NODE)
    const axis = globalDegree % DOF_PER_NODE
    if (axis < 3) maximumFreeResidualN = Math.max(maximumFreeResidualN, Math.abs(corrected[nodeId]?.[axis] ?? 0))
  }
  analysis.reactions = corrected
  const diagnostics = analysis.diagnostics as CheckedAnalysis['diagnostics'] & { maximumGuyCorrectedFreeResidualN?: number }
  diagnostics.maximumGuyCorrectedFreeResidualN = maximumFreeResidualN
}

function enrichCableResults(cableSystem: GuyCableSystem, states: readonly CableState[]) {
  return cableSystem.cables.map((cable, index) => {
    const state = states[index]!
    const horizontalSpanM = Math.hypot(
      cable.anchorPosition[0] - state.deformedAttachment[0]!,
      cable.anchorPosition[1] - state.deformedAttachment[1]!,
    )
    const verticalSpanM = state.deformedAttachment[2]! - cable.anchorPosition[2]
    const angleToHorizontalDeg = Math.atan2(Math.abs(verticalSpanM), horizontalSpanM) / DEG
    const utilization = state.tensionN / Math.max(cable.capacity.designWorkingLoadN, Number.EPSILON)
    return {
      ...cable,
      currentLengthM: state.currentLengthM,
      extensionMm: state.extensionM * 1000,
      strain: state.strain,
      angleToHorizontalDeg,
      angleToVerticalDeg: 90 - angleToHorizontalDeg,
      tensionN: state.tensionN,
      rawTensionN: state.rawTensionN,
      slack: state.slack,
      forceOnMastN: [...state.forceOnMastN] as Vector3,
      moduleNodeReactionN: scale3(state.forceOnMastN, -1),
      anchorLoadN: scale3(state.forceOnMastN, -1),
      utilization,
      passes: utilization <= 1 + PASS_TOLERANCE,
    }
  })
}

export function solveGuyedLoadCase(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  cableSystem: GuyCableSystem,
  windDirectionDeg: number,
  inputOptions: Partial<GuyAnalysisOptions> = {},
) {
  const options: GuyAnalysisOptions = { ...cableSystem.options, ...inputOptions }
  const caseParameters: ResolvedProject = { ...parameters, windDirectionDeg }
  const baseLoadCase = buildLoadCase(model, caseParameters)
  const baseSystem = compileFrameSystem(model, caseParameters)
  let trialDisplacements: Vector3[] = model.nodes.map(() => [0, 0, 0])
  let states = cableSystem.cables.map((cable) => cableState(cable))
  let analysis: CheckedAnalysis | null = null
  let solverLoadCase: GuySolverLoadCase | null = null
  let system: ReturnType<typeof compileWithCableTangents> | FrameSystem = baseSystem
  let converged = false
  let displacementChangeM = Number.POSITIVE_INFINITY
  let relativeTensionChange = Number.POSITIVE_INFINITY
  let performedIterations = 0

  for (let iteration = 1; iteration <= options.maximumIterations; iteration += 1) {
    performedIterations = iteration
    states = cableSystem.cables.map((cable) => cableState(cable, trialDisplacements[cable.attachmentNodeId]!))
    system = compileWithCableTangents(baseSystem, cableSystem, states)
    solverLoadCase = buildNewtonLoadCase(baseLoadCase, cableSystem, states)
    analysis = analyzeCheckedFrame(model, solverLoadCase, caseParameters, system as FrameSystem)
    const nextDisplacements = analysis.displacements.map((value) => [...value] as Vector3)
    const nextStates = cableSystem.cables.map((cable) => cableState(cable, nextDisplacements[cable.attachmentNodeId]!))
    displacementChangeM = maxDisplacementChange(trialDisplacements, nextDisplacements)
    relativeTensionChange = maxRelativeTensionChange(states, nextStates)
    trialDisplacements = nextDisplacements
    states = nextStates
    if (
      displacementChangeM <= options.displacementToleranceM
      && relativeTensionChange <= options.relativeTensionTolerance
    ) {
      converged = true
      break
    }
  }

  if (!analysis) {
    solverLoadCase = baseLoadCase
    analysis = analyzeCheckedFrame(model, baseLoadCase, caseParameters, baseSystem)
    trialDisplacements = analysis.displacements.map((value) => [...value] as Vector3)
    states = cableSystem.cables.map((cable) => cableState(cable, trialDisplacements[cable.attachmentNodeId]!))
    displacementChangeM = 0
    relativeTensionChange = 0
    converged = cableSystem.cables.length === 0
  }

  states = cableSystem.cables.map((cable) => cableState(cable, trialDisplacements[cable.attachmentNodeId]!))
  correctFreeNodeResiduals(analysis, system as FrameSystem, cableSystem, states)
  const cables = enrichCableResults(cableSystem, states)
  const maximumCableUtilization = cables.length === 0 ? 0 : Math.max(...cables.map((cable) => cable.utilization))
  return {
    windDirectionDeg,
    parameters: caseParameters,
    baseLoads: baseLoadCase,
    solverLoads: solverLoadCase,
    analysis,
    cables,
    maximumCableUtilization,
    slackCableCount: cables.filter((cable) => cable.slack).length,
    nonlinear: {
      method: cableSystem.method,
      converged,
      iterations: performedIterations,
      displacementChangeM,
      relativeTensionChange,
    },
  }
}

function caseScore(loadCase: GuyedLoadCase, parameters: ResolvedProject): number {
  const bucklingRatio = Number.isFinite(loadCase.analysis.buckling.criticalLoadFactor)
    ? parameters.minimumBucklingFactor / Math.max(loadCase.analysis.buckling.criticalLoadFactor, Number.EPSILON)
    : 0
  const displacementRatio = loadCase.analysis.maxTopDisplacementM * 1000
    / Math.max(parameters.displacementLimitMm, Number.EPSILON)
  return Math.max(
    loadCase.analysis.maxUtilization,
    bucklingRatio,
    displacementRatio,
    loadCase.maximumCableUtilization,
  )
}

function maximumCase<T extends object>(cases: readonly T[], selector: (value: T) => number): T {
  const first = cases[0]
  if (!first) throw new Error('Не сформирован ни один расчётный случай растяжек')
  let best: T = first
  for (const candidate of cases.slice(1)) {
    if (selector(candidate) > selector(best)) best = candidate
  }
  return best
}

function minimumCase<T extends object>(cases: readonly T[], selector: (value: T) => number): T {
  const first = cases[0]
  if (!first) throw new Error('Не сформирован ни один расчётный случай растяжек')
  let best: T = first
  for (const candidate of cases.slice(1)) {
    if (selector(candidate) < selector(best)) best = candidate
  }
  return best
}

function cableEnvelopeFor(cases: readonly GuyedLoadCase[], definition: GuyCable) {
  const samples = cases.map((loadCase) => {
    const sample = loadCase.cables.find((item) => item.id === definition.id)
    if (!sample) throw new Error(`Для растяжки ${definition.id} отсутствует sample в ветровой огибающей`)
    return sample
  })
  const maximum = maximumCase(samples, (item) => item.tensionN)
  const minimum = minimumCase(samples, (item) => item.tensionN)
  const maximumCaseIndex = samples.indexOf(maximum)
  const minimumCaseIndex = samples.indexOf(minimum)
  return {
    ...definition,
    maximumTensionN: maximum.tensionN,
    maximumUtilization: maximum.utilization,
    maximumAtWindDirectionDeg: cases[maximumCaseIndex]!.windDirectionDeg,
    minimumTensionN: minimum.tensionN,
    minimumAtWindDirectionDeg: cases[minimumCaseIndex]!.windDirectionDeg,
    slackInEnvelope: samples.some((item) => item.slack),
    passes: maximum.utilization <= 1 + PASS_TOLERANCE,
  }
}

export function calculateGuyedMast(
  parameters: ResolvedProject,
  tiers: readonly GuyTierInput[] = [],
  inputOptions: GuyCalculationOptions = {},
) {
  const model = generateMastModel(parameters)
  const cableSystem = buildGuyWireSystem(model, parameters, tiers, inputOptions)
  const directions = guyWindDirections(parameters)
  const cases = directions.map((direction) => solveGuyedLoadCase(
    model,
    parameters,
    cableSystem,
    direction,
    inputOptions,
  ))
  const governing = maximumCase(cases, (item) => caseScore(item, parameters))
  const strength = maximumCase(cases, (item) => item.analysis.maxUtilization)
  const displacement = maximumCase(cases, (item) => item.analysis.maxTopDisplacementM)
  const buckling = minimumCase(cases, (item) => item.analysis.buckling.criticalLoadFactor)
  const cable = maximumCase(cases, (item) => item.maximumCableUtilization)
  const cableEnvelope = cableSystem.cables.map((definition) => cableEnvelopeFor(cases, definition))
  const warnings = [
    'Растяжки рассчитаны как прямые преднатянутые tension-only кабели с геометрически нелинейным направлением силы и Newton-итерацией. Провисание/catenary, собственный вес, ветер и лёд на сам трос пока не прикладываются к FEM.',
    'Анкер считается неподвижным. Несущая способность грунтового анкера, талрепа, коуша, зажимов и местного узла крепления к мачте должна проверяться отдельно по максимальной реакции растяжки.',
    'Высота крепления привязывается к ближайшему существующему уровню модуля; растяжки яруса распределяются между тремя физическими узлами максимально равномерно.',
    'Расчётная рабочая нагрузка троса получается из минимальной разрывной нагрузки с явными коэффициентами эффективности заделки и запаса. Паспорт конкретного троса и заделки имеет приоритет над встроенным справочником.',
    'Для мачты с растяжками ветровая огибающая перебирается по полным 360° без 120° сокращения: произвольные 3–6 растяжек могут нарушать симметрию голой мачты.',
  ]
  if (cases.some((item) => !item.nonlinear.converged)) warnings.unshift('Нелинейная итерация растяжек не сошлась за заданное число шагов: результат нельзя принимать как расчётный.')
  if (cableEnvelope.some((item) => item.slackInEnvelope)) warnings.unshift('В части ветровой огибающей одна или несколько растяжек полностью разгружаются; tension-only active set это учитывает.')
  if (cableEnvelope.some((item) => !item.passes)) warnings.unshift('Минимум одна растяжка превышает расчётную рабочую нагрузку с выбранным запасом.')
  const passes = cases.every((item) => item.nonlinear.converged)
    && strength.analysis.maxUtilization <= 1 + PASS_TOLERANCE
    && displacement.analysis.maxTopDisplacementM * 1000 <= parameters.displacementLimitMm + PASS_TOLERANCE
    && (!Number.isFinite(buckling.analysis.buckling.criticalLoadFactor)
      || buckling.analysis.buckling.criticalLoadFactor + PASS_TOLERANCE >= parameters.minimumBucklingFactor)
    && cable.maximumCableUtilization <= 1 + PASS_TOLERANCE
  return {
    parameters,
    model,
    cableSystem,
    cases,
    cableEnvelope,
    passes,
    warnings,
    envelope: {
      governing,
      strength,
      displacement,
      buckling,
      cable,
      caseCount: cases.length,
      maxUtilization: strength.analysis.maxUtilization,
      maxTopDisplacementM: displacement.analysis.maxTopDisplacementM,
      minimumBucklingFactor: buckling.analysis.buckling.criticalLoadFactor,
      maximumCableUtilization: cable.maximumCableUtilization,
    },
  }
}
