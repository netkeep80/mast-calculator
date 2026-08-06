import { generateMastModel } from './geometry.js'
import { buildLoadCase } from './loads.js'
import { analyzeTruss } from './solver.js'

export const DEFAULT_PARAMETERS = Object.freeze({
  moduleCount: 12,
  triangleSideMm: 750,
  moduleHeightMm: 540,
  barDiameterMm: 12,
  youngModulusGPa: 200,
  yieldStrengthMPa: 400,
  densityKgM3: 7850,
  effectiveLengthFactor: 1,
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

export function calculateMast(parameters) {
  const model = generateMastModel(parameters)
  const cases = windDirections(parameters).map((direction) => {
    const caseParameters = { ...parameters, windDirectionDeg: direction }
    const loads = buildLoadCase(model, caseParameters)
    const analysis = analyzeTruss(model, loads, caseParameters)
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
    'Расчёт использует идеальную шарнирно-стержневую 3D-модель. Изгибная жёсткость сварных и болтовых узлов пока не учитывается.',
    'Локальная устойчивость стержней проверяется по упругой формуле Эйлера с ограничением по текучести; это ещё не нормативная проверка по СП 16.',
    'Общая устойчивость вычисляется линейным собственным расчётом по геометрической матрице жёсткости. Геометрическая нелинейность и начальные несовершенства пока не учтены.',
    'Проверки болтов, резьбы, гаек, сварных швов, фундамента и усталости ещё не реализованы.',
    'Топология модуля принята как горизонтальный треугольник и шесть диагоналей к уровню, повёрнутому на 60°.',
  ]

  if (governing.analysis.diagnostics.relativeResidual > 1e-8) {
    warnings.unshift('Численная невязка превышает 1e-8: результат требует проверки.')
  }
  if (governing.analysis.diagnostics.maximumNodeEquilibriumResidual > 1e-8) {
    warnings.unshift('Локальная невязка равновесия узлов превышает 1e-8.')
  }
  if (governing.analysis.diagnostics.minPivotRatio < 1e-10) {
    warnings.unshift('Матрица жёсткости плохо обусловлена: конструкция близка к механизму или имеет большой разброс жёсткостей.')
  }
  if (buckling.analysis.buckling.residual > 1e-6) {
    warnings.unshift('Собственная форма общей потери устойчивости найдена с повышенной численной невязкой.')
  }

  return {
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
