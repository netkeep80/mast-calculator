import { DEFAULT_PARAMETERS, resolveCalculationParameters } from '../../domain/index.js'
import { analyzeCheckedFrame, calculateConnectionChecks } from '../../engineering/index.js'
import {
  calculateLateralCapacity,
  lateralDirections,
} from '../../engineering/index.js'
import { generateMastModel } from '../../structural-analysis/index.js'
import { buildLoadCase } from '../../structural-analysis/index.js'
import { compileModuleStack, solveModuleStack } from '../../structural-analysis/index.js'
import { compileFrameSystem } from '../../structural-analysis/index.js'
import {
  calculateStaticPayloadCapacity,
  STATIC_PAYLOAD_PROGRESS_STEPS,
} from '../../engineering/index.js'
import { buildVerificationPassport } from '../../engineering/index.js'

const ROTATIONAL_SYMMETRY_DEG = 120
export const HEIGHT_SEARCH_PROGRESS_STEPS = 32
const HEIGHT_SEARCH_NEIGHBOURHOOD = 4
const PASS_TOLERANCE = 1e-9

export const CALCULATION_METHOD = Object.freeze({
  id: 'linear-frame-v1.1',
  description: 'Линейная пространственная Euler-Bernoulli frame-модель; статическое состояние дополнительно решается точной помодульной Schur-конденсацией сверху вниз, global eigen-buckling сохраняет полную связанную модель; физический узел из двух гаек и болта проверяется отдельным connection-layer.',
})

const canonicalSymmetryAngle = (angle) => {
  const value = ((angle % ROTATIONAL_SYMMETRY_DEG) + ROTATIONAL_SYMMETRY_DEG) % ROTATIONAL_SYMMETRY_DEG
  return Math.abs(value - ROTATIONAL_SYMMETRY_DEG) < 1e-9 ? 0 : value
}

export function windDirections(parameters) {
  if (!parameters.windEnvelopeEnabled) return [parameters.windDirectionDeg]
  const step = Number(parameters.windEnvelopeStepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 180) {
    throw new Error('Шаг перебора направлений ветра должен быть от 0 до 180°')
  }

  const unique = new Map()
  for (let angle = 0; angle < 360 - step / 1000; angle += step) {
    const canonical = canonicalSymmetryAngle(angle)
    const key = Math.round(canonical * 1e9)
    if (!unique.has(key)) unique.set(key, canonical)
  }
  return [...unique.values()].sort((left, right) => left - right)
}

const maxBy = (items, selector) => items.reduce((best, item) => selector(item) > selector(best) ? item : best, items[0])
const minBy = (items, selector) => items.reduce((best, item) => selector(item) < selector(best) ? item : best, items[0])
const vectorNorm = (vector) => Math.hypot(...vector)

