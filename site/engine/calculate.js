import {
  applyReinforcementClass,
  regularOctahedronHeightMm,
  theoreticalCutLengthMm,
} from './catalog.js'
import {
  calculateLateralCapacity,
  DEFAULT_LATERAL_CAPACITY_STEP_DEG,
  lateralDirections,
} from './lateral-capacity.js'
import { generateMastModel } from './geometry.js'
import { buildLoadCase } from './loads.js'
import { analyzeFrame, compileFrameSystem } from './solver.js'
import { resolveWindParameters, windSpeedFromPressurePa } from './weather.js'

const ROTATIONAL_SYMMETRY_DEG = 120

export const CALCULATION_METHOD = Object.freeze({
  id: 'linear-frame-v0.7',
  description: 'Линейная пространственная Euler-Bernoulli frame-модель с ленточной SPD-факторизацией, generalized Lanczos для общей устойчивости и отдельной проверкой боковой нагрузки вершины.',
})

export const DEFAULT_PARAMETERS = Object.freeze({
  moduleCount: 12,
  stockBarLengthMm: 12000,
  stockBarPieces: 16,
  ribCutLengthMm: 750,
  triangleSideMm: 750,
  moduleHeightMm: regularOctahedronHeightMm(750),
  reinforcementClass: 'A400C',
  barDiameterMm: 12,
  youngModulusGPa: 200,
  poissonRatio: 0.3,
  yieldStrengthMPa: 390,
  tensileStrengthMPa: 590,
  densityKgM3: 7850,
  reinforcementStandard: 'ГОСТ 34028-2016',
  reinforcementWeldabilityGuaranteed: true,
  effectiveLengthFactor: 0.5,
  materialSafetyFactor: 1.1,
  deadLoadFactor: 1.1,
  windLoadFactor: 1.4,
  equipmentLoadFactor: 1.1,
  windPresetId: 'custom',
  windPressurePa: 380,
  windSpeedMs: windSpeedFromPressurePa(380),
  dragCoefficient: 1.2,
  windDirectionDeg: 0,
  windEnvelopeEnabled: true,
  windEnvelopeStepDeg: 30,
  lateralCapacityStepDeg: DEFAULT_LATERAL_CAPACITY_STEP_DEG,
  equipmentMassKg: 20,
  equipmentWindAreaM2: 0.35,
  equipmentDragCoefficient: 1.4,
  extraHorizontalLoadN: 0,
  extraVerticalLoadN: 0,
  iceThicknessMm: 0,
  iceDensityKgM3: 900,
  closeTopRing: true,
  displacementLimitMm: 65,
  minimumBucklingFactor: 2,
})

export function resolveCalculationParameters(parameters = {}) {
  const merged = { ...DEFAULT_PARAMETERS, ...parameters }
  const withMaterial = applyReinforcementClass(merged)
  const withWind = resolveWindParameters(withMaterial)
  const ribCutLengthMm = theoreticalCutLengthMm(withWind.stockBarLengthMm, withWind.stockBarPieces)
  const moduleHeightMm = regularOctahedronHeightMm(ribCutLengthMm)
  return {
    ...withWind,
    ribCutLengthMm,
    triangleSideMm: ribCutLengthMm,
    moduleHeightMm,
    effectiveLengthFactor: 0.5,
  }
}

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

  // Сначала строим ровно ту же сетку 0..360°, что и раньше, а затем сворачиваем
  // её по точной 120° вращательной симметрии треугольной мачты. Поэтому ни одно
  // уникальное направление исходной сетки не теряется, а эквивалентные solve не повторяются.
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

