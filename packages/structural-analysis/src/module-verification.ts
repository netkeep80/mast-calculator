const PASS = 'pass' as const
const FAIL = 'fail' as const
const PENDING = 'not-verified' as const

type VerificationStatus = typeof PASS | typeof FAIL | typeof PENDING

interface VerificationCheck {
  readonly id: string
  readonly level: number
  readonly status: VerificationStatus
  readonly [key: string]: unknown
}

interface VerificationLevel {
  readonly number: number
  readonly [key: string]: unknown
}

interface VerificationPassport {
  readonly levels: readonly VerificationLevel[]
  readonly checks: readonly VerificationCheck[]
  readonly thresholds: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

interface ModularAnalysisResult {
  readonly relativeDisplacementDifference?: number
  readonly interfaceEquilibriumResidual?: number
}

interface VerificationCase {
  readonly analysis: {
    readonly modular?: ModularAnalysisResult
  }
}

interface VerificationMember {
  readonly role?: string
}

interface VerificationModule {
  readonly memberIds: readonly number[]
}

interface VerificationModel {
  readonly modules?: readonly VerificationModule[]
  readonly members: readonly VerificationMember[]
}

interface VerificationResult {
  readonly cases?: readonly VerificationCase[]
  readonly model: VerificationModel
  readonly parameters: {
    readonly moduleCount: number
  }
}

function statusFor(value: number, threshold: number): VerificationStatus {
  return Number.isFinite(value) && value <= threshold ? PASS : FAIL
}

function recompute(passport: VerificationPassport, checks: readonly VerificationCheck[]) {
  const levels = passport.levels.map((level) => {
    const levelChecks = checks.filter((check) => check.level === level.number)
    const hasFail = levelChecks.some((check) => check.status === FAIL)
    const hasPending = levelChecks.some((check) => check.status === PENDING)
    return {
      ...level,
      status: hasFail ? FAIL : hasPending ? PENDING : PASS,
      checkIds: levelChecks.map((check) => check.id),
    }
  })
  const passed = checks.filter((check) => check.status === PASS).length
  const failed = checks.filter((check) => check.status === FAIL).length
  const notVerified = checks.filter((check) => check.status === PENDING).length
  const internalChecks = checks.filter((check) => check.level <= 4)
  const internalPassed = internalChecks.every((check) => check.status === PASS)
  return {
    ...passport,
    method: 'layered-layperson-verification-v2',
    status: failed > 0 ? 'failed' : internalPassed ? 'internal-passed-external-pending' : 'incomplete',
    headline: failed > 0
      ? 'Внутренняя проверка обнаружила несоответствие — результат нельзя считать надёжным.'
      : 'Внутренние проверки, включая независимый помодульный static cross-check, пройдены; внешняя верификация и натурное подтверждение пока не выполнены.',
    checks,
    levels,
    counts: { total: checks.length, passed, failed, notVerified, internal: internalChecks.length },
    thresholds: {
      ...passport.thresholds,
      modularDisplacementDifference: 1e-8,
      modularInterfaceEquilibrium: 1e-8,
    },
  }
}

export function augmentVerificationWithModuleChecks(
  passport: VerificationPassport,
  result: VerificationResult,
) {
  const cases = result.cases ?? []
  const worstDisplacementDifference = Math.max(
    0,
    ...cases.map((item) => item.analysis.modular?.relativeDisplacementDifference ?? Number.POSITIVE_INFINITY),
  )
  const worstInterfaceResidual = Math.max(
    0,
    ...cases.map((item) => item.analysis.modular?.interfaceEquilibriumResidual ?? Number.POSITIVE_INFINITY),
  )
  const topologyPassed = Array.isArray(result.model.modules)
    && result.model.modules.length === result.parameters.moduleCount
    && result.model.modules.every((module) => (
      module.memberIds.length === 9
      && module.memberIds.slice(0, 3).every((memberId: number) => result.model.members[memberId]?.role === 'top-ring')
      && module.memberIds.slice(3).every((memberId: number) => result.model.members[memberId]?.role === 'leg')
    ))

  const additions: VerificationCheck[] = [
    {
      id: 'module-legs-down-topology',
      level: 1,
      title: 'Каждый физический модуль ориентирован ножками вниз',
      explanation: 'Три горизонтальных ребра принадлежат верхней грани каждого модуля, а шесть диагональных ножек идут к нижней грани. Специального замыкания вершины нет.',
      status: topologyPassed ? PASS : FAIL,
      evidence: `${result.model.modules?.length ?? 0} модулей; каждый должен иметь 3 top-ring + 6 leg`,
      howToCheck: 'Выберите любой модуль в основной визуализации: его горизонтальный треугольник должен находиться сверху, а три пары ножек — уходить вниз.',
    },
    {
      id: 'module-interface-equilibrium',
      level: 2,
      title: 'Силы и моменты соседних модулей взаимно уравновешиваются',
      explanation: 'На общей треугольной грани действие верхнего стека на нижний модуль должно быть равно и противоположно реакции нижнего стека на верхний.',
      formula: 'Ftop,lower + Fbottom,upper = 0; Mtop,lower + Mbottom,upper = 0',
      actual: worstInterfaceResidual,
      expected: 0,
      tolerance: 1e-8,
      relativeError: worstInterfaceResidual,
      status: statusFor(worstInterfaceResidual, 1e-8),
      evidence: `worst normalized interface residual = ${worstInterfaceResidual}`,
      howToCheck: 'В подробном окне соседних модулей сравните силы одного и того же интерфейса: компоненты должны совпадать по модулю и иметь противоположные знаки.',
    },
    {
      id: 'module-schur-vs-global',
      level: 4,
      title: 'Помодульный Schur solver совпадает с глобальной FEM',
      explanation: 'Один и тот же load case решается двумя разными путями: глобальной banded Cholesky и последовательной конденсацией одинаковых модулей сверху вниз. Сравниваются все перемещения и повороты узлов.',
      formula: 'u_module-stack ≈ u_global',
      actual: worstDisplacementDifference,
      expected: 0,
      tolerance: 1e-8,
      relativeError: worstDisplacementDifference,
      status: statusFor(worstDisplacementDifference, 1e-8),
      evidence: `worst ||u_modular-u_global||/||u_global|| = ${worstDisplacementDifference}`,
      howToCheck: 'Это автоматический cross-algorithm check: два способа сборки/решения должны давать один и тот же вектор 6 DOF на каждом узле с относительным расхождением меньше 1e−8.',
    },
  ]

  return recompute(passport, [...passport.checks, ...additions])
}
