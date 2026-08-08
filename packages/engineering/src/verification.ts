import type { ResolvedProject } from '../../domain/contracts.js'
import { AIR_DENSITY_KG_M3 } from '../../domain/index.js'
import {
  denseToSymmetricBand,
  factorSymmetricBand,
  relativeBandResidual,
  solveDenseSystem,
  solveSymmetricBandFactor,
} from '../../numerics/index.js'
import {
  analyzeFrame,
  calculateCriticalBucklingFactor,
  calculateCriticalBucklingFactorBanded,
} from '../../structural-analysis/index.js'
import type { LoadCase, MastModel, Vector3 } from '../../structural-analysis/contracts.js'
import type { CheckedFrameAnalysis, EngineeringCase, VerificationPassport } from './contracts.js'

export const VERIFICATION_METHOD = 'layered-layperson-verification-v1'
export const VERIFICATION_GRAVITY_M_S2 = 9.80665

const PASS = 'pass' as const
const FAIL = 'fail' as const
const PENDING = 'not-verified' as const

type VerificationStatus = typeof PASS | typeof FAIL | typeof PENDING
type MutableVector3 = [number, number, number]
type VectorLike = readonly number[]

interface VerificationCheck {
  [key: string]: unknown
  id: string
  level: number
  title: string
  explanation: string
  status: VerificationStatus
  howToCheck: string
  formula?: string
  substitution?: string
  actual?: number
  expected?: number
  tolerance?: number
  relativeError?: number
  unit?: string
  evidence?: string
}

interface NumericCheckInput {
  id: string
  level: number
  title: string
  explanation: string
  formula: string
  substitution: string
  actual: number
  expected: number
  tolerance: number
  unit?: string
  howToCheck: string
}

interface BooleanCheckInput {
  id: string
  level: number
  title: string
  explanation: string
  passed: boolean
  evidence: string
  howToCheck: string
}

interface VerificationLevel {
  [key: string]: unknown
  number: number
  title: string
  description: string
  status: VerificationStatus
  checkIds: string[]
}

interface VerificationResult {
  parameters: ResolvedProject
  model: MastModel
  analysis: Pick<CheckedFrameAnalysis, 'totalMassKg'>
  loads: LoadCase & { readonly selfWeightN: number }
  cases: readonly EngineeringCase[]
  envelope: {
    readonly governing: {
      readonly analysis: CheckedFrameAnalysis
      readonly loads: LoadCase
    }
  }
}

interface SingleBeamInput {
  lengthM: number
  diameterM: number
  axis?: Vector3
}

const relativeError = (actual: number, expected: number): number => (
  Math.abs(actual - expected) / Math.max(1, Math.abs(expected))
)
const norm3 = (value: VectorLike): number => Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
const add3 = (left: VectorLike, right: VectorLike): MutableVector3 => [
  (left[0] ?? 0) + (right[0] ?? 0),
  (left[1] ?? 0) + (right[1] ?? 0),
  (left[2] ?? 0) + (right[2] ?? 0),
]

function numericCheck({
  id,
  level,
  title,
  explanation,
  formula,
  substitution,
  actual,
  expected,
  tolerance,
  unit = '',
  howToCheck,
}: NumericCheckInput): VerificationCheck {
  const error = relativeError(actual, expected)
  return {
    id,
    level,
    title,
    explanation,
    formula,
    substitution,
    actual,
    expected,
    tolerance,
    relativeError: error,
    unit,
    status: Number.isFinite(actual) && Number.isFinite(expected) && error <= tolerance ? PASS : FAIL,
    howToCheck,
  }
}

function booleanCheck({
  id,
  level,
  title,
  explanation,
  passed,
  evidence,
  howToCheck,
}: BooleanCheckInput): VerificationCheck {
  return {
    id,
    level,
    title,
    explanation,
    status: passed ? PASS : FAIL,
    evidence,
    howToCheck,
  }
}

function pendingCheck(
  id: string,
  level: number,
  title: string,
  explanation: string,
  howToCheck: string,
): VerificationCheck {
  return { id, level, title, explanation, status: PENDING, howToCheck }
}

