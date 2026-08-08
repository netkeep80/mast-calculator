import type { ResolvedProject } from '../../domain/contracts.js'
import { resolveCalculationParameters } from '../../domain/index.js'
import {
  analyzeCheckedFrame,
  buildVerificationPassport,
  calculateConnectionChecks,
  calculateLateralCapacity,
  calculateStaticPayloadCapacity,
  lateralDirections,
  STATIC_PAYLOAD_PROGRESS_STEPS,
} from '../../engineering/index.js'
import {
  buildLoadCase,
  compileFrameSystem,
  compileModuleStack,
  generateMastModel,
  solveModuleStack,
} from '../../structural-analysis/index.js'

const ROTATIONAL_SYMMETRY_DEG = 120
export const HEIGHT_SEARCH_PROGRESS_STEPS = 32
const HEIGHT_SEARCH_NEIGHBOURHOOD = 4
const PASS_TOLERANCE = 1e-9

export const CALCULATION_METHOD = Object.freeze({
  id: 'linear-frame-v1.1',
  description: 'Линейная пространственная Euler-Bernoulli frame-модель; статическое состояние дополнительно решается точной помодульной Schur-конденсацией сверху вниз, global eigen-buckling сохраняет полную связанную модель; физический узел из двух гаек и болта проверяется отдельным connection-layer.',
})

type MastModel = ReturnType<typeof generateMastModel>
type FrameSystem = ReturnType<typeof compileFrameSystem>
type ModuleStack = ReturnType<typeof compileModuleStack>
type BuiltLoadCase = ReturnType<typeof buildLoadCase>
type CheckedAnalysis = ReturnType<typeof analyzeCheckedFrame>
type SolvedModuleStack = ReturnType<typeof solveModuleStack>
type ConnectionChecks = ReturnType<typeof calculateConnectionChecks>

type MemberResult = CheckedAnalysis['memberResults'][number]
type SolvedModuleState = SolvedModuleStack['modules'][number]

interface EnrichedModuleState extends SolvedModuleState {
  criticalMemberId: number
  maxUtilization: number
  maxStressUtilization: number
  maxBucklingUtilization: number
  maxRuptureUtilization: number
  verticalFailureMode: 'local-member-buckling' | 'tensile-rupture'
  verticalFailureMemberId: number
  verticalFailureUtilization: number
  verticalFailureLoadFactor: number
}

interface ModularAnalysis extends SolvedModuleStack {
  relativeDisplacementDifference: number
  modules: EnrichedModuleState[]
  interfaceFactorizationCount: number
  referenceSolver: string
}

type AnalysisWithModular = CheckedAnalysis & {
  modular?: ModularAnalysis
  moduleResults?: EnrichedModuleState[]
}

interface OperationalCase {
  windDirectionDeg: number
  loads: BuiltLoadCase
  analysis: AnalysisWithModular
}

interface CaseProgress {
  completed: number
  total: number
  directionDeg: number
}

export interface CalculationProgressEvent {
  phase: string
  label: string
  completed: number
  total: number
}

interface CalculateMastOptions {
  resolvedProject?: ResolvedProject
  model?: MastModel
  frameSystem?: FrameSystem
  moduleStack?: ModuleStack
  onProgress?: (event: CalculationProgressEvent) => void
}

interface HeightProgressEvent {
  completed: number
  total: number
  moduleCount: number
  label: string
}

interface CalculateMaximumHeightOptions {
  resolvedProject?: ResolvedProject
  knownResult?: ReturnType<typeof calculateMast>
  onProgress?: (event: HeightProgressEvent) => void
}

interface CalculateCompleteMastOptions {
  resolvedProject?: ResolvedProject
  onProgress?: (event: CalculationProgressEvent) => void
}

const canonicalSymmetryAngle = (angle: number): number => {
  const value = ((angle % ROTATIONAL_SYMMETRY_DEG) + ROTATIONAL_SYMMETRY_DEG) % ROTATIONAL_SYMMETRY_DEG
  return Math.abs(value - ROTATIONAL_SYMMETRY_DEG) < 1e-9 ? 0 : value
}

