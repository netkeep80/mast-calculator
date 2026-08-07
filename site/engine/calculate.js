import {
  applyReinforcementClass,
  regularOctahedronHeightMm,
  theoreticalCutLengthMm,
} from './catalog.js'
import { generateMastModel } from './geometry.js'
import { buildLoadCase } from './loads.js'
import { analyzeFrame } from './solver.js'

export const CALCULATION_METHOD = Object.freeze({
  id: 'linear-frame-v0.5',
  description: 'Линейная пространственная Euler-Bernoulli frame-модель с 6 степенями свободы на узел и идеальными жёсткими сварными соединениями рёбер.',
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
  // Для отдельной локальной проверки стержня по Эйлеру идеализируем оба
  // конца как жёстко заделанные: μ = 0,5. Системная устойчивость дополнительно
  // проверяется собственным расчётом всей frame-модели.
  effectiveLengthFactor: 0.5,
  materialSafetyFactor: 1.1,
  deadLoadFactor: 1.1,
  windLoadFactor: 1.4,
  equipmentLoadFactor: 1.1,
  windPressurePa: 380,
  dragCoefficient: 1.2,
  windDirectionDeg: 0,
  windEnvelopeEnabled: true,
  windEnvelopeStepDeg: 30,
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
  const ribCutLengthMm = theoreticalCutLengthMm(withMaterial.stockBarLengthMm, withMaterial.stockBarPieces)
  const moduleHeightMm = regularOctahedronHeightMm(ribCutLengthMm)

  return {
    ...withMaterial,
    ribCutLengthMm,
    triangleSideMm: ribCutLengthMm,
    moduleHeightMm,
    // Концы каждого ребра в глобальном расчёте считаются жёстко сваренными.
    effectiveLengthFactor: 0.5,
  }
}

function windDirections(parameters) {
  if (!parameters.windEnvelopeEnabled) return [parameters.windDirectionDeg]
  const step = Number(parameters.windEnvelopeStepDeg)
  if (!Number.isFinite(step) || step <= 0 || step > 180) {
    throw new Error('Шаг перебора направлений ветра должен быть от 0 до 180°')
  }
  const values = []
  for (let angle = 0; angle < 360 - step / 1000; angle += step) values.push(angle)
  return values
}

const maxBy = (items, selector) => items.reduce((best, item) => selector(item) > selector(best) ? item : best, items[0])
const minBy = (items, selector) => items.reduce((best, item) => selector(item) < selector(best) ? item : best, items[0])

export function calculateMast(inputParameters) {
  const parameters = resolveCalculationParameters(inputParameters)
  const model = generateMastModel(parameters)
  const cases = windDirections(parameters).map((direction) => {
    const caseParameters = { ...parameters, windDirectionDeg: direction }
    const loads = buildLoadCase(model, caseParameters)
    const analysis = analyzeFrame(model, loads, caseParameters)
    return { windDirectionDeg: direction, loads, analysis }
  })

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

  const warnings = [
    'Глобальный каркас рассчитан как идеальная 3D frame-модель: сварные пересечения рёбер считаются абсолютно жёсткими и неразрушаемыми. Реальные болты, гайки, резьба и сварные швы должны проверяться отдельным модулем узлов.',
    'Высота модуля вычисляется из геометрии правильного октаэдра h = a·√(2/3). Высота и нахлёст реального соединительного узла пока не учитываются.',
    'Распределённые собственный вес, лёд и ветер вводятся в frame-элементы согласованными узловыми силами и моментами. Для оценки напряжений между узлами дополнительно учитывается консервативная добавка qL²/8 к максимуму изгибающего момента.',
    'Локальная устойчивость отдельного ребра дополнительно проверяется формулой Эйлера с μ = 0,5 (идеально жёсткие концы). Общая устойчивость вычисляется линейным собственным расчётом frame-модели.',
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
    warnings,
  }
}