function createWarnings(parameters, governing, buckling) {
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
  if (governing.analysis.modular?.relativeDisplacementDifference > 1e-8) {
    warnings.unshift('Помодульное и глобальное статические решения расходятся больше чем на 1e-8.')
  }
  if (governing.analysis.modular?.interfaceEquilibriumResidual > 1e-8) {
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

function analysisDofVector(analysis) {
  return analysis.displacements.flatMap((displacement, nodeId) => [
    ...displacement,
    ...(analysis.rotations?.[nodeId] ?? [0, 0, 0]),
  ])
}

function moduleRuptureUtilization(model, analysis, memberId, materialSafetyFactor) {
  const member = model.members[memberId]
  const result = analysis.memberResults[memberId]
  const areaM2 = Math.PI * member.diameterM ** 2 / 4
  const designUltimatePa = member.tensileStrengthPa / materialSafetyFactor
  const capacityN = designUltimatePa * areaM2
  return {
    utilization: result.maxTensionN / Math.max(capacityN, Number.EPSILON),
    capacityN,
  }
}

function enrichModuleStates(model, analysis, modular, parameters) {
  return modular.modules.map((state) => {
    const memberResults = state.memberIds.map((memberId) => analysis.memberResults[memberId])
    const critical = maxBy(memberResults, (item) => item.utilization)
    const legIds = state.memberIds.filter((memberId) => model.members[memberId].role === 'leg')
    const verticalCandidates = legIds.map((memberId) => {
      const result = analysis.memberResults[memberId]
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
    const verticalFailureMode = buckling.bucklingUtilization >= rupture.ruptureUtilization
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

function withModularAnalysis(model, frameSystem, moduleStack, analysis, loads, parameters) {
  if (!moduleStack) return analysis
  const solved = solveModuleStack(model, moduleStack, loads)
  const globalVector = analysisDofVector(analysis)
  const difference = solved.displacementVector.map((value, index) => value - globalVector[index])
  const modules = enrichModuleStates(model, analysis, solved, parameters)
  const modular = {
    ...solved,
    relativeDisplacementDifference: vectorNorm(difference) / Math.max(1e-12, vectorNorm(globalVector)),
    modules,
    interfaceFactorizationCount: moduleStack.interfaceFactorizationCount,
    referenceSolver: frameSystem.method,
  }
  return { ...analysis, modular, moduleResults: modules }
}

function calculateOperationalCases(parameters, model, frameSystem, moduleStack, directions, onCaseProgress) {
  const cases = []
  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index]
    const caseParameters = { ...parameters, windDirectionDeg: direction }
    const loads = buildLoadCase(model, caseParameters)
    const rawAnalysis = analyzeCheckedFrame(model, loads, caseParameters, frameSystem)
    const analysis = withModularAnalysis(model, frameSystem, moduleStack, rawAnalysis, loads, caseParameters)
    cases.push({ windDirectionDeg: direction, loads, analysis })
    onCaseProgress?.({ completed: index + 1, total: directions.length, directionDeg: direction })
  }
  return cases
}

function buildMastResult(parameters, model, cases) {
  const strength = maxBy(cases, (item) => item.analysis.maxUtilization)
  const displacement = maxBy(cases, (item) => item.analysis.maxTopDisplacementM)
  const buckling = minBy(cases, (item) => item.analysis.buckling.criticalLoadFactor)
  const score = (item) => Math.max(
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

function prepareMastCalculation(parameters, options = {}) {
  const model = options.model ?? generateMastModel(parameters)
  const frameSystem = options.frameSystem ?? compileFrameSystem(model, parameters)
  const moduleStack = options.moduleStack ?? compileModuleStack(model, frameSystem.memberGeometry)
  return { model, frameSystem, moduleStack }
}

export function calculateMast(inputParameters, options = {}) {
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

function criterionRatios(result, parameters, design) {
  const lambda = result.envelope.minimumBucklingFactor
  const bolt = result.connections?.bolt?.selected
  const invalidJointGeometry = bolt?.applicable && result.connections?.passesJointGeometry === false
  const ratios = [
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
  const governing = maxBy(ratios, (item) => item.value)
  if (governing.mode === 'member') {
    const strength = result.envelope.strength.analysis
    const member = strength.memberResults[strength.criticalMemberId]
    governing.mode = member.bucklingUtilization >= member.stressUtilization
      ? 'local-member-buckling'
      : 'material-strength'
  }
  return { ratios, governing, passes: governing.value <= 1 + PASS_TOLERANCE }
}

function bottomModuleVerticalEnvelope(result, parameters) {
  const candidates = result.cases.map((loadCase) => {
    const module = loadCase.analysis.moduleResults?.[0]
    if (!module) return null
    return {
      windDirectionDeg: loadCase.windDirectionDeg,
      module,
    }
  }).filter(Boolean)
  if (candidates.length === 0) return null
  const buckling = maxBy(candidates, (item) => item.module.maxBucklingUtilization)
  const rupture = maxBy(candidates, (item) => item.module.maxRuptureUtilization)
  const mode = buckling.module.maxBucklingUtilization >= rupture.module.maxRuptureUtilization
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

function compactHeightCase(moduleCount, result, parameters) {
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
    bottomModule: bottomModuleVerticalEnvelope(result, parameters),
  }
}

function searchHeightBoundary(evaluate, maxModules, selector) {
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

  // The stack alternates by 60°. Monotonicity is physically expected for
  // increasing height, but the discrete boundary is still checked locally so
  // a parity-dependent neighbouring module is not missed silently.
  let maximumModules = low
  const start = Math.max(1, low - HEIGHT_SEARCH_NEIGHBOURHOOD)
  const end = Math.min(maxModules, high + HEIGHT_SEARCH_NEIGHBOURHOOD)
  for (let count = start; count <= end; count += 1) {
    if (selector(evaluate(count))) maximumModules = Math.max(maximumModules, count)
  }
  const firstFailModules = maximumModules < maxModules ? maximumModules + 1 : null
  return { bounded: firstFailModules != null, maximumModules, firstFailModules }
}

export function calculateMaximumHeight(inputParameters, options = {}) {
  const parameters = options.resolvedProject ?? resolveCalculationParameters(inputParameters)
  const maxModules = parameters.heightSearchMaxModules
  const cache = new Map()
  let evaluationCount = 0

  const evaluate = (moduleCount) => {
    if (cache.has(moduleCount)) return cache.get(moduleCount)
    let result
    if (options.knownResult && options.knownResult.parameters?.moduleCount === moduleCount) {
      result = options.knownResult
    } else {
      const trialParameters = { ...parameters, moduleCount }
      result = calculateMast(trialParameters, { resolvedProject: trialParameters })
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
    method: 'integer-module-height-search-v1',
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

function fixedPhysicalJointParameters(parameters, connections) {
  const requestedMode = parameters.jointConfiguratorMode === 'manual' ? 'manual' : 'auto'
  const fixed = {
    ...parameters,
    ...(connections?.resolvedParameters ?? {}),
    jointConfiguratorMode: 'manual',
  }
  return { requestedMode, fixed }
}

export function calculateCompleteMast(inputParameters, options = {}) {
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

  // Select physical hardware once from operational demand, then carry the same
  // resolved configuration through every capacity calculation without mutating
  // the base result or changing the requested public mode.
  const selectedConnections = calculateConnectionChecks(baseResult)
  const { requestedMode, fixed } = fixedPhysicalJointParameters(parameters, selectedConnections)
  const finalParameters = { ...fixed, jointConfiguratorMode: requestedMode }
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
  const rawHeightCapacity = calculateMaximumHeight(fixed, {
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