export function windDirections(parameters: ResolvedProject): number[] {
  if (!parameters.windEnvelopeEnabled) return [parameters.windDirectionDeg]
  const step = Number(parameters.windEnvelopeStepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 180) {
    throw new Error('Шаг перебора направлений ветра должен быть от 0 до 180°')
  }

  const unique = new Map<number, number>()
  for (let angle = 0; angle < 360 - step / 1000; angle += step) {
    const canonical = canonicalSymmetryAngle(angle)
    const key = Math.round(canonical * 1e9)
    if (!unique.has(key)) unique.set(key, canonical)
  }
  return [...unique.values()].sort((left, right) => left - right)
}

function maxBy<T>(items: readonly T[], selector: (item: T) => number): T {
  const first = items[0]
  if (first === undefined) throw new Error('Невозможно выбрать максимум из пустого набора')
  let best = first
  for (const item of items.slice(1)) {
    if (selector(item) > selector(best)) best = item
  }
  return best
}

function minBy<T>(items: readonly T[], selector: (item: T) => number): T {
  const first = items[0]
  if (first === undefined) throw new Error('Невозможно выбрать минимум из пустого набора')
  let best = first
  for (const item of items.slice(1)) {
    if (selector(item) < selector(best)) best = item
  }
  return best
}

const vectorNorm = (vector: readonly number[]): number => Math.hypot(...vector)

function createWarnings(
  parameters: ResolvedProject,
  governing: OperationalCase,
  buckling: OperationalCase,
): string[] {
  const warnings = [
    'Каждый физический модуль ориентирован ножками вниз: три горизонтальных ребра принадлежат его верхней грани. Отдельного искусственного closeTopRing нет.',
    'Статическое состояние дополнительно решается точной помодульной Schur-конденсацией; верхний стек передаёт на нижний модуль полный 18-DOF эффект сил, моментов, поворотов и жёсткости.',
    'Global eigen-buckling остаётся задачей всей связанной мачты; помодульная статическая схема не заменяет глобальную собственную задачу устойчивости.',
    'Глобальный каркас идеализирован абсолютно жёсткими общими узлами. Реальные болт, гайки и сварка проверяются post-processing слоем, их податливость пока не возвращается в K.',
    'Межмодульный стык моделируется как проходная гайка ножки с двумя приваренными рёбрами, длинная соединительная гайка верхнего узла с четырьмя рёбрами и один вертикальный болт. Эффективный радиус выводится из размера длинной гайки под ключ.',
    'Проверка болта использует расчётные сопротивления и площади СП 16. Срыв внутренней/наружной резьбы по фактическому материалу гайки, смятие, prying, затяжка и проскальзывание пока не рассчитаны.',
    'Длина резьбового зацепления является правилом компоновки; фактические поля допуска, покрытие и размеры приобретённых гаек должны быть подтверждены по каталогу поставщика и изделию.',
    'Минимальная длина сварки считается по совпадающему N/V/T/M каждого конца ребра и идеализированной круговой группе угловых швов. Реальная геометрия шва должна подтвердить βf, βz, катет и эффективный радиус.',
    'Погодные пресеты по шкале Бофорта — сценарии сравнения, а не нормативное ветровое районирование, пульсация или порыв по СП 20.',
    'Расчёт максимальной высоты является дискретным поиском при текущих нагрузках, материале и уже выбранном физическом соединительном узле.',
    'Расчёт статической массы на вершине учитывает собственный вес и выбранный физический болтовой узел, но сознательно исключает ветер и лёд.',
    'Паспорт верификации подтверждает внутренние формулы и численные cross-checks, но не заменяет независимый КЭ-комплекс, инженерную рецензию и натурное испытание.',
    'Геометрическая нелинейность, начальные несовершенства, пластичность, усталость и реальный фундамент пока не реализованы.',
  ]
  if (governing.analysis.diagnostics.relativeResidual > 1e-8) {
    warnings.unshift('Численная невязка превышает 1e-8: результат требует проверки.')
  }
  if (governing.analysis.diagnostics.maximumNodeEquilibriumResidual > 1e-8) {
    warnings.unshift('Локальная невязка свободных степеней свободы превышает 1e-8.')
  }
  if ((governing.analysis.modular?.relativeDisplacementDifference ?? 0) > 1e-8) {
    warnings.unshift('Помодульное и глобальное статические решения расходятся больше чем на 1e-8.')
  }
  if ((governing.analysis.modular?.interfaceEquilibriumResidual ?? 0) > 1e-8) {
    warnings.unshift('Баланс сил/моментов между соседними модулями превышает допуск 1e-8.')
  }
  if (governing.analysis.diagnostics.minPivotRatio < 1e-10) {
    warnings.unshift('Матрица жёсткости плохо обусловлена: конструкция близка к механизму или имеет большой разброс жёсткостей.')
  }
  if (buckling.analysis.buckling.residual > 1e-6) {
    warnings.unshift('Собственная форма общей потери устойчивости найдена с повышенной численной невязкой.')
  }
  return warnings
}

