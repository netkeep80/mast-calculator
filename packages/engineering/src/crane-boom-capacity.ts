import type { ResolvedProject } from '../../domain/contracts.js'
import { selectedBoltUtilizationForAnalysis } from './connection-check.js'
import { STANDARD_GRAVITY_M_S2 } from './lateral-capacity.js'
import {
  buildLoadCase,
  compileFrameSystem,
  type BuiltLoadCase,
  type GeneratedMastModel,
} from '../../structural-analysis/index.js'
import { analyzeCheckedFrame } from './member-check.js'

export const CRANE_BOOM_BISECTION_ITERATIONS = 16
export const CRANE_BOOM_MAX_PAYLOAD_KG = 1e7
const ROTATIONAL_SYMMETRY_DEG = 120

type Vector3 = [number, number, number]
type FrameSystem = ReturnType<typeof compileFrameSystem>
type CheckedAnalysis = ReturnType<typeof analyzeCheckedFrame>
type MastMember = GeneratedMastModel['members'][number]
type BoomLoadCase = BuiltLoadCase & {
  horizontalBoom: true
  horizontalBoomPayloadMassKg: number
  horizontalBoomPayloadForceN: number
  horizontalBoomDirectionDeg: number
}
type DirectionalLimit = ReturnType<typeof findDirectionalLimit>

export interface CraneBoomProgress {
  stage: 'crane-boom'
  directionDeg: number
  iteration: number
  totalIterations: number
  payloadMassKg: number
}

export interface CraneBoomCapacityOptions {
  stepDeg?: number
  frameSystem?: FrameSystem
  onProgress?: (progress: CraneBoomProgress) => void
}

const add3 = (a: readonly number[], b: readonly number[]): Vector3 => [
  (a[0] ?? 0) + (b[0] ?? 0),
  (a[1] ?? 0) + (b[1] ?? 0),
  (a[2] ?? 0) + (b[2] ?? 0),
]
const scale3 = (a: readonly number[], factor: number): Vector3 => [
  (a[0] ?? 0) * factor,
  (a[1] ?? 0) * factor,
  (a[2] ?? 0) * factor,
]

function directions(stepDeg: unknown): number[] {
  const step = Number(stepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 60) {
    throw new Error('Шаг расчёта стрелы должен быть от 0 до 60°')
  }
  const result: number[] = []
  for (let angle = 0; angle < ROTATIONAL_SYMMETRY_DEG - step / 1000; angle += step) result.push(angle)
  return result
}

function horizontalUnit(directionDeg: number): Vector3 {
  const radians = directionDeg * Math.PI / 180
  return [Math.cos(radians), Math.sin(radians), 0]
}

