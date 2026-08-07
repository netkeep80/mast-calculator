const familyName = (family) => family === 'horizontal' ? 'Горизонтальное' : 'Диагональ'

function classifyMember(model, member) {
  const nodeA = model.nodes[member.nodeA]
  const nodeB = model.nodes[member.nodeB]
  return Math.abs(nodeA.position[2] - nodeB.position[2]) < 1e-9 ? 'horizontal' : 'diagonal'
}

function ensureResult(result) {
  if (!result?.model?.members?.length || !result?.cases?.length) {
    throw new Error('Для формирования отчёта отсутствуют расчётные случаи или рёбра')
  }
}

export function buildMemberEnvelope(result) {
  ensureResult(result)

  return result.model.members.map((member) => {
    const candidates = result.cases.map((loadCase) => ({
      windDirectionDeg: loadCase.windDirectionDeg,
      memberResult: loadCase.analysis.memberResults[member.id],
    }))
    const governing = candidates.reduce((best, candidate) => (
      candidate.memberResult.utilization > best.memberResult.utilization ? candidate : best
    ), candidates[0])
    const r = governing.memberResult
    const maxTensionN = Math.max(0, ...candidates.map(({ memberResult }) => memberResult.maxTensionN ?? memberResult.axialForceN))
    const maxCompressionN = Math.min(0, ...candidates.map(({ memberResult }) => memberResult.maxCompressionN ?? memberResult.axialForceN))
    const maxShearN = Math.max(0, ...candidates.map(({ memberResult }) => memberResult.maxShearN ?? 0))
    const maxTorsionNm = Math.max(0, ...candidates.map(({ memberResult }) => memberResult.maxTorsionNm ?? 0))
    const maxBendingNm = Math.max(0, ...candidates.map(({ memberResult }) => memberResult.maxBendingNm ?? 0))
    const maxEquivalentStressPa = Math.max(0, ...candidates.map(({ memberResult }) => memberResult.equivalentStressPa ?? memberResult.stressPa ?? 0))
    const family = classifyMember(result.model, member)

    return {
      memberId: member.id,
      nodeA: member.nodeA,
      nodeB: member.nodeB,
      family,
      familyName: familyName(family),
      diameterMm: member.diameterM * 1000,
      lengthM: r.lengthM,
      windDirectionDeg: governing.windDirectionDeg,
      mode: r.mode,
      axialForceN: r.axialForceN,
      axialForceAtAN: r.axialForceAtAN,
      axialForceAtBN: r.axialForceAtBN,
      maxTensionN,
      maxCompressionN,
      maxShearN,
      maxTorsionNm,
      maxBendingNm,
      distributedBendingAllowanceNm: r.distributedBendingAllowanceNm ?? 0,
      axialStressPa: r.axialStressPa ?? 0,
      bendingStressPa: r.bendingStressPa ?? 0,
      normalStressPa: r.normalStressPa ?? r.stressPa,
      torsionShearPa: r.torsionShearPa ?? 0,
      transverseShearPa: r.transverseShearPa ?? 0,
      shearStressPa: r.shearStressPa ?? 0,
      equivalentStressPa: r.equivalentStressPa ?? r.stressPa,
      maxEquivalentStressPa,
      stressPa: r.equivalentStressPa ?? r.stressPa,
      designYieldPa: r.designYieldPa,
      stressUtilization: r.stressUtilization ?? r.utilization,
      eulerCapacityN: r.eulerCapacityN,
      bucklingUtilization: r.bucklingUtilization ?? 0,
      designCapacityN: r.designCapacityN,
      slenderness: r.slenderness,
      utilization: r.utilization,
      localEndForces: [...(r.localEndForces ?? [])],
      distributedLoadLocalNPerM: [...(r.distributedLoadLocalNPerM ?? [])],
    }
  })
}

export function buildMaterialSummary(result, lengthStepMm = 1) {
  ensureResult(result)
  if (!Number.isFinite(lengthStepMm) || lengthStepMm <= 0) {
    throw new Error('Шаг группировки длины должен быть положительным')
  }

  const reference = result.cases[0].analysis.memberResults
  const groups = new Map()
  let totalLengthM = 0
  let totalMassKg = 0

  for (const member of result.model.members) {
    const lengthM = reference[member.id].lengthM
    const lengthMm = Math.round(lengthM * 1000 / lengthStepMm) * lengthStepMm
    const diameterMm = member.diameterM * 1000
    const family = classifyMember(result.model, member)
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    const massKg = areaM2 * lengthM * member.densityKgM3
    const key = `${family}|${diameterMm}|${lengthMm}`
    const current = groups.get(key) ?? {
      family,
      familyName: familyName(family),
      diameterMm,
      lengthMm,
      count: 0,
      totalLengthM: 0,
      totalMassKg: 0,
    }
    current.count += 1
    current.totalLengthM += lengthM
    current.totalMassKg += massKg
    groups.set(key, current)
    totalLengthM += lengthM
    totalMassKg += massKg
  }

  return {
    groups: [...groups.values()].sort((left, right) => (
      left.family.localeCompare(right.family)
      || left.diameterMm - right.diameterMm
      || left.lengthMm - right.lengthMm
    )),
    totalCount: result.model.members.length,
    totalLengthM,
    totalMassKg,
  }
}