function analysisDofVector(analysis: CheckedAnalysis): number[] {
  return analysis.displacements.flatMap((displacement, nodeId) => [
    ...displacement,
    ...(analysis.rotations?.[nodeId] ?? [0, 0, 0]),
  ])
}

function moduleRuptureUtilization(
  model: MastModel,
  analysis: CheckedAnalysis,
  memberId: number,
  materialSafetyFactor: number,
) {
  const member = model.members[memberId]
  const result = analysis.memberResults[memberId]
  if (!member || !result) throw new Error(`Не найдено ребро ${memberId} для проверки разрыва модуля`)
  const areaM2 = Math.PI * member.diameterM ** 2 / 4
  const designUltimatePa = member.tensileStrengthPa / materialSafetyFactor
  const capacityN = designUltimatePa * areaM2
  return {
    utilization: result.maxTensionN / Math.max(capacityN, Number.EPSILON),
    capacityN,
  }
}

function enrichModuleStates(
  model: MastModel,
  analysis: CheckedAnalysis,
  modular: SolvedModuleStack,
  parameters: ResolvedProject,
): EnrichedModuleState[] {
  return modular.modules.map((state) => {
    const memberResults = state.memberIds.map((memberId) => analysis.memberResults[memberId]).filter((item): item is MemberResult => item != null)
    const critical = maxBy(memberResults, (item) => item.utilization)
    const legIds = state.memberIds.filter((memberId) => model.members[memberId]?.role === 'leg')
    const verticalCandidates = legIds.map((memberId) => {
      const result = analysis.memberResults[memberId]
      if (!result) throw new Error(`Не найден результат ребра ${memberId} для vertical envelope`)
      const rupture = moduleRuptureUtilization(model, analysis, memberId, parameters.materialSafetyFactor)
      return {
        memberId,
        bucklingUtilization: result.bucklingUtilization,
        ruptureUtilization: rupture.utilization,
        ruptureCapacityN: rupture.capacityN,
        maxCompressionN: Math.abs(Math.min(0, result.maxCompressionN)),
        maxTensionN: result.maxTensionN,
      }
    })
    const buckling = maxBy(verticalCandidates, (item) => item.bucklingUtilization)
    const rupture = maxBy(verticalCandidates, (item) => item.ruptureUtilization)
    const verticalFailureMode: EnrichedModuleState['verticalFailureMode'] = buckling.bucklingUtilization >= rupture.ruptureUtilization
      ? 'local-member-buckling'
      : 'tensile-rupture'
    const verticalGoverning = verticalFailureMode === 'local-member-buckling' ? buckling : rupture
    const verticalUtilization = Math.max(buckling.bucklingUtilization, rupture.ruptureUtilization)
    return {
      ...state,
      criticalMemberId: critical.memberId,
      maxUtilization: critical.utilization,
      maxStressUtilization: Math.max(...memberResults.map((item) => item.stressUtilization)),
      maxBucklingUtilization: buckling.bucklingUtilization,
      maxRuptureUtilization: rupture.ruptureUtilization,
      verticalFailureMode,
      verticalFailureMemberId: verticalGoverning.memberId,
      verticalFailureUtilization: verticalUtilization,
      verticalFailureLoadFactor: verticalUtilization > Number.EPSILON ? 1 / verticalUtilization : Number.POSITIVE_INFINITY,
    }
  })
}

