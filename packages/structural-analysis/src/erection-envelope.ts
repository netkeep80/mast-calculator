import type { ResolvedProject } from '../../domain/contracts.js'
import {
  adaptiveSampleRange,
  norm3,
  type AdaptiveSamplingOptions,
} from '../../numerics/index.js'
import type { GeneratedMastModel } from './geometry.js'
import {
  calculateErectionState,
  type ErectionEquilibriumResult,
  type ErectionStateInput,
} from './erection.js'
import type { FrameMemberResult } from './solver.js'

export const ERECTION_ENVELOPE_MODEL_ID = 'tilt-up-quasi-static-envelope-v1' as const

export interface ErectionPathInput extends Omit<ErectionStateInput, 'angleDeg'> {
  readonly startAngleDeg?: number
  readonly endAngleDeg?: number
}

export interface ErectionEnvelopeOptions extends AdaptiveSamplingOptions {}

export interface MemberActionMagnitudes {
  readonly axialN: number
  readonly shearN: number
  readonly torsionNm: number
  readonly bendingNm: number
}

export interface ErectionAngleSample {
  readonly angleDeg: number
  readonly result: ErectionEquilibriumResult
  readonly memberActions: readonly MemberActionMagnitudes[]
}

export interface GoverningScalar {
  readonly value: number
  readonly angleDeg: number
  readonly sampleIndex: number
}

export interface MemberActionEnvelope {
  readonly memberId: number
  readonly axialN: GoverningScalar
  readonly shearN: GoverningScalar
  readonly torsionNm: GoverningScalar
  readonly bendingNm: GoverningScalar
}

export interface HingeReactionEnvelope {
  readonly nodeId: number
  readonly forceN: GoverningScalar
  readonly momentNm: GoverningScalar
}

export interface ErectionFeasibilityTransition {
  readonly leftAngleDeg: number
  readonly rightAngleDeg: number
  readonly leftStatus: string
  readonly rightStatus: string
}

export interface ErectionPathEnvelope {
  readonly model: typeof ERECTION_ENVELOPE_MODEL_ID
  readonly startAngleDeg: number
  readonly endAngleDeg: number
  readonly samples: readonly ErectionAngleSample[]
  readonly feasibleSampleCount: number
  readonly infeasibleSampleCount: number
  readonly maximumCableTensionN: GoverningScalar | null
  readonly maximumDisplacementM: GoverningScalar | null
  readonly memberActions: readonly MemberActionEnvelope[]
  readonly hingeReactions: readonly HingeReactionEnvelope[]
  readonly feasibilityTransitions: readonly ErectionFeasibilityTransition[]
  readonly diagnostics: {
    readonly evaluationCount: number
    readonly cacheHits: number
    readonly maximumDepthReached: number
    readonly minimumResolvedAngleStepDeg: number
    readonly converged: boolean
    readonly reason: 'tolerance' | 'max-evaluations' | 'max-depth'
  }
}

function endMagnitudes(localEndForces: readonly number[], offset: 0 | 6) {
  if (localEndForces.length < 12) throw new Error('frame member result must contain 12 local end-force components')
  return {
    axialN: Math.abs(localEndForces[offset]!),
    shearN: Math.hypot(localEndForces[offset + 1]!, localEndForces[offset + 2]!),
    torsionNm: Math.abs(localEndForces[offset + 3]!),
    bendingNm: Math.hypot(localEndForces[offset + 4]!, localEndForces[offset + 5]!),
  }
}

/**
 * Extracts sign-independent N/V/T/M demand from the two local ends of one 3D
 * Euler-Bernoulli frame member. This is deliberately separate from engineering
 * acceptance: the erection layer stores physical actions, not a guessed scalar
 * utilization.
 */
export function frameMemberActionMagnitudes(member: Pick<FrameMemberResult, 'localEndForces'>): MemberActionMagnitudes {
  const endA = endMagnitudes(member.localEndForces, 0)
  const endB = endMagnitudes(member.localEndForces, 6)
  return {
    axialN: Math.max(endA.axialN, endB.axialN),
    shearN: Math.max(endA.shearN, endB.shearN),
    torsionNm: Math.max(endA.torsionNm, endB.torsionNm),
    bendingNm: Math.max(endA.bendingNm, endB.bendingNm),
  }
}

