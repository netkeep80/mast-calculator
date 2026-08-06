import { calculateMast, DEFAULT_PARAMETERS } from './engine/calculate.js'
import { selectUniformDiameter } from './engine/optimize.js'
import {
  buildMaterialSummary,
  buildMemberEnvelope,
  createCalculationCsv,
  createCalculationJson,
} from './engine/report.js'
import { MastViewer } from './viewer.js'

const form = document.querySelector('#parameters-form')
const calculateButton = document.querySelector('#calculate-button')
const optimizeButton = document.querySelector('#optimize-button')
const exportCsvButton = document.querySelector('#export-csv-button')
const exportJsonButton = document.querySelector('#export-json-button')
const errorBox = document.querySelector('#error')
const resultsSection = document.querySelector('#results')
const warningsList = document.querySelector('#warnings')
const optimizationBox = document.querySelector('#optimization-result')
const showBucklingMode = document.querySelector('#show-buckling-mode')
const memberResultsBody = document.querySelector('#member-results-body')
const materialSummaryBox = document.querySelector('#material-summary')
const viewer = new MastViewer(document.querySelector('#mast-canvas'))

let lastResult = null
let lastParameters = null

const fieldNames = [
  'moduleCount', 'triangleSideMm', 'moduleHeightMm', 'barDiameterMm',
  'youngModulusGPa', 'yieldStrengthMPa', 'densityKgM3', 'effectiveLengthFactor',
  'materialSafetyFactor', 'deadLoadFactor', 'windLoadFactor', 'equipmentLoadFactor',
  'windPressurePa', 'dragCoefficient', 'windDirectionDeg', 'windEnvelopeStepDeg',
  'equipmentMassKg', 'equipmentWindAreaM2', 'equipmentDragCoefficient',
  'extraHorizontalLoadN', 'extraVerticalLoadN', 'iceThicknessMm', 'iceDensityKgM3',
  'displacementLimitMm', 'minimumBucklingFactor',
]

for (const name of fieldNames) {
  const input = form.elements.namedItem(name)
  if (input) input.value = DEFAULT_PARAMETERS[name]
}
form.elements.namedItem('closeTopRing').checked = DEFAULT_PARAMETERS.closeTopRing
form.elements.namedItem('windEnvelopeEnabled').checked = DEFAULT_PARAMETERS.windEnvelopeEnabled

const format = (value, digits = 2) => new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}).format(value)
const formatFactor = (value) => Number.isFinite(value) ? format(value, 3) : '∞'
const angle = (value) => `${format(value, 0)}°`

function syncWindFields() {
  const envelope = form.elements.namedItem('windEnvelopeEnabled').checked
  form.elements.namedItem('windDirectionDeg').disabled = envelope
  form.elements.namedItem('windEnvelopeStepDeg').disabled = !envelope
}

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
  parameters.windEnvelopeEnabled = form.elements.namedItem('windEnvelopeEnabled').checked
  return parameters
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function exportFilename(extension) {
  const modules = lastParameters?.moduleCount ?? 'mast'
  const height = lastParameters?.moduleHeightMm ?? ''
  return `mast-calculation-${modules}x${height}.${extension}`
}

function renderMemberReport(result) {
  const members = buildMemberEnvelope(result)
    .sort((left, right) => right.utilization - left.utilization)
  memberResultsBody.replaceChildren(...members.map((member) => {
    const row = document.createElement('tr')
    if (member.utilization > 1) row.classList.add('danger-row')
    const values = [
      member.memberId,
      member.familyName,
      `${member.nodeA}–${member.nodeB}`,
      format(member.lengthM * 1000, 1),
      member.mode === 'compression' ? 'Сжатие' : 'Растяжение',
      format(member.axialForceN / 1000, 3),
      angle(member.windDirectionDeg),
      format(member.designCapacityN / 1000, 3),
      format(member.slenderness, 1),
      format(member.utilization, 4),
    ]
    row.replaceChildren(...values.map((value) => {
      const cell = document.createElement('td')
      cell.textContent = value
      return cell
    }))
    return row
  }))

  const material = buildMaterialSummary(result)
  const groupDescription = material.groups.map((group) => (
    `${group.familyName.toLowerCase()} Ø${format(group.diameterMm, 0)} × ${format(group.lengthMm, 0)} мм — ${group.count} шт.`
  )).join('; ')
  materialSummaryBox.textContent = `Всего ${material.totalCount} стержней, ${format(material.totalLengthM, 2)} м и ${format(material.totalMassKg, 1)} кг стали. ${groupDescription}`
}