function withModularAnalysis(
  model: MastModel,
  frameSystem: FrameSystem,
  moduleStack: ModuleStack,
  analysis: CheckedAnalysis,
  loads: BuiltLoadCase,
  parameters: ResolvedProject,
): AnalysisWithModular {
  if (!moduleStack) return analysis
  const solved = solveModuleStack(model, moduleStack, loads)
  const globalVector = analysisDofVector(analysis)
  const difference = solved.displacementVector.map((value, index) => value - (globalVector[index] ?? 0))
  const modules = enrichModuleStates(model, analysis, solved, parameters)
  const modular: ModularAnalysis = {
    ...solved,
    relativeDisplacementDifference: vectorNorm(difference) / Math.max(1e-12, vectorNorm(globalVector)),
    modules,
    interfaceFactorizationCount: moduleStack.interfaceFactorizationCount,
    referenceSolver: frameSystem.method,
  }
  return { ...analysis, modular, moduleResults: modules }
}

function calculateOperationalCases(
  parameters: ResolvedProject,
  model: MastModel,
  frameSystem: FrameSystem,
  moduleStack: ModuleStack,
  directions: readonly number[],
  onCaseProgress?: (event: CaseProgress) => void,
): OperationalCase[] {
  const cases: OperationalCase[] = []
  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index]
    if (direction === undefined) continue
    const caseParameters: ResolvedProject = { ...parameters, windDirectionDeg: direction }
    const loads = buildLoadCase(model, caseParameters)
    const rawAnalysis = analyzeCheckedFrame(model, loads, caseParameters, frameSystem)
    const analysis = withModularAnalysis(model, frameSystem, moduleStack, rawAnalysis, loads, caseParameters)
    cases.push({ windDirectionDeg: direction, loads, analysis })
    onCaseProgress?.({ completed: index + 1, total: directions.length, directionDeg: direction })
  }
  return cases
}

function buildMastResult(
  parameters: ResolvedProject,
  model: MastModel,
  cases: readonly OperationalCase[],
) {
  const strength = maxBy(cases, (item) => item.analysis.maxUtilization)
  const displacement = maxBy(cases, (item) => item.analysis.maxTopDisplacementM)
  const buckling = minBy(cases, (item) => item.analysis.buckling.criticalLoadFactor)
  const score = (item: OperationalCase): number => Math.max(
    item.analysis.maxUtilization,
    item.analysis.maxTopDisplacementM * 1000 / Math.max(parameters.displacementLimitMm, Number.EPSILON),
    Number.isFinite(item.analysis.buckling.criticalLoadFactor)
      ? parameters.minimumBucklingFactor / Math.max(item.analysis.buckling.criticalLoadFactor, Number.EPSILON)
      : 0,
  )
  const governing = maxBy(cases, score)
  return {
    parameters,
    method: CALCULATION_METHOD,
    model,
    cases,
    loads: governing.loads,
    analysis: governing.analysis,
    envelope: {
      strength,
      displacement,
      buckling,
      governing,
      caseCount: cases.length,
      maxUtilization: strength.analysis.maxUtilization,
      maxTopDisplacementM: displacement.analysis.maxTopDisplacementM,
      minimumBucklingFactor: buckling.analysis.buckling.criticalLoadFactor,
    },
    warnings: createWarnings(parameters, governing, buckling),
  }
}

function prepareMastCalculation(parameters: ResolvedProject, options: CalculateMastOptions = {}) {
  const model = options.model ?? generateMastModel(parameters)
  const frameSystem = options.frameSystem ?? compileFrameSystem(model, parameters)
  const moduleStack = options.moduleStack ?? compileModuleStack(model, frameSystem.memberGeometry)
  return { model, frameSystem, moduleStack }
}

