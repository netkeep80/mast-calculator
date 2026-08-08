import type { ResolvedProject } from '../../domain/contracts.js'
import {
  analyzeFrame,
  compileFrameSystem,
  type BuiltLoadCase,
  type FrameAnalysisResult,
  type GeneratedMastModel,
} from '../../structural-analysis/index.js'

type FrameSystem = ReturnType<typeof compileFrameSystem>
type MastMember = GeneratedMastModel['members'][number]
type MemberGeometry = FrameSystem['memberGeometry'][number]

function memberStrengthResult(
  member: MastMember,
  geometry: MemberGeometry,
  localEndForces: readonly number[],
  parameters: ResolvedProject,
  distributedLocal: readonly number[],
) {
  const diameter = member.diameterM
  const area = geometry.areaM2
  const inertia = geometry.inertiaM4
  const torsionConstant = geometry.torsionConstantM4
  const sectionModulus = inertia / (diameter / 2)
  const axialA = -localEndForces[0]!
  const axialB = localEndForces[6]!
  const axialForceN = Math.abs(axialA) >= Math.abs(axialB) ? axialA : axialB
  const maxCompressionN = Math.max(0, -axialA, -axialB)
  const maxTensionN = Math.max(0, axialA, axialB)
  const shearA = Math.hypot(localEndForces[1]!, localEndForces[2]!)
  const shearB = Math.hypot(localEndForces[7]!, localEndForces[8]!)
  const maxShearN = Math.max(shearA, shearB)
  const maxTorsionNm = Math.max(Math.abs(localEndForces[3]!), Math.abs(localEndForces[9]!))
  const bendingA = Math.hypot(localEndForces[4]!, localEndForces[5]!)
  const bendingB = Math.hypot(localEndForces[10]!, localEndForces[11]!)
  const endBendingNm = Math.max(bendingA, bendingB)
  const transverseDistributedNPerM = Math.hypot(distributedLocal[1]!, distributedLocal[2]!)
  const distributedBendingAllowanceNm = transverseDistributedNPerM * geometry.lengthM ** 2 / 8
  const maxBendingNm = endBendingNm + distributedBendingAllowanceNm
  const axialStressPa = Math.abs(axialForceN) / area
  const bendingStressPa = maxBendingNm / sectionModulus
  const normalStressPa = axialStressPa + bendingStressPa
  const torsionShearPa = maxTorsionNm * (diameter / 2) / torsionConstant
  const transverseShearPa = 4 * maxShearN / (3 * area)
  const shearStressPa = Math.hypot(torsionShearPa, transverseShearPa)
  const equivalentStressPa = Math.sqrt(normalStressPa ** 2 + 3 * shearStressPa ** 2)
  const designYieldPa = member.yieldStrengthPa / parameters.materialSafetyFactor
  const stressUtilization = equivalentStressPa / Math.max(designYieldPa, Number.EPSILON)
  const effectiveLengthM = member.effectiveLengthFactor * geometry.lengthM
  const eulerCapacityN = Math.PI ** 2 * member.youngModulusPa * inertia
    / effectiveLengthM ** 2 / parameters.materialSafetyFactor
  const bucklingUtilization = maxCompressionN / Math.max(eulerCapacityN, Number.EPSILON)
  const radiusOfGyrationM = Math.sqrt(inertia / area)
  const slenderness = effectiveLengthM / radiusOfGyrationM
  const utilization = Math.max(stressUtilization, bucklingUtilization)
  const mode = axialForceN >= 0 ? 'tension' as const : 'compression' as const
  const axialYieldCapacityN = designYieldPa * area
  const designCapacityN = mode === 'compression' ? Math.min(axialYieldCapacityN, eulerCapacityN) : axialYieldCapacityN
  return {
    axialForceN,
    axialForceAtAN: axialA,
    axialForceAtBN: axialB,
    maxTensionN,
    maxCompressionN: -maxCompressionN,
    maxShearN,
    maxTorsionNm,
    maxBendingNm,
    distributedBendingAllowanceNm,
    axialStressPa,
    bendingStressPa,
    normalStressPa,
    torsionShearPa,
    transverseShearPa,
    shearStressPa,
    equivalentStressPa,
    stressPa: equivalentStressPa,
    designYieldPa,
    stressUtilization,
    eulerCapacityN,
    bucklingUtilization,
    designCapacityN,
    slenderness,
    utilization,
    mode,
  }
}

export function applyMemberChecksToAnalysis(
  model: GeneratedMastModel,
  analysis: FrameAnalysisResult,
  parameters: ResolvedProject,
  frameSystem: FrameSystem | null | undefined,
) {
  if (!frameSystem?.memberGeometry) throw new Error('Для engineering member checks требуется compiled frame system')
  const memberResults = analysis.memberResults.map((raw) => {
    const member = model.members[raw.memberId]
    const geometry = frameSystem.memberGeometry[raw.memberId]
    if (!member || !geometry) throw new Error(`Не найдены member/geometry для engineering check ${raw.memberId}`)
    return {
      ...raw,
      ...memberStrengthResult(
        member,
        geometry,
        raw.localEndForces,
        parameters,
        raw.distributedLoadLocalNPerM,
      ),
    }
  })
  let criticalMember = memberResults[0]
  for (let index = 1; index < memberResults.length; index += 1) {
    const candidate = memberResults[index]!
    if (!criticalMember || candidate.utilization > criticalMember.utilization) criticalMember = candidate
  }
  return {
    ...analysis,
    memberResults,
    maxUtilization: criticalMember?.utilization ?? 0,
    criticalMemberId: criticalMember?.memberId ?? null,
  }
}

export function analyzeCheckedFrame(
  model: GeneratedMastModel,
  loads: BuiltLoadCase,
  parameters: ResolvedProject,
  frameSystem: FrameSystem | null = null,
) {
  const system = frameSystem ?? compileFrameSystem(model, parameters)
  const analysis = analyzeFrame(model, loads, parameters, system)
  return applyMemberChecksToAnalysis(model, analysis, parameters, system)
}
