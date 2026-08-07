const GRAVITY_M_S2 = 9.80665
const PASS = 'pass'
const FAIL = 'fail'
const PENDING = 'not-verified'

const relativeError = (actual, expected) => Math.abs(actual - expected) / Math.max(1, Math.abs(expected))

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]))
  }
  return value
}

function memberLength(model, member) {
  const a = model.nodes[member.nodeA].position
  const b = model.nodes[member.nodeB].position
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

function recalculatePassportStatus(passport) {
  const checks = passport.checks ?? []
  const passed = checks.filter((check) => check.status === PASS).length
  const failed = checks.filter((check) => check.status === FAIL).length
  const notVerified = checks.filter((check) => check.status === PENDING).length
  const internalChecks = checks.filter((check) => check.level <= 4)
  const internalPassed = internalChecks.every((check) => check.status === PASS)
  const levels = (passport.levels ?? []).map((level) => {
    const levelChecks = checks.filter((check) => check.level === level.number)
    const hasFail = levelChecks.some((check) => check.status === FAIL)
    const hasPending = levelChecks.some((check) => check.status === PENDING)
    return {
      ...level,
      status: hasFail ? FAIL : hasPending ? PENDING : PASS,
      checkIds: levelChecks.map((check) => check.id),
    }
  })
  return {
    ...passport,
    counts: { total: checks.length, passed, failed, notVerified, internal: internalChecks.length },
    status: failed > 0 ? 'failed' : internalPassed ? 'internal-passed-external-pending' : 'incomplete',
    headline: failed > 0
      ? 'Внутренняя проверка обнаружила несоответствие — результат нельзя считать надёжным.'
      : 'Внутренние проверки пройдены; независимая внешняя верификация и натурное подтверждение пока не выполнены.',
    levels,
  }
}

/**
 * Prototype 1.3 verification originally derived steel mass from one global
 * diameter. For a mixed module profile the independent oracle must instead
 * sum every physical member using the diameter stored in the FEM model.
 *
 * This function is copy-on-write: the supplied passport is never modified.
 */
export function repairMixedDiameterVerificationPassport(passport, result) {
  if (!passport?.checks || !result?.model?.members?.length) return passport
  const repaired = cloneValue(passport)
  const model = result.model
  const expectedMassKg = model.members.reduce((sum, member) => {
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    return sum + memberLength(model, member) * areaM2 * member.densityKgM3
  }, 0)
  const expectedSelfWeightN = expectedMassKg * GRAVITY_M_S2 * result.parameters.deadLoadFactor
  const diameters = [...new Set(model.members.map((member) => member.diameterM * 1000))].sort((a, b) => b - a)

  const steelMass = repaired.checks.find((check) => check.id === 'steel-mass')
  if (steelMass) {
    const actual = result.analysis.totalMassKg
    const error = relativeError(actual, expectedMassKg)
    Object.assign(steelMass, {
      explanation: 'Масса независимо суммируется по каждому физическому ребру с его собственным диаметром; это проверяет смешанный профиль без использования одного эквивалентного сечения.',
      formula: 'm = Σ Li·(πdi²/4)·ρi',
      substitution: `${model.members.length} рёбер; диаметры ${diameters.map((value) => `Ø${value}`).join(', ')} → ${expectedMassKg} кг`,
      actual,
      expected: expectedMassKg,
      tolerance: 1e-10,
      relativeError: error,
      unit: 'кг',
      status: Number.isFinite(actual) && error <= 1e-10 ? PASS : FAIL,
      howToCheck: 'Сгруппируйте рёбра по диаметру, для каждой группы посчитайте LΣ·πd²/4·ρ и сложите массы групп.',
    })
  }

  const selfWeight = repaired.checks.find((check) => check.id === 'self-weight')
  if (selfWeight) {
    const actual = result.loads.selfWeightN
    const error = relativeError(actual, expectedSelfWeightN)
    Object.assign(selfWeight, {
      explanation: 'Расчётный собственный вес строится из независимо пересчитанной массы всех рёбер смешанного профиля.',
      formula: 'G = (Σmi)·g·γg',
      substitution: `${expectedMassKg}·${GRAVITY_M_S2}·${result.parameters.deadLoadFactor} = ${expectedSelfWeightN} Н`,
      actual,
      expected: expectedSelfWeightN,
      tolerance: 1e-10,
      relativeError: error,
      unit: 'Н',
      status: Number.isFinite(actual) && error <= 1e-10 ? PASS : FAIL,
      howToCheck: 'Умножьте суммарную массу всех групп арматуры на 9,80665 и коэффициент постоянной нагрузки γg.',
    })
  }

  return recalculatePassportStatus(repaired)
}