function statusKey(result: ErectionEquilibriumResult): string {
  return result.status === 'ok' ? 'ok' : `infeasible:${result.reason}`
}

function sampleMetrics(result: ErectionEquilibriumResult, memberActions: readonly MemberActionMagnitudes[]): number[] {
  if (result.status !== 'ok') return []
  const hingeReactionMetrics = result.geometry.hingeNodeIds.flatMap((nodeId) => [
    norm3(result.analysis.reactions[nodeId]!),
    norm3(result.analysis.reactionMoments[nodeId]!),
  ])
  return [
    result.requiredCableTensionN,
    result.analysis.maxDisplacementM,
    ...hingeReactionMetrics,
    ...memberActions.flatMap((action) => [action.axialN, action.shearN, action.torsionNm, action.bendingNm]),
  ]
}

function governing(
  current: GoverningScalar | null,
  value: number,
  angleDeg: number,
  sampleIndex: number,
): GoverningScalar {
  if (!current || value > current.value) return { value, angleDeg, sampleIndex }
  return current
}

function emptyGoverning(): GoverningScalar {
  return { value: 0, angleDeg: Number.NaN, sampleIndex: -1 }
}

function initializeMemberEnvelope(memberId: number): MemberActionEnvelope {
  return {
    memberId,
    axialN: emptyGoverning(),
    shearN: emptyGoverning(),
    torsionNm: emptyGoverning(),
    bendingNm: emptyGoverning(),
  }
}

function replaceIfGreater(current: GoverningScalar, value: number, angleDeg: number, sampleIndex: number): GoverningScalar {
  return sampleIndex >= 0 && (current.sampleIndex < 0 || value > current.value)
    ? { value, angleDeg, sampleIndex }
    : current
}

function buildFeasibilityTransitions(samples: readonly ErectionAngleSample[]): ErectionFeasibilityTransition[] {
  const transitions: ErectionFeasibilityTransition[] = []
  for (let index = 0; index < samples.length - 1; index += 1) {
    const left = samples[index]!
    const right = samples[index + 1]!
    const leftStatus = statusKey(left.result)
    const rightStatus = statusKey(right.result)
    if (leftStatus === rightStatus) continue
    transitions.push({
      leftAngleDeg: left.angleDeg,
      rightAngleDeg: right.angleDeg,
      leftStatus,
      rightStatus,
    })
  }
  return transitions
}

function validatePathAngles(startAngleDeg: number, endAngleDeg: number): void {
  if (!Number.isFinite(startAngleDeg) || !Number.isFinite(endAngleDeg)) {
    throw new RangeError('erection path angles must be finite')
  }
  if (startAngleDeg < 0 || endAngleDeg > 90 || !(endAngleDeg > startAngleDeg)) {
    throw new RangeError('erection path must satisfy 0 <= startAngleDeg < endAngleDeg <= 90')
  }
}

/**
 * Builds a deterministic adaptive envelope over a fixed-world erection path.
 * The anchor is passed unchanged to every single-angle solve; only the mast
 * attachment rotates with the physical frame.
 */
