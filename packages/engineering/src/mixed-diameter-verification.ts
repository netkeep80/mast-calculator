import type { ResolvedProject } from '../../domain/contracts.js'
import type { GeneratedMastModel } from '../../structural-analysis/index.js'

const GRAVITY_M_S2 = 9.80665
const PASS = 'pass'
const FAIL = 'fail'
const PENDING = 'not-verified'

type VerificationStatus = typeof PASS | typeof FAIL | typeof PENDING

interface VerificationCheck {
  id: string
  level: number
  status: VerificationStatus
  [key: string]: unknown
}

interface VerificationLevel {
  number: number
  status?: VerificationStatus
  checkIds?: readonly string[]
  [key: string]: unknown
}

interface VerificationPassportLike {
  checks?: VerificationCheck[]
  levels?: VerificationLevel[]
  counts?: Readonly<Record<string, number>>
  [key: string]: unknown
}

interface MixedDiameterResult {
  model: GeneratedMastModel
  parameters: ResolvedProject
  analysis: { totalMassKg: number }
  loads: { selfWeightN: number }
}

const relativeError = (actual: number, expected: number): number => (
  Math.abs(actual - expected) / Math.max(1, Math.abs(expected))
)

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((nested) => cloneValue(nested)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, cloneValue(nested)]),
    ) as T
  }
  return value
}

function memberLength(model: GeneratedMastModel, member: GeneratedMastModel['members'][number]): number {
  const a = model.nodes[member.nodeA]?.position
  const b = model.nodes[member.nodeB]?.position
  if (!a || !b) throw new Error(`Не найдены узлы ребра ${member.id} для независимой проверки массы`)
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

function recalculatePassportStatus(passport: VerificationPassportLike): VerificationPassportLike {
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

export function repairMixedDiameterVerificationPassport(
  passport: VerificationPassportLike | null | undefined,
  result: MixedDiameterResult | null | undefined,
): VerificationPassportLike | null | undefined {
  if (!passport?.checks || !result?.model?.members?.length) return passport
  const repaired = cloneValue(passport)
  const model = result.model
  const expectedMassKg = model.members.reduce((sum, member) => {
    const areaM2 = Math.PI * member.diameterM ** 2 / 4
    return sum + memberLength(model, member) * areaM2 * member.densityKgM3
  }, 0)
  const expectedSelfWeightN = expectedMassKg * GRAVITY_M_S2 * result.parameters.deadLoadFactor
  const diameters = [...new Set(model.members.map((member) => member.diameterM * 1000))].sort((a, b) => b - a)

  const steelMass = repaired.checks?.find((check) => check.id === 'steel-mass')
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

  const selfWeight = repaired.checks?.find((check) => check.id === 'self-weight')
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
