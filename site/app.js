import { calculateMast, DEFAULT_PARAMETERS } from './engine/calculate.js'
import { selectUniformDiameter } from './engine/optimize.js'
import { MastViewer } from './viewer.js'

const form = document.querySelector('#parameters-form')
const calculateButton = document.querySelector('#calculate-button')
const optimizeButton = document.querySelector('#optimize-button')
const errorBox = document.querySelector('#error')
const resultsSection = document.querySelector('#results')
const warningsList = document.querySelector('#warnings')
const optimizationBox = document.querySelector('#optimization-result')
const viewer = new MastViewer(document.querySelector('#mast-canvas'))

const fieldNames = [
  'moduleCount', 'triangleSideMm', 'moduleHeightMm', 'barDiameterMm',
  'youngModulusGPa', 'yieldStrengthMPa', 'densityKgM3', 'effectiveLengthFactor',
  'materialSafetyFactor', 'deadLoadFactor', 'windLoadFactor', 'equipmentLoadFactor',
  'windPressurePa', 'dragCoefficient', 'windDirectionDeg', 'equipmentMassKg',
  'equipmentWindAreaM2', 'equipmentDragCoefficient', 'extraHorizontalLoadN',
  'extraVerticalLoadN', 'displacementLimitMm',
]

for (const name of fieldNames) {
  const input = form.elements.namedItem(name)
  if (input) input.value = DEFAULT_PARAMETERS[name]
}
form.elements.namedItem('closeTopRing').checked = DEFAULT_PARAMETERS.closeTopRing

const format = (value, digits = 2) => new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}).format(value)

function readParameters() {
  const parameters = { ...DEFAULT_PARAMETERS }
  for (const name of fieldNames) {
    const element = form.elements.namedItem(name)
    const value = Number(element.value)
    if (!Number.isFinite(value)) throw new Error(`Поле «${element.labels?.[0]?.textContent ?? name}» заполнено неверно`)
    parameters[name] = value
  }
  parameters.moduleCount = Math.floor(parameters.moduleCount)
  parameters.closeTopRing = form.elements.namedItem('closeTopRing').checked
  return parameters
}

function renderResult(result, parameters) {
  viewer.setResult(result)
  resultsSection.hidden = false
  const critical = result.analysis.memberResults[result.analysis.criticalMemberId]
  const topDisplacementMm = result.analysis.maxTopDisplacementM * 1000

  document.querySelector('#metric-height').textContent = `${format(parameters.moduleCount * parameters.moduleHeightMm / 1000)} м`
  document.querySelector('#metric-mass').textContent = `${format(result.analysis.totalMassKg, 1)} кг`
  document.querySelector('#metric-displacement').textContent = `${format(topDisplacementMm, 2)} мм`
  document.querySelector('#metric-utilization').textContent = format(result.analysis.maxUtilization, 3)
  document.querySelector('#metric-critical').textContent = `№ ${result.analysis.criticalMemberId}`
  document.querySelector('#metric-residual').textContent = result.analysis.diagnostics.relativeResidual.toExponential(2)
  document.querySelector('#metric-displacement').classList.toggle('danger', topDisplacementMm > parameters.displacementLimitMm)
  document.querySelector('#metric-utilization').classList.toggle('danger', result.analysis.maxUtilization > 1)

  document.querySelector('#critical-description').textContent = critical
    ? `Стержень № ${critical.memberId}; ${critical.mode === 'compression' ? 'сжатие' : 'растяжение'}; усилие ${format(critical.axialForceN / 1000)} кН; расчётная несущая способность ${format(critical.designCapacityN / 1000)} кН.`
    : 'Критический стержень не определён.'

  warningsList.replaceChildren(...result.warnings.map((warning) => {
    const item = document.createElement('li')
    item.textContent = warning
    return item
  }))
}

function runCalculation() {
  errorBox.hidden = true
  optimizationBox.hidden = true
  try {
    const parameters = readParameters()
    const result = calculateMast(parameters)
    renderResult(result, parameters)
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  }
}

function runOptimization() {
  errorBox.hidden = true
  try {
    const parameters = readParameters()
    const optimization = selectUniformDiameter(parameters)
    const recommended = optimization.recommended
    optimizationBox.hidden = false

    if (!recommended) {
      optimizationBox.textContent = 'В диапазоне стандартных диаметров не найден вариант, одновременно проходящий по прочности и отклонению.'
      return
    }

    form.elements.namedItem('barDiameterMm').value = recommended.diameter
    renderResult(recommended.result, { ...parameters, barDiameterMm: recommended.diameter })
    optimizationBox.textContent = `Минимальный найденный единый диаметр: ${recommended.diameter} мм. Использование ${format(recommended.result.analysis.maxUtilization, 3)}, отклонение вершины ${format(recommended.result.analysis.maxTopDisplacementM * 1000, 2)} мм.`
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  }
}

calculateButton.addEventListener('click', runCalculation)
optimizeButton.addEventListener('click', runOptimization)
form.addEventListener('submit', (event) => {
  event.preventDefault()
  runCalculation()
})

runCalculation()
