import {
  addBandValue,
  cloneSymmetricBandMatrix,
  factorSymmetricBand,
} from './banded.js'
import { resolveCalculationParameters } from './calculate.js'
import { generateMastModel } from './geometry.js'
import { buildLoadCase } from './loads.js'
import { analyzeFrame, compileFrameSystem } from './solver.js'
import {
  DEFAULT_GUY_SAFETY_FACTOR,
  DEFAULT_GUY_TERMINATION_EFFICIENCY,
  DEFAULT_GUY_WIRE_ID,
  calculateGuyWireCapacity,
  getGuyWireSpec,
} from './guy-wire-catalog.js'
import { add3, norm3, scale3, sub3, unit3 } from './vector.js'

const DOF_PER_NODE = 6
const DEG = Math.PI / 180
const TWO_PI = 2 * Math.PI
const PASS_TOLERANCE = 1e-9

export const DEFAULT_GUY_ANALYSIS_OPTIONS = Object.freeze({
  safetyFactor: DEFAULT_GUY_SAFETY_FACTOR,
  terminationEfficiency: DEFAULT_GUY_TERMINATION_EFFICIENCY,
  maximumIterations: 25,
  displacementToleranceM: 1e-8,
  relativeTensionTolerance: 1e-6,
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const globalDof = (nodeId, axis) => nodeId * DOF_PER_NODE + axis
const matrixVector3 = (matrix, vector) => matrix.map((row) => (
  row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
))

function normalizeAngleRad(value) {
  return ((value % TWO_PI) + TWO_PI) % TWO_PI
}

function angularDistanceRad(left, right) {
  const delta = Math.atan2(Math.sin(left - right), Math.cos(left - right))
  return Math.abs(delta)
}

function nodeAzimuth(node) {
  return normalizeAngleRad(Math.atan2(node.position[1], node.position[0]))
}

function levelAttachmentNodes(model, level) {
  const nodes = model.nodes
    .filter((node) => node.level === level)
    .sort((left, right) => nodeAzimuth(left) - nodeAzimuth(right))
  if (nodes.length !== 3) {
    throw new Error(`Уровень ${level}: ожидалось три узла крепления, найдено ${nodes.length}`)
  }
  return nodes
}

function anchorAzimuthRad(tier, cableIndex) {
  return normalizeAngleRad((tier.azimuthOffsetDeg + cableIndex * 360 / tier.guyCount) * DEG)
}

function balancedAttachmentNodes(model, tier) {
  const nodes = levelAttachmentNodes(model, tier.level)
  // 3..6 cables are distributed over the three physical nodes as evenly as
  // possible. A cyclic shift is then selected by the minimum total angular
  // mismatch to the anchors. This removes ambiguous nearest-node ties on the
  // 60°-rotated levels and prevents an accidental 2+1+0 layout for 3 guys.
  const slotByCable = Array.from(
    { length: tier.guyCount },
    (_, cableIndex) => Math.floor((cableIndex + 0.5) * 3 / tier.guyCount),
  )
  let best = null
  for (let shift = 0; shift < 3; shift += 1) {
    const assigned = slotByCable.map((slot) => nodes[(slot + shift) % 3])
    const mismatch = assigned.reduce((sum, node, cableIndex) => (
      sum + angularDistanceRad(nodeAzimuth(node), anchorAzimuthRad(tier, cableIndex))
    ), 0)
    if (best == null || mismatch < best.mismatch - 1e-12) best = { assigned, mismatch }
  }
  return best.assigned
}

function normalizeTier(model, parameters, tier, tierIndex, options) {
  const moduleHeightM = parameters.moduleHeightMm / 1000
  const requestedHeightM = Number(tier.heightM ?? (tierIndex + 1) * moduleHeightM)
  if (!(requestedHeightM > 0)) throw new Error(`Ярус ${tierIndex + 1}: высота крепления должна быть больше 0`)
  const level = clamp(Math.round(requestedHeightM / moduleHeightM), 1, model.moduleCount)
  const actualHeightM = model.nodes.find((node) => node.level === level)?.position[2]
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

function buildCable(tier, cableIndex, attachment) {
  const azimuthRad = anchorAzimuthRad(tier, cableIndex)
  const azimuthDeg = azimuthRad / DEG
  const anchorPosition = [
    tier.anchorRadiusM * Math.cos(azimuthRad),
    tier.anchorRadiusM * Math.sin(azimuthRad),
    0,
  ]
  const attachmentPosition = [...attachment.position]
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

export function buildGuyWireSystem(model, parameters, tiers = [], inputOptions = {}) {
  const options = { ...DEFAULT_GUY_ANALYSIS_OPTIONS, ...inputOptions }
  const normalizedTiers = tiers.map((tier, index) => normalizeTier(model, parameters, tier, index, options))
  const cables = normalizedTiers.flatMap((tier) => {
    const attachments = balancedAttachmentNodes(model, tier)
    return attachments.map((attachment, cableIndex) => buildCable(tier, cableIndex, attachment))
  })
  return {
    method: 'tension-only-prestressed-straight-cable-newton-v1',
    options,
    tiers: normalizedTiers,
    cables,
    totalCableLengthM: cables.reduce((sum, cable) => sum + cable.initialLengthM, 0),
    totalCableMassKg: cables.reduce((sum, cable) => sum + cable.massKg, 0),
  }
}

export function guyWindDirections(parameters) {
  if (!parameters.windEnvelopeEnabled) return [parameters.windDirectionDeg]
  const step = Number(parameters.windEnvelopeStepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 180) {
    throw new Error('Шаг перебора направлений ветра должен быть от 0 до 180°')
  }
  // Unlike the bare mast, an arbitrary 3..6-guy arrangement is not generally
  // invariant under a 120° rotation. Therefore no mast-only symmetry reduction
  // is allowed here: the complete 0..360° envelope is evaluated.
  const directions = []
  for (let angle = 0; angle < 360 - step / 1000; angle += step) directions.push(angle)
  return directions
}

function zeroMatrix3() {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
}

function cableState(cable, displacement = [0, 0, 0]) {
  const deformedAttachment = add3(cable.attachmentPosition, displacement)
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
        const nn = directionToAnchor[row] * directionToAnchor[column]
        tangent[row][column] = axial * nn + geometric * ((row === column ? 1 : 0) - nn)
      }
    }
  }
  const forceOnMastN = active ? scale3(directionToAnchor, tensionN) : [0, 0, 0]
  return {
    cableId: cable.id,
    displacement: [...displacement],
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

function compileWithCableTangents(baseSystem, cableSystem, states) {
  const stiffness = cloneSymmetricBandMatrix(baseSystem.reducedStiffness)
  for (let index = 0; index < cableSystem.cables.length; index += 1) {
    const cable = cableSystem.cables[index]
    const state = states[index]
    if (!state.active) continue
    for (let rowAxis = 0; rowAxis < 3; rowAxis += 1) {
      const row = baseSystem.reducedIndexByGlobalDof[globalDof(cable.attachmentNodeId, rowAxis)]
      if (row < 0) continue
      for (let columnAxis = 0; columnAxis <= rowAxis; columnAxis += 1) {
        const column = baseSystem.reducedIndexByGlobalDof[globalDof(cable.attachmentNodeId, columnAxis)]
        if (column < 0) continue
        addBandValue(stiffness, row, column, state.tangentStiffnessNPerM[rowAxis][columnAxis])
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

function cloneLoadCase(base) {
  return {
    ...base,
    nodalLoads: base.nodalLoads.map((load) => [...load]),
    nodalMoments: base.nodalMoments.map((moment) => [...moment]),
    memberDistributedLoads: base.memberDistributedLoads.map((load) => [...load]),
    memberLoadDetails: base.memberLoadDetails.map((detail) => detail == null ? null : { ...detail }),
    totalAppliedLoad: [...base.totalAppliedLoad],
    distributedResultant: [...base.distributedResultant],
    nodalResultant: [...base.nodalResultant],
  }
}

function addForce(target, value) {
  target[0] += value[0]
  target[1] += value[1]
  target[2] += value[2]
}

function buildNewtonLoadCase(baseLoadCase, cableSystem, states) {
  const loadCase = cloneLoadCase(baseLoadCase)
  let equivalentCableResultantN = [0, 0, 0]
  const equivalentCableLoads = []
  for (let index = 0; index < cableSystem.cables.length; index += 1) {
    const cable = cableSystem.cables[index]
    const state = states[index]
    if (!state.active) {
      equivalentCableLoads.push({ cableId: cable.id, equivalentForceN: [0, 0, 0] })
      continue
    }
    // Newton linearization: f(u) ≈ f(u0) - Kt*(u-u0).
    // Absolute iteration: (Km+Kt)u = F + f(u0) + Kt*u0.
    const tangentTimesU = matrixVector3(state.tangentStiffnessNPerM, state.displacement)
    const equivalentForceN = add3(state.forceOnMastN, tangentTimesU)
    addForce(loadCase.nodalLoads[cable.attachmentNodeId], equivalentForceN)
    equivalentCableResultantN = add3(equivalentCableResultantN, equivalentForceN)
    equivalentCableLoads.push({ cableId: cable.id, equivalentForceN })
  }
  loadCase.nodalResultant = add3(loadCase.nodalResultant, equivalentCableResultantN)
  loadCase.totalAppliedLoad = add3(loadCase.distributedResultant, loadCase.nodalResultant)
  loadCase.guyEquivalentResultantN = equivalentCableResultantN
  loadCase.guyEquivalentLoads = equivalentCableLoads
  return loadCase
}

function maxDisplacementChange(left, right) {
  let maximum = 0
  for (let nodeId = 0; nodeId < left.length; nodeId += 1) {
    maximum = Math.max(maximum, norm3(sub3(left[nodeId], right[nodeId])))
  }
  return maximum
}

function maxRelativeTensionChange(previous, next) {
  let maximum = 0
  for (let index = 0; index < previous.length; index += 1) {
    const scale = Math.max(1, previous[index].tensionN, next[index].tensionN)
    maximum = Math.max(maximum, Math.abs(previous[index].tensionN - next[index].tensionN) / scale)
  }
  return maximum
}

function correctFreeNodeResiduals(analysis, system, cableSystem, states) {
  const corrected = analysis.reactions.map((reaction) => [...reaction])
  for (let index = 0; index < cableSystem.cables.length; index += 1) {
    const cable = cableSystem.cables[index]
    const state = states[index]
    if (!state.active) continue
    const ku = matrixVector3(state.tangentStiffnessNPerM, state.displacement)
    addForce(corrected[cable.attachmentNodeId], ku)
  }
  let maximumFreeResidualN = 0
  for (const globalDegree of system.freeDofs) {
    const nodeId = Math.floor(globalDegree / DOF_PER_NODE)
    const axis = globalDegree % DOF_PER_NODE
    if (axis < 3) maximumFreeResidualN = Math.max(maximumFreeResidualN, Math.abs(corrected[nodeId][axis]))
  }
  analysis.reactions = corrected
  analysis.diagnostics.maximumGuyCorrectedFreeResidualN = maximumFreeResidualN
}

function enrichCableResults(cableSystem, states) {
  return cableSystem.cables.map((cable, index) => {
    const state = states[index]
    const horizontalSpanM = Math.hypot(
      cable.anchorPosition[0] - state.deformedAttachment[0],
      cable.anchorPosition[1] - state.deformedAttachment[1],
    )
    const verticalSpanM = state.deformedAttachment[2] - cable.anchorPosition[2]
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
      forceOnMastN: [...state.forceOnMastN],
      moduleNodeReactionN: scale3(state.forceOnMastN, -1),
      anchorLoadN: scale3(state.forceOnMastN, -1),
      utilization,
      passes: utilization <= 1 + PASS_TOLERANCE,
    }
  })
}

export function solveGuyedLoadCase(model, parameters, cableSystem, windDirectionDeg, inputOptions = {}) {
  const options = { ...cableSystem.options, ...inputOptions }
  const caseParameters = { ...parameters, windDirectionDeg }
  const baseLoadCase = buildLoadCase(model, caseParameters)
  const baseSystem = compileFrameSystem(model, caseParameters)
  let trialDisplacements = model.nodes.map(() => [0, 0, 0])
  let states = cableSystem.cables.map((cable) => cableState(cable))
  let analysis = null
  let solverLoadCase = null
  let system = baseSystem
  let converged = false
  let displacementChangeM = Number.POSITIVE_INFINITY
  let relativeTensionChange = Number.POSITIVE_INFINITY
  let performedIterations = 0

  for (let iteration = 1; iteration <= options.maximumIterations; iteration += 1) {
    performedIterations = iteration
    states = cableSystem.cables.map((cable) => cableState(cable, trialDisplacements[cable.attachmentNodeId]))
    system = compileWithCableTangents(baseSystem, cableSystem, states)
    solverLoadCase = buildNewtonLoadCase(baseLoadCase, cableSystem, states)
    analysis = analyzeFrame(model, solverLoadCase, caseParameters, system)
    const nextDisplacements = analysis.displacements.map((value) => [...value])
    const nextStates = cableSystem.cables.map((cable) => cableState(cable, nextDisplacements[cable.attachmentNodeId]))
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
    analysis = analyzeFrame(model, baseLoadCase, caseParameters, baseSystem)
    trialDisplacements = analysis.displacements.map((value) => [...value])
    states = cableSystem.cables.map((cable) => cableState(cable, trialDisplacements[cable.attachmentNodeId]))
    displacementChangeM = 0
    relativeTensionChange = 0
    converged = cableSystem.cables.length === 0
  }

  // States are recomputed from the returned displacement field, so displayed
  // cable forces/reactions never refer to an earlier Newton iterate.
  states = cableSystem.cables.map((cable) => cableState(cable, trialDisplacements[cable.attachmentNodeId]))
  correctFreeNodeResiduals(analysis, system, cableSystem, states)
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

function caseScore(loadCase, parameters) {
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

function maximumCase(cases, selector) {
  return cases.reduce((best, candidate) => selector(candidate) > selector(best) ? candidate : best, cases[0])
}

function minimumCase(cases, selector) {
  return cases.reduce((best, candidate) => selector(candidate) < selector(best) ? candidate : best, cases[0])
}

function cableEnvelopeFor(cableSystem, cases, definition) {
  const samples = cases.map((loadCase) => loadCase.cables.find((item) => item.id === definition.id))
  const maximum = samples.reduce((best, item) => item.tensionN > best.tensionN ? item : best, samples[0])
  const minimum = samples.reduce((best, item) => item.tensionN < best.tensionN ? item : best, samples[0])
  return {
    ...definition,
    maximumTensionN: maximum.tensionN,
    maximumUtilization: maximum.utilization,
    maximumAtWindDirectionDeg: cases[samples.indexOf(maximum)].windDirectionDeg,
    minimumTensionN: minimum.tensionN,
    minimumAtWindDirectionDeg: cases[samples.indexOf(minimum)].windDirectionDeg,
    slackInEnvelope: samples.some((item) => item.slack),
    passes: maximum.utilization <= 1 + PASS_TOLERANCE,
  }
}

export function calculateGuyedMast(inputParameters, tiers = [], inputOptions = {}) {
  const parameters = resolveCalculationParameters(inputParameters)
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
  const cableEnvelope = cableSystem.cables.map((definition) => (
    cableEnvelopeFor(cableSystem, cases, definition)
  ))
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