export function calculateErectionEnvelope(
  model: GeneratedMastModel,
  parameters: ResolvedProject,
  input: ErectionPathInput,
  options: ErectionEnvelopeOptions = {},
): ErectionPathEnvelope {
  const startAngleDeg = input.startAngleDeg ?? 0
  const endAngleDeg = input.endAngleDeg ?? 90
  validatePathAngles(startAngleDeg, endAngleDeg)

  const sampled = adaptiveSampleRange(
    startAngleDeg,
    endAngleDeg,
    (angleDeg) => {
      const result = calculateErectionState(model, parameters, {
        angleDeg,
        hingeNodeIds: input.hingeNodeIds,
        attachmentNodeId: input.attachmentNodeId,
        anchorPointM: input.anchorPointM,
        ...(input.gaugeNodeId == null ? {} : { gaugeNodeId: input.gaugeNodeId }),
        ...(input.rotationSense == null ? {} : { rotationSense: input.rotationSense }),
      })
      const memberActions = result.status === 'ok'
        ? result.analysis.memberResults.map(frameMemberActionMagnitudes)
        : []
      const state: ErectionAngleSample = Object.freeze({
        angleDeg,
        result,
        memberActions: Object.freeze(memberActions),
      })
      return {
        state,
        metrics: sampleMetrics(result, memberActions),
        continuityKey: statusKey(result),
      }
    },
    {
      initialSegments: options.initialSegments ?? 6,
      relativeTolerance: options.relativeTolerance ?? 0.02,
      minimumStep: options.minimumStep ?? 0.25,
      maximumEvaluations: options.maximumEvaluations ?? 49,
      maximumDepth: options.maximumDepth ?? 12,
    },
  )

  const samples = sampled.samples.map((sample) => sample.state)
  const firstFeasible = samples.find((sample) => sample.result.status === 'ok')
  const memberEnvelopes = firstFeasible?.result.status === 'ok'
    ? firstFeasible.result.analysis.memberResults.map((member) => initializeMemberEnvelope(member.memberId))
    : []
  const hingeEnvelopes: HingeReactionEnvelope[] = input.hingeNodeIds.map((nodeId) => ({
    nodeId,
    forceN: emptyGoverning(),
    momentNm: emptyGoverning(),
  }))

  let maximumCableTensionN: GoverningScalar | null = null
  let maximumDisplacementM: GoverningScalar | null = null
  let feasibleSampleCount = 0

  samples.forEach((sample, sampleIndex) => {
    const result = sample.result
    if (result.status !== 'ok') return
    feasibleSampleCount += 1
    maximumCableTensionN = governing(
      maximumCableTensionN,
      result.requiredCableTensionN,
      sample.angleDeg,
      sampleIndex,
    )
    maximumDisplacementM = governing(
      maximumDisplacementM,
      result.analysis.maxDisplacementM,
      sample.angleDeg,
      sampleIndex,
    )

    for (let memberIndex = 0; memberIndex < sample.memberActions.length; memberIndex += 1) {
      const action = sample.memberActions[memberIndex]!
      const current = memberEnvelopes[memberIndex]
      if (!current) continue
      memberEnvelopes[memberIndex] = {
        memberId: current.memberId,
        axialN: replaceIfGreater(current.axialN, action.axialN, sample.angleDeg, sampleIndex),
        shearN: replaceIfGreater(current.shearN, action.shearN, sample.angleDeg, sampleIndex),
        torsionNm: replaceIfGreater(current.torsionNm, action.torsionNm, sample.angleDeg, sampleIndex),
        bendingNm: replaceIfGreater(current.bendingNm, action.bendingNm, sample.angleDeg, sampleIndex),
      }
    }

    hingeEnvelopes.forEach((current, hingeIndex) => {
      const nodeId = current.nodeId
      hingeEnvelopes[hingeIndex] = {
        nodeId,
        forceN: replaceIfGreater(
          current.forceN,
          norm3(result.analysis.reactions[nodeId]!),
          sample.angleDeg,
          sampleIndex,
        ),
        momentNm: replaceIfGreater(
          current.momentNm,
          norm3(result.analysis.reactionMoments[nodeId]!),
          sample.angleDeg,
          sampleIndex,
        ),
      }
    })
  })

  return {
    model: ERECTION_ENVELOPE_MODEL_ID,
    startAngleDeg,
    endAngleDeg,
    samples,
    feasibleSampleCount,
    infeasibleSampleCount: samples.length - feasibleSampleCount,
    maximumCableTensionN,
    maximumDisplacementM,
    memberActions: memberEnvelopes,
    hingeReactions: hingeEnvelopes,
    feasibilityTransitions: buildFeasibilityTransitions(samples),
    diagnostics: {
      evaluationCount: sampled.diagnostics.evaluationCount,
      cacheHits: sampled.diagnostics.cacheHits,
      maximumDepthReached: sampled.diagnostics.maximumDepthReached,
      minimumResolvedAngleStepDeg: sampled.diagnostics.minimumResolvedStep,
      converged: sampled.diagnostics.converged,
      reason: sampled.diagnostics.reason,
    },
  }
}