export function calculateMast(
  inputParameters: Record<string, unknown>,
  options: CalculateMastOptions = {},
) {
  const parameters = options.resolvedProject ?? resolveCalculationParameters(inputParameters)
  const directions = windDirections(parameters)
  options.onProgress?.({ phase: 'compile', label: 'Сборка глобальной и помодульной систем жёсткости', completed: 0, total: directions.length + 1 })
  const { model, frameSystem, moduleStack } = prepareMastCalculation(parameters, options)
  options.onProgress?.({ phase: 'compile', label: 'Глобальная и модульная системы подготовлены', completed: 1, total: directions.length + 1 })
  const cases = calculateOperationalCases(parameters, model, frameSystem, moduleStack, directions, (event) => {
    options.onProgress?.({
      phase: 'wind',
      label: `Ветровая огибающая: ${event.completed}/${event.total}, направление ${event.directionDeg.toFixed(0)}°`,
      completed: 1 + event.completed,
      total: directions.length + 1,
    })
  })
  const result = buildMastResult(parameters, model, cases)
  const connections = calculateConnectionChecks(result)
  return { ...result, connections }
}

type CalculatedMast = ReturnType<typeof calculateMast>

type CriterionMode =
  | 'member'
  | 'global-buckling'
  | 'bolt-connection'
  | 'serviceability-displacement'
  | 'local-member-buckling'
  | 'material-strength'

interface CriterionRatio {
  mode: CriterionMode
  value: number
}

function criterionRatios(result: CalculatedMast, parameters: ResolvedProject, design: boolean) {
  const lambda = result.envelope.minimumBucklingFactor
  const bolt = result.connections?.bolt?.selected
  const invalidJointGeometry = Boolean(bolt?.applicable && result.connections?.passesJointGeometry === false)
  const ratios: CriterionRatio[] = [
    { mode: 'member', value: result.envelope.maxUtilization },
    {
      mode: 'global-buckling',
      value: Number.isFinite(lambda)
        ? (design ? parameters.minimumBucklingFactor : 1) / Math.max(lambda, Number.EPSILON)
        : 0,
    },
    {
      mode: 'bolt-connection',
      value: invalidJointGeometry
        ? Number.POSITIVE_INFINITY
        : (bolt?.applicable ? bolt.utilization : 0),
    },
  ]
  if (design) {
    ratios.push({
      mode: 'serviceability-displacement',
      value: result.envelope.maxTopDisplacementM * 1000 / Math.max(parameters.displacementLimitMm, Number.EPSILON),
    })
  }
  const governing = { ...maxBy(ratios, (item) => item.value) }
  if (governing.mode === 'member') {
    const strength = result.envelope.strength.analysis
    const memberId = strength.criticalMemberId
    const member = memberId == null ? undefined : strength.memberResults[memberId]
    if (!member) throw new Error('Не найдено определяющее ребро для критерия прочности')
    governing.mode = member.bucklingUtilization >= member.stressUtilization
      ? 'local-member-buckling'
      : 'material-strength'
  }
  return { ratios, governing, passes: governing.value <= 1 + PASS_TOLERANCE }
}

interface BottomModuleCandidate {
  windDirectionDeg: number
  module: EnrichedModuleState
}

function bottomModuleVerticalEnvelope(result: CalculatedMast) {
  const candidates = result.cases.flatMap((loadCase): BottomModuleCandidate[] => {
    const module = loadCase.analysis.moduleResults?.[0]
    return module ? [{ windDirectionDeg: loadCase.windDirectionDeg, module }] : []
  })
  if (candidates.length === 0) return null
  const buckling = maxBy(candidates, (item) => item.module.maxBucklingUtilization)
  const rupture = maxBy(candidates, (item) => item.module.maxRuptureUtilization)
  const mode: 'local-member-buckling' | 'tensile-rupture' = buckling.module.maxBucklingUtilization >= rupture.module.maxRuptureUtilization
    ? 'local-member-buckling'
    : 'tensile-rupture'
  const governing = mode === 'local-member-buckling' ? buckling : rupture
  const utilization = mode === 'local-member-buckling'
    ? governing.module.maxBucklingUtilization
    : governing.module.maxRuptureUtilization
  return {
    mode,
    utilization,
    reserveFactor: utilization > Number.EPSILON ? 1 / utilization : Number.POSITIVE_INFINITY,
    windDirectionDeg: governing.windDirectionDeg,
    memberId: governing.module.verticalFailureMemberId,
    maxBucklingUtilization: buckling.module.maxBucklingUtilization,
    maxRuptureUtilization: rupture.module.maxRuptureUtilization,
    explanation: mode === 'local-member-buckling'
      ? 'Среди двух заданных вертикальных предельных механизмов нижнего модуля раньше достигается локальная потеря устойчивости сжатой ножки.'
      : 'Среди двух заданных вертикальных предельных механизмов нижнего модуля раньше достигается растягивающий разрыв ножки по Rm/γM.',
  }
}

