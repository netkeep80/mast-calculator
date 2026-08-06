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
  equipmentMassKg: 20,
  equipmentWindAreaM2: 0.35,
  equipmentDragCoefficient: 1.4,
  extraHorizontalLoadN: 0,
  extraVerticalLoadN: 0,
  closeTopRing: true,
  displacementLimitMm: 65,
})

export function calculateMast(parameters) {
  const model = generateMastModel(parameters)
  const loads = buildLoadCase(model, parameters)
  const analysis = analyzeTruss(model, loads, parameters)
  const warnings = [
    'Расчёт использует идеальную шарнирно-стержневую 3D-модель. Жёсткость сварных и болтовых узлов пока не учитывается.',
    'Проверка сжатия основана на упругой формуле Эйлера и не заменяет нормативную проверку устойчивости по СП 16.',
    'Проверки болтов, резьбы, сварных швов, фундамента, общей потери устойчивости и усталости ещё не реализованы.',
    'Топология модуля принята как нижний треугольник и шесть диагоналей к уровню, повёрнутому на 60°.',
  ]

  if (analysis.diagnostics.relativeResidual > 1e-8) {
    warnings.unshift('Численная невязка превышает 1e-8: результат требует проверки.')
  }
  if (analysis.diagnostics.minPivotRatio < 1e-10) {
    warnings.unshift('Матрица жёсткости плохо обусловлена: конструкция близка к механизму или имеет большой разброс жёсткостей.')
  }

  return { model, loads, analysis, warnings }
}