function createWarnings(parameters, governing, buckling) {
  const warnings = [
    'Глобальный каркас рассчитан как идеальная 3D frame-модель: сварные пересечения рёбер считаются абсолютно жёсткими и неразрушаемыми. Реальные болты, гайки, резьба и сварные швы должны проверяться отдельным модулем узлов.',
    'Высота модуля вычисляется из геометрии правильного октаэдра h = a·√(2/3). Высота и нахлёст реального соединительного узла пока не учитываются.',
    'Погодные пресеты по шкале Бофорта — удобные сценарии для сравнения. Они не заменяют нормативное ветровое районирование, порывы, коэффициенты высоты и требования СП 20.',
    'Ветровая огибающая использует точную 120° вращательную симметрию треугольной расчётной модели: эквивалентные направления полной окружности не решаются повторно.',
    'Матрица упругой жёсткости собирается и факторизуется один раз для всех направлений нагрузки. Решение использует симметричную ленточную Cholesky-факторизацию, а общая устойчивость — matrix-free generalized Lanczos.',
    'Геометрическая нелинейность, начальные несовершенства, пластичность, усталость, фундамент и нормативный расчёт реальных соединений пока не реализованы.',
  ]
  if (governing.analysis.diagnostics.relativeResidual > 1e-8) {
    warnings.unshift('Численная невязка превышает 1e-8: результат требует проверки.')
  }
  if (governing.analysis.diagnostics.maximumNodeEquilibriumResidual > 1e-8) {
    warnings.unshift('Локальная невязка свободных степеней свободы превышает 1e-8.')
  }
  if (governing.analysis.diagnostics.minPivotRatio < 1e-10) {
    warnings.unshift('Матрица жёсткости плохо обусловлена: конструкция близка к механизму или имеет большой разброс жёсткостей.')
  }
  if (buckling.analysis.buckling.residual > 1e-6) {
    warnings.unshift('Собственная форма общей потери устойчивости найдена с повышенной численной невязкой.')
  }
  return warnings
}

function calculateOperationalCases(parameters, model, frameSystem, directions, onCaseProgress) {
  const cases = []
  for (let index = 0; index < directions.length; index += 1) {
    const direction = directions[index]
    const caseParameters = { ...parameters, windDirectionDeg: direction }
    const loads = buildLoadCase(model, caseParameters)
    const analysis = analyzeFrame(model, loads, caseParameters, frameSystem)
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

export function calculateMast(inputParameters, options = {}) {
  const parameters = resolveCalculationParameters(inputParameters)
  const model = options.model ?? generateMastModel(parameters)
  const directions = windDirections(parameters)
  options.onProgress?.({ phase: 'compile', label: 'Сборка и факторизация матрицы жёсткости', completed: 0, total: directions.length + 1 })
  const frameSystem = options.frameSystem ?? compileFrameSystem(model, parameters)
  options.onProgress?.({ phase: 'compile', label: 'Матрица жёсткости факторизована', completed: 1, total: directions.length + 1 })
  const cases = calculateOperationalCases(parameters, model, frameSystem, directions, (event) => {
    options.onProgress?.({
      phase: 'wind',
      label: `Ветровая огибающая: ${event.completed}/${event.total}, направление ${event.directionDeg.toFixed(0)}°`,
      completed: 1 + event.completed,
      total: directions.length + 1,
    })
  })
  return buildMastResult(parameters, model, cases)
}

export function calculateCompleteMast(inputParameters, options = {}) {
  const parameters = resolveCalculationParameters(inputParameters)
  const model = generateMastModel(parameters)
  const directions = windDirections(parameters)
  const lateral = lateralDirections(parameters.lateralCapacityStepDeg)
  const total = 1 + directions.length + lateral.length

  options.onProgress?.({
    phase: 'compile',
    label: `Подготовка ${parameters.moduleCount} модулей и факторизация матрицы`,
    completed: 0,
    total,
  })
  const frameSystem = compileFrameSystem(model, parameters)
  options.onProgress?.({
    phase: 'compile',
    label: `Матрица готова: ${frameSystem.freeDofs.length} свободных DOF, полуширина ${frameSystem.bandwidth}`,
    completed: 1,
    total,
  })

  const cases = calculateOperationalCases(parameters, model, frameSystem, directions, (event) => {
    options.onProgress?.({
      phase: 'wind',
      label: `Ветровая огибающая: ${event.completed}/${event.total}, направление ${event.directionDeg.toFixed(0)}°`,
      completed: 1 + event.completed,
      total,
    })
  })
  const result = buildMastResult(parameters, model, cases)
  const lateralOffset = 1 + directions.length
  result.lateralCapacity = calculateLateralCapacity(model, parameters, {
    frameSystem,
    onProgress: (event) => options.onProgress?.({
      phase: 'lateral',
      label: `Боковая нагрузка: ${event.completed}/${event.total}, направление ${event.directionDeg.toFixed(0)}°`,
      completed: lateralOffset + event.completed,
      total,
    }),
  })
  result.performance = {
    linearSystemSolver: frameSystem.method,
    freeDofCount: frameSystem.freeDofs.length,
    stiffnessBandwidth: frameSystem.bandwidth,
    stiffnessFactorizationCount: frameSystem.factorizationCount,
    operationalCaseCount: directions.length,
    lateralCaseCount: lateral.length,
    rotationalSymmetryDeg: ROTATIONAL_SYMMETRY_DEG,
  }
  options.onProgress?.({ phase: 'done', label: 'Расчёт завершён', completed: total, total })
  return result
}