function compactHeightCase(moduleCount: number, result: CalculatedMast, parameters: ResolvedProject) {
  const design = criterionRatios(result, parameters, true)
  const ultimate = criterionRatios(result, parameters, false)
  return {
    moduleCount,
    heightM: moduleCount * parameters.moduleHeightMm / 1000,
    designPasses: design.passes,
    designScore: design.governing.value,
    designMode: design.governing.mode,
    ultimatePasses: ultimate.passes,
    ultimateScore: ultimate.governing.value,
    ultimateMode: ultimate.governing.mode,
    memberUtilization: result.envelope.maxUtilization,
    topDisplacementMm: result.envelope.maxTopDisplacementM * 1000,
    bucklingFactor: result.envelope.minimumBucklingFactor,
    boltUtilization: result.connections?.bolt?.selected?.applicable
      ? result.connections.bolt.selected.utilization
      : 0,
    bottomModule: bottomModuleVerticalEnvelope(result),
  }
}

type CompactHeightCase = ReturnType<typeof compactHeightCase>

interface HeightBoundary {
  bounded: boolean
  maximumModules: number
  firstFailModules: number | null
}

function searchHeightBoundary(
  evaluate: (moduleCount: number) => CompactHeightCase,
  maxModules: number,
  selector: (item: CompactHeightCase) => boolean,
): HeightBoundary {
  const first = evaluate(1)
  if (!selector(first)) return { bounded: true, maximumModules: 0, firstFailModules: 1 }

  let low = 1
  let high = 2
  while (high <= maxModules && selector(evaluate(high))) {
    low = high
    high *= 2
  }
  if (high > maxModules) {
    if (selector(evaluate(maxModules))) {
      return { bounded: false, maximumModules: maxModules, firstFailModules: null }
    }
    high = maxModules
  }

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (selector(evaluate(middle))) low = middle
    else high = middle
  }

  let maximumModules = low
  const start = Math.max(1, low - HEIGHT_SEARCH_NEIGHBOURHOOD)
  const end = Math.min(maxModules, high + HEIGHT_SEARCH_NEIGHBOURHOOD)
  for (let count = start; count <= end; count += 1) {
    if (selector(evaluate(count))) maximumModules = Math.max(maximumModules, count)
  }
  const firstFailModules = maximumModules < maxModules ? maximumModules + 1 : null
  return { bounded: firstFailModules != null, maximumModules, firstFailModules }
}