function memberLength(model: MastModel, member: MastModel['members'][number]): number {
  const a = model.nodes[member.nodeA]?.position
  const b = model.nodes[member.nodeB]?.position
  if (!a || !b) throw new Error(`Не найдены узлы ребра ${member.id} для verification passport`)
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

function geometryAndMaterialChecks(result: VerificationResult): VerificationCheck[] {
  const p = result.parameters
  const model = result.model
  const aExpectedMm = p.stockBarLengthMm / p.stockBarPieces
  const hExpectedMm = aExpectedMm * Math.sqrt(2 / 3)
  const heightExpectedM = p.moduleCount * hExpectedMm / 1000
  const actualZ = model.nodes.map((node) => node.position[2])
  const heightActualM = Math.max(...actualZ) - Math.min(...actualZ)
  const expectedMemberCount = p.moduleCount * 9
  const targetLengthM = p.ribCutLengthMm / 1000
  const lengths = model.members.map((member) => memberLength(model, member))
  const maximumLengthErrorM = Math.max(...lengths.map((length) => Math.abs(length - targetLengthM)), 0)
  const diameterM = p.barDiameterMm / 1000
  const areaM2 = Math.PI * diameterM ** 2 / 4
  const totalLengthM = model.members.length * targetLengthM
  const expectedMassKg = totalLengthM * areaM2 * p.densityKgM3
  const expectedSelfWeightN = expectedMassKg * VERIFICATION_GRAVITY_M_S2 * p.deadLoadFactor
  const expectedPressurePa = 0.5 * AIR_DENSITY_KG_M3 * p.windSpeedMs ** 2

  return [
    numericCheck({
      id: 'cut-length', level: 1,
      title: 'Длина ребра из закупочного прутка',
      explanation: 'Первую величину можно проверить обычным делением на калькуляторе.',
      formula: 'a = L₀ / n',
      substitution: `${p.stockBarLengthMm} мм / ${p.stockBarPieces} = ${aExpectedMm} мм`,
      actual: p.ribCutLengthMm, expected: aExpectedMm, tolerance: 1e-12, unit: 'мм',
      howToCheck: 'Разделите закупочную длину прутка в миллиметрах на число равных частей и сравните с полем «Длина ребра».',
    }),
    numericCheck({
      id: 'octahedron-height', level: 1,
      title: 'Высота правильного октаэдра',
      explanation: 'Высота модуля не является независимым вводом.',
      formula: 'h = a·√(2/3)',
      substitution: `${aExpectedMm}·√(2/3) = ${hExpectedMm} мм`,
      actual: p.moduleHeightMm, expected: hExpectedMm, tolerance: 1e-12, unit: 'мм',
      howToCheck: 'Умножьте длину ребра на √(2/3) ≈ 0,81649658.',
    }),
    numericCheck({
      id: 'mast-height', level: 1,
      title: 'Полная высота геометрической модели',
      explanation: 'Проверяется не подпись UI, а фактические координаты узлов FEM-модели.',
      formula: 'H = N·h',
      substitution: `${p.moduleCount}·${hExpectedMm} мм = ${heightExpectedM} м`,
      actual: heightActualM, expected: heightExpectedM, tolerance: 1e-12, unit: 'м',
      howToCheck: 'Умножьте число модулей на вычисленную высоту одного октаэдра.',
    }),
    booleanCheck({
      id: 'member-count', level: 1,
      title: 'Количество рёбер соответствует топологии',
      explanation: 'Каждый физический модуль содержит собственный верхний треугольник и шесть диагональных рёбер — всего 9 рёбер; отдельного closeTopRing в канонической геометрии нет.',
      passed: model.members.length === expectedMemberCount,
      evidence: `модель: ${model.members.length}; ожидается: ${expectedMemberCount}`,
      howToCheck: `Посчитайте 9·${p.moduleCount}.`,
    }),
    booleanCheck({
      id: 'equal-edges', level: 1,
      title: 'Все рёбра модели имеют заданную длину',
      explanation: 'Это прямой контроль координат всех стержней, а не только формулы высоты.',
      passed: maximumLengthErrorM <= Math.max(1e-10, targetLengthM * 1e-10),
      evidence: `максимальное отклонение длины = ${maximumLengthErrorM} м`,
      howToCheck: 'В расчётном проекте длины рёбер должны совпадать с a; программа дополнительно проверяет все координаты автоматически.',
    }),
    numericCheck({
      id: 'steel-mass', level: 1,
      title: 'Масса арматурного каркаса',
      explanation: 'Для одинаковых круглых рёбер массу можно независимо получить из общей длины, площади сечения и плотности стали.',
      formula: 'm = LΣ·(πd²/4)·ρ',
      substitution: `${totalLengthM} м · π·${diameterM}²/4 · ${p.densityKgM3} = ${expectedMassKg} кг`,
      actual: result.analysis.totalMassKg, expected: expectedMassKg, tolerance: 1e-10, unit: 'кг',
      howToCheck: 'Посчитайте число рёбер, умножьте на длину одного ребра, затем на πd²/4 и плотность стали.',
    }),
    numericCheck({
      id: 'self-weight', level: 1,
      title: 'Расчётный собственный вес',
      explanation: 'Проверяется преобразование массы стали в расчётную силу тяжести.',
      formula: 'G = m·g·γg',
      substitution: `${expectedMassKg}·${VERIFICATION_GRAVITY_M_S2}·${p.deadLoadFactor} = ${expectedSelfWeightN} Н`,
      actual: result.loads.selfWeightN, expected: expectedSelfWeightN, tolerance: 1e-10, unit: 'Н',
      howToCheck: 'Умножьте массу стали на 9,80665 и коэффициент постоянной нагрузки γg.',
    }),
    numericCheck({
      id: 'wind-pressure', level: 1,
      title: 'Скорость ветра переводится в давление',
      explanation: 'Проверяет погодный слой до FEM.',
      formula: 'q = ρair·v²/2',
      substitution: `0,5·${AIR_DENSITY_KG_M3}·${p.windSpeedMs}² = ${expectedPressurePa} Па`,
      actual: p.windPressurePa, expected: expectedPressurePa, tolerance: 1e-10, unit: 'Па',
      howToCheck: 'Возведите скорость ветра в квадрат, умножьте на 1,225 и разделите на 2.',
    }),
  ]
}

function equilibriumChecks(result: VerificationResult): VerificationCheck[] {
  const cases = result.cases
  const worstRelativeResidual = Math.max(...cases.map((item) => item.analysis.diagnostics.relativeResidual))
  const worstNodeResidual = Math.max(...cases.map((item) => item.analysis.diagnostics.maximumNodeEquilibriumResidual))
  const worstMomentResidual = Math.max(...cases.map((item) => item.analysis.diagnostics.globalMomentResidual))
  const worstBucklingResidual = Math.max(...cases.map((item) => item.analysis.buckling.residual))
  const governing = result.envelope.governing
  const reaction = governing.analysis.reactions.reduce<MutableVector3>((sum, value) => add3(sum, value), [0, 0, 0])
  const forceClosure = add3(reaction, governing.loads.totalAppliedLoad)
  const forceScale = Math.max(1, norm3(governing.loads.totalAppliedLoad), norm3(reaction))
  const forceClosureRatio = norm3(forceClosure) / forceScale

  return [
    booleanCheck({
      id: 'global-force-equilibrium', level: 2,
      title: 'Сумма сил замыкается',
      explanation: 'Реакции основания должны быть равны внешним силам с противоположным знаком.',
      passed: forceClosureRatio < 1e-8,
      evidence: `|ΣR + ΣF| / scale = ${forceClosureRatio}`,
      howToCheck: 'В проекте сложите X/Y/Z-компоненты внешних сил и реакций. Для каждой оси сумма должна быть практически нулевой.',
    }),
    booleanCheck({
      id: 'global-moment-equilibrium', level: 2,
      title: 'Сумма моментов замыкается',
      explanation: 'Проверяется физическое равновесие моментов внешних нагрузок и реакций относительно начала координат.',
      passed: worstMomentResidual < 1e-8,
      evidence: `худшая относительная невязка моментов = ${worstMomentResidual}`,
      howToCheck: 'Это более трудоёмкая ручная проверка: для каждой силы вычисляется r×F и добавляются реактивные моменты. В проекте приведена готовая относительная невязка.',
    }),
    booleanCheck({
      id: 'linear-system-residual', level: 2,
      title: 'Матрица действительно удовлетворяет K·u = F',
      explanation: 'Даже если формулы модели правильны, численный решатель должен решить собранную систему.',
      passed: worstRelativeResidual < 1e-8,
      evidence: `max ||K·u−F||/||F|| = ${worstRelativeResidual}`,
      howToCheck: 'Неспециалисту не нужно перемножать всю матрицу: достаточно убедиться, что невязка на много порядков меньше 1. Порог приложения — 1e−8.',
    }),
    booleanCheck({
      id: 'free-dof-equilibrium', level: 2,
      title: 'В свободных степенях свободы нет необъяснимых сил',
      explanation: 'После восстановления внутренних усилий каждый свободный узел должен быть в равновесии.',
      passed: worstNodeResidual < 1e-8,
      evidence: `максимальная нормированная невязка свободной DOF = ${worstNodeResidual}`,
      howToCheck: 'Смотрите этот показатель как контрольную сумму FEM: значение порядка 1e−10…1e−12 хорошо, выше 1e−8 приложение считает подозрительным.',
    }),
    booleanCheck({
      id: 'buckling-residual', level: 2,
      title: 'Найденная форма устойчивости удовлетворяет eigen-уравнению',
      explanation: 'Проверяется исходное уравнение (K + λKG)φ = 0, а не только внутренний критерий Lanczos.',
      passed: worstBucklingResidual < 1e-5,
      evidence: `max buckling residual = ${worstBucklingResidual}`,
      howToCheck: 'Для eigen-задачи принят более мягкий численный порог 1e−5. Большая невязка означает, что критический множитель нельзя считать надёжно найденным.',
    }),
  ]
}

function singleBeamModel({ lengthM, diameterM, axis = [1, 0, 0] }: SingleBeamInput): MastModel {
  const end = axis.map((value) => value * lengthM) as MutableVector3
  return {
    moduleCount: 1,
    topNodeIds: [1],
    nodes: [
      { id: 0, position: [0, 0, 0], restrained: [true, true, true, true, true, true] },
      { id: 1, position: end, restrained: [false, false, false, false, false, false] },
    ],
    members: [{
      id: 0,
      nodeA: 0,
      nodeB: 1,
      diameterM,
      youngModulusPa: 200e9,
      yieldStrengthPa: 400e6,
      tensileStrengthPa: 400e6,
      poissonRatio: 0.3,
      densityKgM3: 7850,
      effectiveLengthFactor: 0.5,
    }],
  }
}

function zeroLoadCase(model: MastModel, nodalLoads: readonly Vector3[]): LoadCase {
  return {
    nodalLoads,
    nodalMoments: model.nodes.map(() => [0, 0, 0]),
    memberDistributedLoads: model.members.map(() => [0, 0, 0]),
    totalAppliedLoad: nodalLoads.reduce<MutableVector3>((sum, value) => add3(sum, value), [0, 0, 0]),
    selfWeightN: 0,
    iceWeightN: 0,
    memberWindN: 0,
    equipmentWindN: 0,
  }
}

function analyticalBenchmarkChecks(): VerificationCheck[] {
  const parameters = {
    materialSafetyFactor: 1,
    effectiveLengthFactor: 0.5,
  }

  const axialLengthM = 2
  const axialDiameterM = 0.01
  const axialForceN = 10_000
  const axialModel = singleBeamModel({ lengthM: axialLengthM, diameterM: axialDiameterM })
  const axial = analyzeFrame(
    axialModel as Parameters<typeof analyzeFrame>[0],
    zeroLoadCase(axialModel, [[0, 0, 0], [axialForceN, 0, 0]]) as Parameters<typeof analyzeFrame>[1],
    parameters as Parameters<typeof analyzeFrame>[2],
  )
  const axialAreaM2 = Math.PI * axialDiameterM ** 2 / 4
  const axialExpectedM = axialForceN * axialLengthM / (200e9 * axialAreaM2)

  const bendLengthM = 2
  const bendDiameterM = 0.02
  const bendForceN = 500
  const bendModel = singleBeamModel({ lengthM: bendLengthM, diameterM: bendDiameterM })
  const bend = analyzeFrame(
    bendModel as Parameters<typeof analyzeFrame>[0],
    zeroLoadCase(bendModel, [[0, 0, 0], [0, bendForceN, 0]]) as Parameters<typeof analyzeFrame>[1],
    parameters as Parameters<typeof analyzeFrame>[2],
  )
  const inertiaM4 = Math.PI * bendDiameterM ** 4 / 64
  const bendExpectedM = bendForceN * bendLengthM ** 3 / (3 * 200e9 * inertiaM4)
  const rotationExpectedRad = bendForceN * bendLengthM ** 2 / (2 * 200e9 * inertiaM4)

  return [
    numericCheck({
      id: 'reference-axial-bar', level: 3,
      title: 'Эталон 1: растяжение одного стержня',
      explanation: 'Программа сама решает простейшую задачу, у которой ответ известен в одну формулу.',
      formula: 'δ = F·L/(E·A)',
      substitution: `${axialForceN}·${axialLengthM}/(200e9·π·${axialDiameterM}²/4) = ${axialExpectedM} м`,
      actual: axial.displacements[1]![0], expected: axialExpectedM, tolerance: 1e-9, unit: 'м',
      howToCheck: 'Эту формулу можно набрать на любом инженерном калькуляторе. Совпадение проверяет осевую часть frame-element и систему единиц.',
    }),
    numericCheck({
      id: 'reference-cantilever-deflection', level: 3,
      title: 'Эталон 2: прогиб консоли',
      explanation: 'Проверяется изгибная часть 3D frame-element на классической консоли.',
      formula: 'δ = P·L³/(3·E·I)',
      substitution: `${bendForceN}·${bendLengthM}³/(3·200e9·${inertiaM4}) = ${bendExpectedM} м`,
      actual: bend.displacements[1]![1], expected: bendExpectedM, tolerance: 1e-8, unit: 'м',
      howToCheck: 'Посчитайте I=πd⁴/64, затем подставьте P, L, E и I в формулу прогиба консоли.',
    }),
    numericCheck({
      id: 'reference-cantilever-rotation', level: 3,
      title: 'Эталон 3: поворот конца консоли',
      explanation: 'Одновременно проверяется вращательная степень свободы узла.',
      formula: 'θ = P·L²/(2·E·I)',
      substitution: `${bendForceN}·${bendLengthM}²/(2·200e9·${inertiaM4}) = ${rotationExpectedRad} рад`,
      actual: Math.abs(bend.rotations[1]![2]), expected: rotationExpectedRad, tolerance: 1e-8, unit: 'рад',
      howToCheck: 'Используйте тот же I, что в предыдущем шаге. Независимое совпадение двух величин труднее получить при случайной ошибке в матрице элемента.',
    }),
  ]
}

function crossAlgorithmChecks(): VerificationCheck[] {
  const matrix = [
    [7, -2, 0.5, 0, 0],
    [-2, 8, -1, 0.25, 0],
    [0.5, -1, 6, -1.5, 0.2],
    [0, 0.25, -1.5, 7, -1],
    [0, 0, 0.2, -1, 5],
  ]
  const rhs = [3, -2, 5, 1, 4]
  const dense = solveDenseSystem(matrix, rhs).solution
  const band = denseToSymmetricBand(matrix)
  const factor = factorSymmetricBand(band)
  const banded = solveSymmetricBandFactor(factor, rhs)
  const maxDifference = Math.max(...dense.map((value, index) => Math.abs(value - banded[index]!)))
  const bandResidual = relativeBandResidual(band, banded, rhs)

  const elastic = [[2, 0], [0, 8]]
  const geometric = [[-1, 0], [0, -2]]
  const denseBuckling = calculateCriticalBucklingFactor(elastic, geometric)
  const elasticBand = denseToSymmetricBand(elastic)
  const geometricBand = denseToSymmetricBand(geometric)
  const elasticFactor = factorSymmetricBand(elasticBand)
  const bandedBuckling = calculateCriticalBucklingFactorBanded(
    elasticBand,
    elasticFactor,
    geometricBand,
    { maxIterations: 2, checkEvery: 1, tolerance: 1e-10 },
  )

  return [
    booleanCheck({
      id: 'dense-vs-banded', level: 4,
      title: 'Два разных линейных решателя дают один ответ',
      explanation: 'Оптимизированная ленточная Cholesky сравнивается с отдельным плотным Gaussian solver на одной SPD-задаче.',
      passed: maxDifference < 1e-10 && bandResidual < 1e-12,
      evidence: `max |x_dense−x_band| = ${maxDifference}; residual = ${bandResidual}`,
      howToCheck: 'Это программная перекрёстная проверка двумя разными алгоритмами. При общей ошибке подготовки матрицы она не заменяет физический эталон, поэтому идёт отдельным уровнем.',
    }),
    booleanCheck({
      id: 'known-buckling-eigenvalue', level: 4,
      title: 'Eigen-buckling совпадает с задачей с известным λ = 2',
      explanation: 'Для диагональных K=diag(2,8) и KG=diag(−1,−2) критические множители равны 2 и 4; первый должен быть 2.',
      passed: Math.abs(denseBuckling.factor - 2) < 1e-8
        && Math.abs(bandedBuckling.factor - 2) < 1e-8
        && Math.abs(denseBuckling.factor - bandedBuckling.factor) < 1e-8,
      evidence: `λ_dense = ${denseBuckling.factor}; λ_banded = ${bandedBuckling.factor}; ожидается 2`,
      howToCheck: 'В этой диагональной задаче достаточно решить 2 + λ(−1)=0 и 8 + λ(−2)=0: получаются λ=2 и λ=4.',
    }),
  ]
}

function externalChecks(): VerificationCheck[] {
  return [
    pendingCheck(
      'external-fem', 5,
      'Независимый КЭ-комплекс',
      'Текущая программа пока не имеет опубликованного cross-check той же мачты в стороннем FEM-пакете.',
      'Для перехода этого пункта в зелёный статус надо сравнить координаты, закрепления, нагрузки, перемещения, реакции, N/V/T/M и λcr с независимым КЭ-комплексом и сохранить исходный файл/скриншоты результатов.',
    ),
    pendingCheck(
      'expert-review', 5,
      'Проверка расчётной записки инженером',
      'Автоматические тесты не заменяют проверку постановки задачи и допущений специалистом по конструкциям.',
      'Перед реальным строительством передайте сгенерированный расчётный проект инженеру-конструктору; замечания должны быть зафиксированы и воспроизводимо устранены.',
    ),
    pendingCheck(
      'physical-test', 6,
      'Натурное испытание контрольного образца',
      'Физическое испытание проверяет не только математику, но и несовершенства, сварку, фактическую жёсткость узлов и материал.',
      'Безопаснее проверять недеструктивные контрольные уровни нагрузки с измерением прогиба, а предельные испытания выполнять только по отдельной безопасной программе без людей в зоне падения.',
    ),
  ]
}

function levelsFromChecks(checks: readonly VerificationCheck[]): VerificationLevel[] {
  const definitions: ReadonlyArray<readonly [number, string, string]> = [
    [1, 'Можно пересчитать вручную', 'Простые геометрические, массовые и нагрузочные формулы.'],
    [2, 'Физическое и численное равновесие', 'Проверка K·u=F, сил, моментов, узлов и eigen-residual.'],
    [3, 'Задачи с известным ответом', 'Тот же frame solver решает классические задачи и сравнивается с формулами.'],
    [4, 'Перекрёстная проверка алгоритмов', 'Оптимизированные численные методы сравниваются с независимым dense reference.'],
    [5, 'Независимая внешняя проверка', 'Сторонний FEM и инженер-рецензент.'],
    [6, 'Физический эксперимент', 'Натурный контроль реальной конструкции.'],
  ]
  return definitions.map(([number, title, description]) => {
    const levelChecks = checks.filter((check) => check.level === number)
    const hasFail = levelChecks.some((check) => check.status === FAIL)
    const hasPending = levelChecks.some((check) => check.status === PENDING)
    const status: VerificationStatus = hasFail ? FAIL : hasPending ? PENDING : PASS
    return { number, title, description, status, checkIds: levelChecks.map((check) => check.id) }
  })
}

export function buildVerificationPassport(result: VerificationResult): VerificationPassport {
  if (!result?.parameters || !result?.model?.members?.length || !result?.cases?.length) {
    throw new Error('Для верификации нужен полный результат расчёта мачты')
  }

  const checks = [
    ...geometryAndMaterialChecks(result),
    ...equilibriumChecks(result),
    ...analyticalBenchmarkChecks(),
    ...crossAlgorithmChecks(),
    ...externalChecks(),
  ]
  const passed = checks.filter((check) => check.status === PASS).length
  const failed = checks.filter((check) => check.status === FAIL).length
  const notVerified = checks.filter((check) => check.status === PENDING).length
  const internalChecks = checks.filter((check) => check.level <= 4)
  const internalPassed = internalChecks.every((check) => check.status === PASS)

  return {
    method: VERIFICATION_METHOD,
    status: failed > 0 ? 'failed' : internalPassed ? 'internal-passed-external-pending' : 'incomplete',
    headline: failed > 0
      ? 'Внутренняя проверка обнаружила несоответствие — результат нельзя считать надёжным.'
      : 'Внутренние проверки пройдены; независимая внешняя верификация и натурное подтверждение пока не выполнены.',
    explanation: 'Цель паспорта — не просить неспециалиста поверить сложному FEM-расчёту. Вместо этого расчёт разбит на уровни: простые формулы, законы равновесия, задачи с известным ответом, другой численный алгоритм, затем независимый инженер и эксперимент.',
    counts: { total: checks.length, passed, failed, notVerified, internal: internalChecks.length },
    levels: levelsFromChecks(checks),
    checks,
    thresholds: {
      linearResidual: 1e-8,
      freeDofEquilibrium: 1e-8,
      globalMomentResidual: 1e-8,
      bucklingResidual: 1e-5,
    },
  }
}