function memberLengthM(model: GeneratedMastModel, member: MastMember): number {
  const a = model.nodes[member.nodeA]?.position
  const b = model.nodes[member.nodeB]?.position
  if (!a || !b) throw new Error(`Не найдены узлы ребра ${member.id} для расчёта стрелы`)
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

export function buildHorizontalBoomLoadCase(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  payloadMassKg: unknown,
  directionDeg: number,
): BoomLoadCase {
  const direction = horizontalUnit(directionDeg)
  const payloadKg = Math.max(0, Number(payloadMassKg) || 0)
  const payloadForceN = payloadKg
    * STANDARD_GRAVITY_M_S2
    * Math.max(0, Number(parameters.equipmentLoadFactor ?? 1))

  const baseParameters: ResolvedProject = {
    ...parameters,
    deadLoadFactor: 0,
    windPressurePa: 0,
    windPresetId: 'custom',
    windEnvelopeEnabled: false,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    iceThicknessMm: 0,
    windDirectionDeg: directionDeg,
  }
  const loadCase = buildLoadCase(model, baseParameters, {
    topPointLoadN: scale3(direction, payloadForceN),
  })

  const gammaDead = Math.max(0, Number(parameters.deadLoadFactor ?? 1))
  let boomSelfWeightN = 0
  let distributedResultant: Vector3 = [0, 0, 0]

  for (const member of model.members) {
    const lengthM = memberLengthM(model, member)
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const weightPerLengthN = member.densityKgM3
      * areaM2
      * STANDARD_GRAVITY_M_S2
      * gammaDead
    const distributed = scale3(direction, weightPerLengthN)
    const weightN = weightPerLengthN * lengthM
    boomSelfWeightN += weightN
    loadCase.memberDistributedLoads[member.id] = distributed
    const detail = {
      memberId: member.id,
      lengthM,
      steelWeightPerLengthN: weightPerLengthN,
      iceWeightPerLengthN: 0,
      windForcePerLengthN: [0, 0, 0] as Vector3,
      resultantForcePerLengthN: [...distributed] as Vector3,
      horizontalBoomGravity: true,
    }
    loadCase.memberLoadDetails[member.id] = detail
    distributedResultant = add3(distributedResultant, scale3(distributed, lengthM))
  }

  loadCase.selfWeightN = boomSelfWeightN
  loadCase.distributedResultant = distributedResultant
  loadCase.totalAppliedLoad = add3(distributedResultant, loadCase.nodalResultant)
  loadCase.memberWindN = 0
  loadCase.iceWeightN = 0
  loadCase.equipmentWeightN = 0
  loadCase.equipmentWindN = 0
  return Object.assign(loadCase, {
    horizontalBoom: true as const,
    horizontalBoomPayloadMassKg: payloadKg,
    horizontalBoomPayloadForceN: payloadForceN,
    horizontalBoomDirectionDeg: directionDeg,
  })
}

function memberLimitMode(analysis: CheckedAnalysis) {
  const member = analysis.criticalMemberId == null
    ? undefined
    : analysis.memberResults[analysis.criticalMemberId]
  if (!member) return 'none' as const
  return (member.bucklingUtilization ?? 0) >= (member.stressUtilization ?? 0)
    ? 'local-member-buckling' as const
    : 'material-strength' as const
}

function ratios(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  analysis: CheckedAnalysis,
) {
  const memberRatio = analysis.maxUtilization ?? 0
  const globalRatio = Number.isFinite(analysis.buckling.criticalLoadFactor)
    ? 1 / Math.max(analysis.buckling.criticalLoadFactor, Number.EPSILON)
    : 0
  const boltRatio = selectedBoltUtilizationForAnalysis(model, analysis, parameters)
  const governingRatio = Math.max(memberRatio, globalRatio, boltRatio)
  let governingMode: string = memberLimitMode(analysis)
  if (globalRatio >= memberRatio && globalRatio >= boltRatio) governingMode = 'global-buckling'
  if (boltRatio >= memberRatio && boltRatio >= globalRatio) governingMode = 'bolt-connection'
  return {
    memberRatio,
    globalRatio,
    boltRatio,
    governingRatio,
    governingMode,
    passes: governingRatio <= 1,
  }
}

function evaluate(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  frameSystem: FrameSystem,
  payloadMassKg: number,
  directionDeg: number,
) {
  const loads = buildHorizontalBoomLoadCase(model, parameters, payloadMassKg, directionDeg)
  const analysis = analyzeCheckedFrame(model, loads, parameters, frameSystem)
  return {
    payloadMassKg,
    directionDeg,
    loads,
    analysis,
    ratios: ratios(model, parameters, analysis),
  }
}

function findDirectionalLimit(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  frameSystem: FrameSystem,
  directionDeg: number,
  options: CraneBoomCapacityOptions = {},
) {
  const baseline = evaluate(model, parameters, frameSystem, 0, directionDeg)
  if (!baseline.ratios.passes) {
    return {
      directionDeg,
      maximumEndPayloadMassKg: 0,
      governingMode: 'boom-self-weight-overlimit',
      baselineUtilization: baseline.ratios.governingRatio,
      utilizationAtLimit: baseline.ratios.governingRatio,
      memberUtilizationAtLimit: baseline.ratios.memberRatio,
      boltUtilizationAtLimit: baseline.ratios.boltRatio,
      bucklingFactorAtLimit: baseline.analysis.buckling.criticalLoadFactor,
      boomSelfWeightN: baseline.loads.selfWeightN,
      bounded: true,
      iterations: 0,
    }
  }

  let lowMassKg = 0
  let low = baseline
  let highMassKg = 1
  let high = evaluate(model, parameters, frameSystem, highMassKg, directionDeg)

  while (high.ratios.passes && highMassKg < CRANE_BOOM_MAX_PAYLOAD_KG) {
    lowMassKg = highMassKg
    low = high
    highMassKg = Math.min(CRANE_BOOM_MAX_PAYLOAD_KG, highMassKg * 2)
    high = evaluate(model, parameters, frameSystem, highMassKg, directionDeg)
    if (highMassKg >= CRANE_BOOM_MAX_PAYLOAD_KG) break
  }

  const bounded = !high.ratios.passes
  if (!bounded) {
    return {
      directionDeg,
      maximumEndPayloadMassKg: highMassKg,
      governingMode: high.ratios.governingMode,
      baselineUtilization: baseline.ratios.governingRatio,
      utilizationAtLimit: high.ratios.governingRatio,
      memberUtilizationAtLimit: high.ratios.memberRatio,
      boltUtilizationAtLimit: high.ratios.boltRatio,
      bucklingFactorAtLimit: high.analysis.buckling.criticalLoadFactor,
      boomSelfWeightN: baseline.loads.selfWeightN,
      bounded: false,
      iterations: 0,
    }
  }

  for (let iteration = 0; iteration < CRANE_BOOM_BISECTION_ITERATIONS; iteration += 1) {
    const middleMassKg = (lowMassKg + highMassKg) / 2
    const middle = evaluate(model, parameters, frameSystem, middleMassKg, directionDeg)
    if (middle.ratios.passes) {
      lowMassKg = middleMassKg
      low = middle
    } else {
      highMassKg = middleMassKg
    }
    options.onProgress?.({
      stage: 'crane-boom',
      directionDeg,
      iteration: iteration + 1,
      totalIterations: CRANE_BOOM_BISECTION_ITERATIONS,
      payloadMassKg: middleMassKg,
    })
  }

  return {
    directionDeg,
    maximumEndPayloadMassKg: lowMassKg,
    governingMode: low.ratios.governingMode,
    baselineUtilization: baseline.ratios.governingRatio,
    utilizationAtLimit: low.ratios.governingRatio,
    memberUtilizationAtLimit: low.ratios.memberRatio,
    boltUtilizationAtLimit: low.ratios.boltRatio,
    bucklingFactorAtLimit: low.analysis.buckling.criticalLoadFactor,
    boomSelfWeightN: baseline.loads.selfWeightN,
    bounded: true,
    iterations: CRANE_BOOM_BISECTION_ITERATIONS,
  }
}

export function calculateCraneBoomCapacity(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  options: CraneBoomCapacityOptions = {},
) {
  if (!model.members.length || !model.topNodeIds.length) {
    throw new Error('Для расчёта стрелы нужна frame-модель с вершиной')
  }
  const stepDeg = Number(options.stepDeg ?? parameters.lateralCapacityStepDeg ?? 15)
  const frameSystem = options.frameSystem ?? compileFrameSystem(model, parameters)
  const cases: DirectionalLimit[] = directions(stepDeg).map((directionDeg) => (
    findDirectionalLimit(model, parameters, frameSystem, directionDeg, options)
  ))
  const first = cases[0]
  if (!first) throw new Error('Не сформирован ни один расчётный случай стрелы')
  let governing = first
  for (const candidate of cases.slice(1)) {
    if (candidate.maximumEndPayloadMassKg < governing.maximumEndPayloadMassKg) governing = candidate
  }
  const configuredEndPayloadMassKg = Math.max(0, Number(parameters.equipmentMassKg ?? 0))
  const additionalEndPayloadMassKg = Math.max(
    0,
    governing.maximumEndPayloadMassKg - configuredEndPayloadMassKg,
  )

  return {
    method: 'horizontal-boom-self-weight-plus-end-payload-v1' as const,
    interpretation: 'Та же frame-модель мысленно повернута горизонтально: собственный вес арматурных рёбер действует поперёк оси стрелы, а груз приложен к трём узлам её конца. Ветер, лёд, hardware/weld fabrication mass и динамика подъёма исключены.',
    stepDeg,
    symmetrySectorDeg: ROTATIONAL_SYMMETRY_DEG,
    cases,
    governing,
    maximumEndPayloadMassKg: governing.maximumEndPayloadMassKg,
    configuredEndPayloadMassKg,
    additionalEndPayloadMassKg,
    governingDirectionDeg: governing.directionDeg,
    governingMode: governing.governingMode,
    boomSelfWeightN: governing.boomSelfWeightN,
    boomSelfMassEquivalentKg: governing.boomSelfWeightN / STANDARD_GRAVITY_M_S2,
    bounded: governing.bounded,
  }
}