export function calculateMaximumHeight(
  inputParameters: Record<string, unknown>,
  options: CalculateMaximumHeightOptions = {},
) {
  const parameters = options.resolvedProject ?? resolveCalculationParameters(inputParameters)
  const maxModules = parameters.heightSearchMaxModules
  const cache = new Map<number, CompactHeightCase>()
  let evaluationCount = 0

  const evaluate = (moduleCount: number): CompactHeightCase => {
    const cached = cache.get(moduleCount)
    if (cached) return cached
    let result: CalculatedMast
    if (options.knownResult && options.knownResult.parameters?.moduleCount === moduleCount) {
      result = options.knownResult
    } else {
      const trialParameters: ResolvedProject = { ...parameters, moduleCount }
      result = calculateMast(trialParameters as unknown as Record<string, unknown>, { resolvedProject: trialParameters })
    }
    const compact = compactHeightCase(moduleCount, result, parameters)
    cache.set(moduleCount, compact)
    evaluationCount += 1
    options.onProgress?.({
      completed: Math.min(HEIGHT_SEARCH_PROGRESS_STEPS, evaluationCount),
      total: HEIGHT_SEARCH_PROGRESS_STEPS,
      moduleCount,
      label: `Поиск предельной высоты: проверено ${moduleCount} модулей (${compact.heightM.toFixed(2)} м)`,
    })
    return compact
  }

  const designBoundary = searchHeightBoundary(evaluate, maxModules, (item) => item.designPasses)
  const ultimateBoundary = searchHeightBoundary(evaluate, maxModules, (item) => item.ultimatePasses)
  const designLimit = designBoundary.maximumModules > 0 ? evaluate(designBoundary.maximumModules) : null
  const designFirstFail = designBoundary.firstFailModules ? evaluate(designBoundary.firstFailModules) : null
  const ultimateLimit = ultimateBoundary.maximumModules > 0 ? evaluate(ultimateBoundary.maximumModules) : null
  const ultimateFirstFail = ultimateBoundary.firstFailModules ? evaluate(ultimateBoundary.firstFailModules) : null

  options.onProgress?.({
    completed: HEIGHT_SEARCH_PROGRESS_STEPS,
    total: HEIGHT_SEARCH_PROGRESS_STEPS,
    moduleCount: designBoundary.maximumModules,
    label: 'Поиск предельной высоты завершён',
  })

  return {
    method: 'integer-module-height-search-v1' as const,
    searchLimitModules: maxModules,
    evaluationCount,
    moduleHeightM: parameters.moduleHeightMm / 1000,
    design: {
      ...designBoundary,
      maximumHeightM: designBoundary.maximumModules * parameters.moduleHeightMm / 1000,
      limitCase: designLimit,
      firstFailCase: designFirstFail,
      criteria: `Umember≤1; Ubolt≤1; λcr≥${parameters.minimumBucklingFactor}; δtop≤${parameters.displacementLimitMm} мм`,
    },
    ultimateResistance: {
      ...ultimateBoundary,
      maximumHeightM: ultimateBoundary.maximumModules * parameters.moduleHeightMm / 1000,
      limitCase: ultimateLimit,
      firstFailCase: ultimateFirstFail,
      criteria: 'Umember≤1; Ubolt≤1; λcr≥1; без ограничения эксплуатационного прогиба',
    },
    bottomModuleAtDesignLimit: designLimit?.bottomModule ?? null,
    bottomModuleAtFirstDesignOverload: designFirstFail?.bottomModule ?? null,
    evaluatedCases: [...cache.values()].sort((left, right) => left.moduleCount - right.moduleCount),
  }
}

function fixedPhysicalJointParameters(parameters: ResolvedProject, connections: ConnectionChecks) {
  const requestedMode: ResolvedProject['jointConfiguratorMode'] = parameters.jointConfiguratorMode === 'manual' ? 'manual' : 'auto'
  const fixed: ResolvedProject = {
    ...parameters,
    ...connections.resolvedParameters,
    jointConfiguratorMode: 'manual',
  }
  return { requestedMode, fixed }
}