const csvNumber = (value, digits = 3) => Number.isFinite(value)
  ? value.toFixed(digits).replace('.', ',')
  : ''

const csvCell = (value) => {
  const text = String(value ?? '')
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function createCalculationCsv(result) {
  const members = buildMemberEnvelope(result)
    .sort((left, right) => right.utilization - left.utilization)
  const rows = [[
    'Ребро', 'Тип', 'Узел A', 'Узел B', 'Длина, мм', 'Диаметр, мм',
    'Направление ветра, град', 'N, кН', 'Vmax, кН', 'Tmax, Н·м', 'Mmax, Н·м',
    'σN, МПа', 'σM, МПа', 'τ, МПа', 'σэкв, МПа',
    'Использование по напряжению', 'Использование по Эйлеру', 'Итоговое использование',
  ]]

  for (const member of members) {
    rows.push([
      member.memberId,
      member.familyName,
      member.nodeA,
      member.nodeB,
      csvNumber(member.lengthM * 1000, 2),
      csvNumber(member.diameterMm, 1),
      csvNumber(member.windDirectionDeg, 0),
      csvNumber(member.axialForceN / 1000, 4),
      csvNumber(member.maxShearN / 1000, 4),
      csvNumber(member.maxTorsionNm, 3),
      csvNumber(member.maxBendingNm, 3),
      csvNumber(member.axialStressPa / 1e6, 3),
      csvNumber(member.bendingStressPa / 1e6, 3),
      csvNumber(member.shearStressPa / 1e6, 3),
      csvNumber(member.equivalentStressPa / 1e6, 3),
      csvNumber(member.stressUtilization, 4),
      csvNumber(member.bucklingUtilization, 4),
      csvNumber(member.utilization, 4),
    ])
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}

function exportModel(model) {
  return {
    moduleCount: model.moduleCount,
    topNodeIds: [...model.topNodeIds],
    nodes: model.nodes.map((node) => ({
      id: node.id,
      positionM: [...node.position],
      restrained: [...node.restrained],
    })),
    members: model.members.map((member) => ({
      id: member.id,
      nodeA: member.nodeA,
      nodeB: member.nodeB,
      diameterM: member.diameterM,
      youngModulusPa: member.youngModulusPa,
      yieldStrengthPa: member.yieldStrengthPa,
      poissonRatio: member.poissonRatio,
      densityKgM3: member.densityKgM3,
      effectiveLengthFactor: member.effectiveLengthFactor,
    })),
  }
}

function exportLoadCase(loadCase) {
  return {
    windDirectionDeg: loadCase.windDirectionDeg,
    loads: {
      nodalLoadsN: loadCase.loads.nodalLoads.map((load) => [...load]),
      memberDistributedLoadsNPerM: (loadCase.loads.memberDistributedLoads ?? []).map((load) => [...load]),
      totalAppliedLoadN: [...loadCase.loads.totalAppliedLoad],
      selfWeightN: loadCase.loads.selfWeightN,
      iceWeightN: loadCase.loads.iceWeightN,
      memberWindN: loadCase.loads.memberWindN,
      equipmentWindN: loadCase.loads.equipmentWindN,
    },
    analysis: {
      solver: loadCase.analysis.solver,
      degreesOfFreedomPerNode: loadCase.analysis.degreesOfFreedomPerNode,
      displacementsM: loadCase.analysis.displacements.map((value) => [...value]),
      rotationsRad: (loadCase.analysis.rotations ?? []).map((value) => [...value]),
      reactionsN: loadCase.analysis.reactions.map((value) => [...value]),
      reactionMomentsNm: (loadCase.analysis.reactionMoments ?? []).map((value) => [...value]),
      memberResults: loadCase.analysis.memberResults.map((value) => ({
        ...value,
        localAxes: value.localAxes?.map((axis) => [...axis]),
        localEndForces: [...(value.localEndForces ?? [])],
        distributedLoadLocalNPerM: [...(value.distributedLoadLocalNPerM ?? [])],
      })),
      maxDisplacementM: loadCase.analysis.maxDisplacementM,
      maxTopDisplacementM: loadCase.analysis.maxTopDisplacementM,
      maxUtilization: loadCase.analysis.maxUtilization,
      criticalMemberId: loadCase.analysis.criticalMemberId,
      totalMassKg: loadCase.analysis.totalMassKg,
      buckling: {
        criticalLoadFactor: loadCase.analysis.buckling.criticalLoadFactor,
        mode: loadCase.analysis.buckling.mode.map((value) => [...value]),
        rotations: (loadCase.analysis.buckling.rotations ?? []).map((value) => [...value]),
        residual: loadCase.analysis.buckling.residual,
        eigenResidual: loadCase.analysis.buckling.eigenResidual,
        iterations: loadCase.analysis.buckling.iterations,
      },
      diagnostics: { ...loadCase.analysis.diagnostics },
    },
  }
}

function exportLateralCapacity(lateralCapacity) {
  if (!lateralCapacity) return null
  return {
    ...lateralCapacity,
    cases: lateralCapacity.cases.map((item) => ({ ...item })),
    governing: { ...lateralCapacity.governing },
  }
}

function exportStaticPayloadCapacity(staticPayloadCapacity) {
  if (!staticPayloadCapacity) return null
  return {
    ...staticPayloadCapacity,
    purePayloadReference: { ...staticPayloadCapacity.purePayloadReference },
    diagnostics: { ...staticPayloadCapacity.diagnostics },
  }
}

function exportVerification(verification) {
  if (!verification) return null
  return {
    ...verification,
    counts: { ...verification.counts },
    thresholds: { ...verification.thresholds },
    levels: verification.levels.map((level) => ({ ...level, checkIds: [...level.checkIds] })),
    checks: verification.checks.map((check) => ({ ...check })),
  }
}

export function createCalculationExport(
  result,
  parameters = result?.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo = {},
) {
  ensureResult(result)
  const resolvedParameters = result.parameters ?? parameters
  const material = buildMaterialSummary(result)
  const members = buildMemberEnvelope(result)
  const lateralCapacity = exportLateralCapacity(result.lateralCapacity)
  const staticPayloadCapacity = exportStaticPayloadCapacity(result.staticPayloadCapacity)
  const verification = exportVerification(result.verification)

  return {
    schema: 'mast-calculator/calculation-snapshot/v6',
    generatedAt,
    software: {
      method: result.method ?? null,
      repository: buildInfo.repository ?? 'netkeep80/mast-calculator',
      ref: buildInfo.ref ?? null,
      sha: buildInfo.sha ?? null,
      runId: buildInfo.runId ?? null,
    },
    parameters: { ...resolvedParameters },
    summary: {
      heightM: resolvedParameters.moduleCount * resolvedParameters.moduleHeightMm / 1000,
      totalMassKg: result.analysis.totalMassKg,
      windPresetId: resolvedParameters.windPresetId,
      windPresetLabel: resolvedParameters.windPresetLabel,
      windSpeedMs: resolvedParameters.windSpeedMs,
      windPressurePa: resolvedParameters.windPressurePa,
      maximumUtilization: result.envelope.maxUtilization,
      maximumTopDisplacementMm: result.envelope.maxTopDisplacementM * 1000,
      minimumBucklingFactor: result.envelope.minimumBucklingFactor,
      governingWindDirectionDeg: result.envelope.governing.windDirectionDeg,
      strengthWindDirectionDeg: result.envelope.strength.windDirectionDeg,
      displacementWindDirectionDeg: result.envelope.displacement.windDirectionDeg,
      bucklingWindDirectionDeg: result.envelope.buckling.windDirectionDeg,
      loadCaseCount: result.envelope.caseCount,
      lateralCriticalForceN: lateralCapacity?.criticalForceN ?? null,
      lateralCriticalForceKgf: lateralCapacity?.criticalForceKgf ?? null,
      lateralGoverningMode: lateralCapacity?.governingMode ?? null,
      lateralDirectionDeg: lateralCapacity?.directionDeg ?? null,
      maximumTotalTopMassKg: staticPayloadCapacity?.maximumTotalTopMassKg ?? null,
      remainingAdditionalTopMassKg: staticPayloadCapacity?.remainingAdditionalMassKg ?? null,
      equivalentWaterVolumeM3: staticPayloadCapacity?.equivalentWaterVolumeM3 ?? null,
      staticPayloadGoverningMode: staticPayloadCapacity?.governingMode ?? null,
      verificationStatus: verification?.status ?? null,
      verificationPassed: verification?.counts?.passed ?? null,
      verificationFailed: verification?.counts?.failed ?? null,
      verificationNotVerified: verification?.counts?.notVerified ?? null,
    },
    diagnostics: { ...result.analysis.diagnostics },
    model: exportModel(result.model),
    loadCases: result.cases.map(exportLoadCase),
    lateralCapacity,
    staticPayloadCapacity,
    verification,
    material,
    members,
    warnings: [...result.warnings],
  }
}

export function createCalculationJson(result, parameters, generatedAt, buildInfo) {
  return `${JSON.stringify(createCalculationExport(result, parameters, generatedAt, buildInfo), null, 2)}\n`
}