function renderResult(result, parameters) {
  lastResult = result
  lastParameters = { ...parameters }
  exportCsvButton.disabled = false
  exportJsonButton.disabled = false
  viewer.setResult(result)
  resultsSection.hidden = false

  const strengthCase = result.envelope.strength
  const displacementCase = result.envelope.displacement
  const bucklingCase = result.envelope.buckling
  const critical = strengthCase.analysis.memberResults[strengthCase.analysis.criticalMemberId]
  const topDisplacementMm = result.envelope.maxTopDisplacementM * 1000
  const bucklingFactor = result.envelope.minimumBucklingFactor

  document.querySelector('#metric-height').textContent = `${format(parameters.moduleCount * parameters.moduleHeightMm / 1000)} м`
  document.querySelector('#metric-mass').textContent = `${format(result.analysis.totalMassKg, 1)} кг`
  document.querySelector('#metric-displacement').textContent = `${format(topDisplacementMm, 2)} мм`
  document.querySelector('#metric-utilization').textContent = format(result.envelope.maxUtilization, 3)
  document.querySelector('#metric-buckling').textContent = formatFactor(bucklingFactor)
  document.querySelector('#metric-wind-direction').textContent = angle(result.envelope.governing.windDirectionDeg)
  document.querySelector('#metric-critical').textContent = `№ ${strengthCase.analysis.criticalMemberId}`
  document.querySelector('#metric-residual').textContent = result.analysis.diagnostics.maximumNodeEquilibriumResidual.toExponential(2)

  document.querySelector('#metric-displacement').classList.toggle('danger', topDisplacementMm > parameters.displacementLimitMm)
  document.querySelector('#metric-utilization').classList.toggle('danger', result.envelope.maxUtilization > 1)
  document.querySelector('#metric-buckling').classList.toggle('danger', bucklingFactor < parameters.minimumBucklingFactor)

  document.querySelector('#critical-description').textContent = critical
    ? `Прочность: стержень № ${critical.memberId}, ${critical.mode === 'compression' ? 'сжатие' : 'растяжение'}, ветер ${angle(strengthCase.windDirectionDeg)}, усилие ${format(critical.axialForceN / 1000)} кН, несущая способность ${format(critical.designCapacityN / 1000)} кН. Максимальный прогиб возникает при ${angle(displacementCase.windDirectionDeg)}, минимальный множитель общей устойчивости — при ${angle(bucklingCase.windDirectionDeg)}.`
    : 'Критический стержень не определён.'

  document.querySelector('#load-summary').textContent = `Рассмотрено направлений ветра: ${result.envelope.caseCount}. Вес стали с коэффициентом: ${format(result.loads.selfWeightN / 1000)} кН; вес льда: ${format(result.loads.iceWeightN / 1000)} кН; ветер на стержни: ${format(result.loads.memberWindN / 1000)} кН.`

  warningsList.replaceChildren(...result.warnings.map((warning) => {
    const item = document.createElement('li')
    item.textContent = warning
    return item
  }))
  renderMemberReport(result)
}

function runCalculation() {
  errorBox.hidden = true
  optimizationBox.hidden = true
  calculateButton.disabled = true
  try {
    const parameters = readParameters()
    const result = calculateMast(parameters)
    renderResult(result, parameters)
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  } finally {
    calculateButton.disabled = false
  }
}

function runOptimization() {
  errorBox.hidden = true
  optimizeButton.disabled = true
  try {
    const parameters = readParameters()
    const optimization = selectUniformDiameter(parameters)
    const recommended = optimization.recommended
    optimizationBox.hidden = false

    if (!recommended) {
      optimizationBox.textContent = 'В диапазоне стандартных диаметров не найден вариант, проходящий по прочности, прогибу и общей устойчивости.'
      return
    }

    form.elements.namedItem('barDiameterMm').value = recommended.diameter
    renderResult(recommended.result, { ...parameters, barDiameterMm: recommended.diameter })
    optimizationBox.textContent = `Минимальный найденный единый диаметр: ${recommended.diameter} мм. Использование ${format(recommended.result.envelope.maxUtilization, 3)}, прогиб ${format(recommended.result.envelope.maxTopDisplacementM * 1000, 2)} мм, множитель общей устойчивости ${formatFactor(recommended.result.envelope.minimumBucklingFactor)}.`
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  } finally {
    optimizeButton.disabled = false
  }
}

calculateButton.addEventListener('click', runCalculation)
optimizeButton.addEventListener('click', runOptimization)
exportCsvButton.addEventListener('click', () => {
  if (!lastResult) return
  downloadText(exportFilename('csv'), createCalculationCsv(lastResult), 'text/csv;charset=utf-8')
})
exportJsonButton.addEventListener('click', () => {
  if (!lastResult || !lastParameters) return
  downloadText(exportFilename('json'), createCalculationJson(lastResult, lastParameters), 'application/json;charset=utf-8')
})
form.elements.namedItem('windEnvelopeEnabled').addEventListener('change', syncWindFields)
showBucklingMode.addEventListener('change', () => viewer.setBucklingMode(showBucklingMode.checked))
form.addEventListener('submit', (event) => {
  event.preventDefault()
  runCalculation()
})

syncWindFields()
runCalculation()