export function calculateCompleteMast(
  inputParameters: Record<string, unknown>,
  options: CalculateCompleteMastOptions = {},
) {
  const parameters = options.resolvedProject ?? resolveCalculationParameters(inputParameters)
  const model = generateMastModel(parameters)
  const directions = windDirections(parameters)
  const lateral = lateralDirections(parameters.lateralCapacityStepDeg)
  const total = 1 + directions.length + lateral.length + STATIC_PAYLOAD_PROGRESS_STEPS + HEIGHT_SEARCH_PROGRESS_STEPS

  options.onProgress?.({
    phase: 'compile',
    label: `Подготовка ${parameters.moduleCount} модулей: глобальная и помодульная системы`,
    completed: 0,
    total,
  })
  const frameSystem = compileFrameSystem(model, parameters)
  const moduleStack = compileModuleStack(model, frameSystem.memberGeometry)
  options.onProgress?.({
    phase: 'compile',
    label: `Готово: ${frameSystem.freeDofs.length} свободных DOF; ${moduleStack?.interfaceFactorizationCount ?? 0} модульных интерфейсов`,
    completed: 1,
    total,
  })

  const cases = calculateOperationalCases(parameters, model, frameSystem, moduleStack, directions, (event) => {
    options.onProgress?.({
      phase: 'wind',
      label: `Ветровая огибающая: ${event.completed}/${event.total}, направление ${event.directionDeg.toFixed(0)}°`,
      completed: 1 + event.completed,
      total,
    })
  })
  const baseResult = buildMastResult(parameters, model, cases)
  const selectedConnections = calculateConnectionChecks(baseResult)
  const { requestedMode, fixed } = fixedPhysicalJointParameters(parameters, selectedConnections)
  const finalParameters: ResolvedProject = { ...fixed, jointConfiguratorMode: requestedMode }
  const connections = {
    ...selectedConnections,
    requestedMode,
    capacityChecksUseFixedSelectedJoint: true,
  }
  const configuredResult = {
    ...baseResult,
    parameters: finalParameters,
    connections,
  }

  const lateralOffset = 1 + directions.length
  const lateralCapacity = calculateLateralCapacity(model, fixed, {
    frameSystem,
    onProgress: (event) => options.onProgress?.({
      phase: 'lateral',
      label: `Боковая нагрузка: ${event.completed}/${event.total}, направление ${event.directionDeg.toFixed(0)}°`,
      completed: lateralOffset + event.completed,
      total,
    }),
  })

  const staticPayloadOffset = lateralOffset + lateral.length
  const staticPayloadCapacity = calculateStaticPayloadCapacity(model, fixed, {
    frameSystem,
    onProgress: (event) => options.onProgress?.({
      phase: 'static-payload',
      label: event.label,
      completed: staticPayloadOffset + event.completed,
      total,
    }),
  })

  const heightOffset = staticPayloadOffset + STATIC_PAYLOAD_PROGRESS_STEPS
  const rawHeightCapacity = calculateMaximumHeight(fixed as unknown as Record<string, unknown>, {
    resolvedProject: fixed,
    knownResult: configuredResult,
    onProgress: (event) => options.onProgress?.({
      phase: 'height-capacity',
      label: event.label,
      completed: heightOffset + event.completed,
      total,
    }),
  })
  const heightCapacity = {
    ...rawHeightCapacity,
    fixedJointConfiguration: {
      diameterMm: fixed.jointBoltDiameterMm,
      boltClass: fixed.jointBoltClass,
      boltLengthMm: fixed.jointBoltLengthMm,
      clearanceNutThreadMm: fixed.jointClearanceNutThreadMm,
      threadEngagementFactor: fixed.jointThreadEngagementFactor,
    },
  }

  const resultBeforeVerification = {
    ...configuredResult,
    lateralCapacity,
    staticPayloadCapacity,
    heightCapacity,
  }
  const verification = buildVerificationPassport(resultBeforeVerification)
  const performance = {
    linearSystemSolver: frameSystem.method,
    modularStaticSolver: moduleStack?.method ?? null,
    modularInterfaceFactorizationCount: moduleStack?.interfaceFactorizationCount ?? 0,
    modularRelativeDisplacementDifference: configuredResult.analysis.modular?.relativeDisplacementDifference ?? null,
    modularInterfaceEquilibriumResidual: configuredResult.analysis.modular?.interfaceEquilibriumResidual ?? null,
    freeDofCount: frameSystem.freeDofs.length,
    stiffnessBandwidth: frameSystem.bandwidth,
    stiffnessFactorizationCount: frameSystem.factorizationCount,
    operationalCaseCount: directions.length,
    lateralCaseCount: lateral.length,
    staticPayloadEvaluationCount: STATIC_PAYLOAD_PROGRESS_STEPS,
    heightSearchEvaluationCount: heightCapacity.evaluationCount,
    verificationInternalCheckCount: verification.counts.internal,
    rotationalSymmetryDeg: ROTATIONAL_SYMMETRY_DEG,
    jointConfiguratorMode: requestedMode,
  }
  options.onProgress?.({
    phase: 'done',
    label: 'Расчёт, конфигурация физического узла, предельные проверки и верификация завершены',
    completed: total,
    total,
  })
  return {
    ...resultBeforeVerification,
    verification,
    performance,
  }
}
