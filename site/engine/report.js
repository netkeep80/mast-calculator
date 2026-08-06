const familyName = (family) => family === 'horizontal' ? 'Горизонтальное' : 'Диагональ'

function classifyMember(model, member) {
  const nodeA = model.nodes[member.nodeA]
  const nodeB = model.nodes[member.nodeB]
  return Math.abs(nodeA.position[2] - nodeB.position[2]) < 1e-9 ? 'horizontal' : 'diagonal'
}

function ensureResult(result) {
  if (!result?.model?.members?.length || !result?.cases?.length) {
    throw new Error('Для формирования отчёта отсутствуют расчётные случаи или стержни')
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
    const maxTensionN = Math.max(0, ...candidates.map(({ memberResult }) => memberResult.axialForceN))
    const maxCompressionN = Math.min(0, ...candidates.map(({ memberResult }) => memberResult.axialForceN))
    const family = classifyMember(result.model, member)

    return {
      memberId: member.id,
      nodeA: member.nodeA,
      nodeB: member.nodeB,
      family,
      familyName: familyName(family),
      diameterMm: member.diameterM * 1000,
      lengthM: governing.memberResult.lengthM,
      windDirectionDeg: governing.windDirectionDeg,
      mode: governing.memberResult.mode,
      axialForceN: governing.memberResult.axialForceN,
      maxTensionN,
      maxCompressionN,
      stressPa: governing.memberResult.stressPa,
      designCapacityN: governing.memberResult.designCapacityN,
      slenderness: governing.memberResult.slenderness,
      utilization: governing.memberResult.utilization,
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
    'Стержень', 'Тип', 'Узел A', 'Узел B', 'Длина, мм', 'Диаметр, мм',
    'Определяющий режим', 'Направление ветра, град', 'Усилие, кН',
    'Макс. растяжение, кН', 'Макс. сжатие, кН', 'Напряжение, МПа',
    'Несущая способность, кН', 'Гибкость', 'Коэффициент использования',
  ]]

  for (const member of members) {
    rows.push([
      member.memberId,
      member.familyName,
      member.nodeA,
      member.nodeB,
      csvNumber(member.lengthM * 1000, 1),
      csvNumber(member.diameterMm, 1),
      member.mode === 'compression' ? 'Сжатие' : 'Растяжение',
      csvNumber(member.windDirectionDeg, 0),
      csvNumber(member.axialForceN / 1000),
      csvNumber(member.maxTensionN / 1000),
      csvNumber(member.maxCompressionN / 1000),
      csvNumber(member.stressPa / 1e6),
      csvNumber(member.designCapacityN / 1000),
      csvNumber(member.slenderness, 1),
      csvNumber(member.utilization, 4),
    ])
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}

export function createCalculationExport(result, parameters, generatedAt = new Date().toISOString()) {
  ensureResult(result)
  const material = buildMaterialSummary(result)
  const members = buildMemberEnvelope(result)
  return {
    schema: 'mast-calculator/calculation-report/v1',
    generatedAt,
    parameters: { ...parameters },
    summary: {
      heightM: parameters.moduleCount * parameters.moduleHeightMm / 1000,
      totalMassKg: result.analysis.totalMassKg,
      maximumUtilization: result.envelope.maxUtilization,
      maximumTopDisplacementMm: result.envelope.maxTopDisplacementM * 1000,
      minimumBucklingFactor: result.envelope.minimumBucklingFactor,
      governingWindDirectionDeg: result.envelope.governing.windDirectionDeg,
      strengthWindDirectionDeg: result.envelope.strength.windDirectionDeg,
      displacementWindDirectionDeg: result.envelope.displacement.windDirectionDeg,
      bucklingWindDirectionDeg: result.envelope.buckling.windDirectionDeg,
      loadCaseCount: result.envelope.caseCount,
    },
    diagnostics: { ...result.analysis.diagnostics },
    material,
    members,
    warnings: [...result.warnings],
  }
}

export function createCalculationJson(result, parameters, generatedAt) {
  return `${JSON.stringify(createCalculationExport(result, parameters, generatedAt), null, 2)}\n`
}
