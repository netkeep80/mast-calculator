import { calculateMast, DEFAULT_PARAMETERS, resolveCalculationParameters } from './engine/calculate.js'
import {
  getReinforcementClass,
  regularOctahedronHeightMm,
  REINFORCEMENT_CLASS_IDS,
  STANDARD_DIAMETERS_MM,
  STOCK_BAR_DIVISIONS,
  STOCK_BAR_LENGTHS_MM,
  theoreticalCutLengthMm,
} from './engine/catalog.js'
import { createCalculationProjectHtml } from './engine/calculation-project.js'
import { calculateLateralCapacity } from './engine/lateral-capacity.js'
import { selectUniformDiameter } from './engine/optimize.js'
import {
  buildMaterialSummary,
  buildMemberEnvelope,
  createCalculationCsv,
} from './engine/report.js'
import {
  CUSTOM_WIND_PRESET_ID,
  getWeatherPreset,
  WEATHER_PRESETS,
  windPressureFromSpeedMs,
  windSpeedFromPressurePa,
} from './engine/weather.js'
import { MastViewer } from './viewer.js'

const form = document.querySelector('#parameters-form')
const calculateButton = document.querySelector('#calculate-button')
const optimizeButton = document.querySelector('#optimize-button')
const exportNoteButton = document.querySelector('#export-note-button')
const exportCsvButton = document.querySelector('#export-csv-button')
const errorBox = document.querySelector('#error')
const resultsSection = document.querySelector('#results')
const warningsList = document.querySelector('#warnings')
const optimizationBox = document.querySelector('#optimization-result')
const showBucklingMode = document.querySelector('#show-buckling-mode')
const memberResultsBody = document.querySelector('#member-results-body')
const materialSummaryBox = document.querySelector('#material-summary')
const materialInfoBox = document.querySelector('#material-info')
const viewer = new MastViewer(document.querySelector('#mast-canvas'))

let lastResult = null
let lastParameters = null
let buildInfo = {
  repository: 'netkeep80/mast-calculator',
  ref: 'local',
  sha: 'development',
  runId: 'local',
}

fetch('./build-info.json', { cache: 'no-store' })
  .then((response) => response.ok ? response.json() : null)
  .then((value) => { if (value) buildInfo = { ...buildInfo, ...value } })
  .catch(() => {})

const numericFieldNames = [
  'moduleCount', 'stockBarLengthMm', 'stockBarPieces', 'barDiameterMm',
  'materialSafetyFactor', 'deadLoadFactor', 'windLoadFactor',
  'equipmentLoadFactor', 'windPressurePa', 'dragCoefficient', 'windDirectionDeg',
  'windEnvelopeStepDeg', 'lateralCapacityStepDeg', 'equipmentMassKg',
  'equipmentWindAreaM2', 'equipmentDragCoefficient', 'extraHorizontalLoadN',
  'extraVerticalLoadN', 'iceThicknessMm', 'iceDensityKgM3', 'displacementLimitMm',
  'minimumBucklingFactor',
]

function populateSelect(name, values, label = String) {
  const select = form.elements.namedItem(name)
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label(value)
    return option
  }))
}

populateSelect('stockBarLengthMm', STOCK_BAR_LENGTHS_MM, (value) => `${value / 1000} м`)
populateSelect('stockBarPieces', STOCK_BAR_DIVISIONS, (value) => `${value}`)
populateSelect('barDiameterMm', STANDARD_DIAMETERS_MM, (value) => `Ø${value}`)
populateSelect('reinforcementClass', REINFORCEMENT_CLASS_IDS, (value) => getReinforcementClass(value).label)
populateSelect(
  'windPresetId',
  [CUSTOM_WIND_PRESET_ID, ...WEATHER_PRESETS.map((preset) => preset.id)],
  (id) => {
    const preset = getWeatherPreset(id)
    if (preset.id === CUSTOM_WIND_PRESET_ID) return preset.label
    return `Бофорт ${preset.beaufort}: ${preset.label} · ${preset.range}`
  },
)

for (const name of numericFieldNames) {
  const input = form.elements.namedItem(name)
  if (input) input.value = DEFAULT_PARAMETERS[name]
}
form.elements.namedItem('reinforcementClass').value = DEFAULT_PARAMETERS.reinforcementClass
form.elements.namedItem('windPresetId').value = DEFAULT_PARAMETERS.windPresetId
form.elements.namedItem('closeTopRing').checked = DEFAULT_PARAMETERS.closeTopRing
form.elements.namedItem('windEnvelopeEnabled').checked = DEFAULT_PARAMETERS.windEnvelopeEnabled

const format = (value, digits = 2) => new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
}).format(value)
const formatFactor = (value) => Number.isFinite(value) ? format(value, 3) : '∞'
const formatForce = (value, digits = 1) => Number.isFinite(value) ? format(value, digits) : '∞'
const angle = (value) => `${format(value, 0)}°`

function syncWindFields() {
  const envelope = form.elements.namedItem('windEnvelopeEnabled').checked
  form.elements.namedItem('windDirectionDeg').disabled = envelope
  form.elements.namedItem('windEnvelopeStepDeg').disabled = !envelope
}

function syncWindPresetFields() {
  const presetId = form.elements.namedItem('windPresetId').value
  const preset = getWeatherPreset(presetId)
  const pressureInput = form.elements.namedItem('windPressurePa')
  const speedInput = form.elements.namedItem('windSpeedMs')
  const isCustom = preset.id === CUSTOM_WIND_PRESET_ID

  pressureInput.readOnly = !isCustom
  if (isCustom) {
    speedInput.value = windSpeedFromPressurePa(Number(pressureInput.value)).toFixed(2)
  } else {
    pressureInput.value = windPressureFromSpeedMs(preset.designSpeedMs).toFixed(1)
    speedInput.value = preset.designSpeedMs.toFixed(1)
  }
}

function syncFabricationFields() {
  const stockLength = Number(form.elements.namedItem('stockBarLengthMm').value)
  const pieces = Number(form.elements.namedItem('stockBarPieces').value)
  const cutLength = theoreticalCutLengthMm(stockLength, pieces)
  const moduleHeight = regularOctahedronHeightMm(cutLength)
  form.elements.namedItem('ribCutLengthMm').value = cutLength.toFixed(2)
  form.elements.namedItem('moduleHeightMm').value = moduleHeight.toFixed(2)

  const material = getReinforcementClass(form.elements.namedItem('reinforcementClass').value)
  materialInfoBox.textContent = `${material.label}, ${material.standard}: Rp/Ry = ${material.yieldStrengthMPa} МПа, Rm = ${material.tensileStrengthMPa} МПа, E = ${material.youngModulusGPa} ГПа, ν = ${material.poissonRatio}. Для выбранных классов предусмотрена гарантия свариваемости.`
}

function readParameters() {
  const parameters = { ...DEFAULT_PARAMETERS }
  for (const name of numericFieldNames) {
    const element = form.elements.namedItem(name)
    const value = Number(element.value)
    if (!Number.isFinite(value)) throw new Error(`Поле «${element.labels?.[0]?.textContent ?? name}» заполнено неверно`)
    parameters[name] = value
  }
  parameters.moduleCount = Math.floor(parameters.moduleCount)
  parameters.stockBarPieces = Math.floor(parameters.stockBarPieces)
  parameters.reinforcementClass = form.elements.namedItem('reinforcementClass').value
  parameters.windPresetId = form.elements.namedItem('windPresetId').value
  parameters.closeTopRing = form.elements.namedItem('closeTopRing').checked
  parameters.windEnvelopeEnabled = form.elements.namedItem('windEnvelopeEnabled').checked
  return resolveCalculationParameters(parameters)
}

function calculateCompleteResult(parameters) {
  const result = calculateMast(parameters)
  result.lateralCapacity = calculateLateralCapacity(result.model, result.parameters)
  return result
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
  const cutLength = lastParameters?.ribCutLengthMm ? Math.round(lastParameters.ribCutLengthMm) : ''
  return `mast-project-${modules}x-${cutLength}mm.${extension}`
}

function lateralModeLabel(mode) {
  if (mode === 'global-buckling') return 'общая потеря устойчивости'
  if (mode === 'local-member-buckling') return 'локальная устойчивость ребра'
  if (mode === 'material-strength') return 'прочность материала'
  return 'не определён'
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
      format(member.axialForceN / 1000, 3),
      format(member.maxShearN / 1000, 3),
      format(member.maxBendingNm, 2),
      format(member.equivalentStressPa / 1e6, 2),
      angle(member.windDirectionDeg),
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
  materialSummaryBox.textContent = `Всего ${material.totalCount} рёбер, ${format(material.totalLengthM, 2)} м и ${format(material.totalMassKg, 1)} кг стали. ${groupDescription}`
}

function renderResult(result) {
  const parameters = result.parameters
  const lateral = result.lateralCapacity
  lastResult = result
  lastParameters = { ...parameters }
  exportNoteButton.disabled = false
  exportCsvButton.disabled = false
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
  document.querySelector('#metric-lateral-capacity').textContent = `${formatForce(lateral.criticalForceKgf, 1)} кгс`
  document.querySelector('#metric-lateral-mode').textContent = lateralModeLabel(lateral.governingMode)

  document.querySelector('#metric-displacement').classList.toggle('danger', topDisplacementMm > parameters.displacementLimitMm)
  document.querySelector('#metric-utilization').classList.toggle('danger', result.envelope.maxUtilization > 1)
  document.querySelector('#metric-buckling').classList.toggle('danger', bucklingFactor < parameters.minimumBucklingFactor)

  document.querySelector('#critical-description').textContent = critical
    ? `Ребро № ${critical.memberId}: N = ${format(critical.axialForceN / 1000, 3)} кН, Vmax = ${format(critical.maxShearN / 1000, 3)} кН, Mmax = ${format(critical.maxBendingNm, 2)} Н·м, σэкв = ${format(critical.equivalentStressPa / 1e6, 2)} МПа, использование = ${format(critical.utilization, 4)} при ветре ${angle(strengthCase.windDirectionDeg)}. Максимальный прогиб возникает при ${angle(displacementCase.windDirectionDeg)}, минимальный множитель общей устойчивости — при ${angle(bucklingCase.windDirectionDeg)}.`
    : 'Критическое ребро не определено.'

  document.querySelector('#lateral-capacity-description').textContent = `Чистая горизонтальная сила прикладывается к вершине и распределяется поровну между тремя верхними узлами. Худшее направление ${angle(lateral.directionDeg)}: первый расчётный предел ${formatForce(lateral.criticalForceN / 1000, 3)} кН = ${formatForce(lateral.criticalForceKgf, 1)} кгс; механизм — ${lateralModeLabel(lateral.governingMode)}. Предел по ребру ${formatForce(lateral.memberLimitForceKgf, 1)} кгс, линейный глобальный eigen-buckling ${formatForce(lateral.globalBucklingForceKgf, 1)} кгс. Это отдельный нормированный испытательный случай без ветра, льда, собственного веса и оборудования; реальный натурный тест должен учитывать собственный вес и геометрическую нелинейность.`

  document.querySelector('#load-summary').textContent = `Погода: ${parameters.windPresetLabel}; v = ${format(parameters.windSpeedMs, 1)} м/с; q = ${format(parameters.windPressurePa, 1)} Па до γw. Рассмотрено направлений ветра: ${result.envelope.caseCount}. Вес стали с коэффициентом: ${format(result.loads.selfWeightN / 1000)} кН; вес льда: ${format(result.loads.iceWeightN / 1000)} кН; результирующий ветер на рёбра: ${format(result.loads.memberWindN / 1000)} кН.`

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
    const result = calculateCompleteResult(parameters)
    renderResult(result)
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
    const complete = calculateCompleteResult({ ...parameters, barDiameterMm: recommended.diameter })
    renderResult(complete)
    optimizationBox.textContent = `Минимальный найденный единый диаметр: ${recommended.diameter} мм. Использование ${format(complete.envelope.maxUtilization, 3)}, прогиб ${format(complete.envelope.maxTopDisplacementM * 1000, 2)} мм, множитель общей устойчивости ${formatFactor(complete.envelope.minimumBucklingFactor)}, чистая боковая нагрузка вершины ${formatForce(complete.lateralCapacity.criticalForceKgf, 1)} кгс.`
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  } finally {
    optimizeButton.disabled = false
  }
}

calculateButton.addEventListener('click', runCalculation)
optimizeButton.addEventListener('click', runOptimization)
exportNoteButton.addEventListener('click', () => {
  if (!lastResult || !lastParameters) return
  const generatedAt = new Date().toISOString()
  downloadText(
    exportFilename('html'),
    createCalculationProjectHtml(lastResult, lastParameters, generatedAt, buildInfo),
    'text/html;charset=utf-8',
  )
})
exportCsvButton.addEventListener('click', () => {
  if (!lastResult) return
  downloadText(exportFilename('csv'), createCalculationCsv(lastResult), 'text/csv;charset=utf-8')
})
form.elements.namedItem('windEnvelopeEnabled').addEventListener('change', syncWindFields)
form.elements.namedItem('windPresetId').addEventListener('change', syncWindPresetFields)
form.elements.namedItem('windPressurePa').addEventListener('input', () => {
  if (form.elements.namedItem('windPresetId').value === CUSTOM_WIND_PRESET_ID) syncWindPresetFields()
})
form.elements.namedItem('stockBarLengthMm').addEventListener('change', syncFabricationFields)
form.elements.namedItem('stockBarPieces').addEventListener('change', syncFabricationFields)
form.elements.namedItem('reinforcementClass').addEventListener('change', syncFabricationFields)
showBucklingMode.addEventListener('change', () => viewer.setBucklingMode(showBucklingMode.checked))
form.addEventListener('submit', (event) => {
  event.preventDefault()
  runCalculation()
})

syncWindFields()
syncWindPresetFields()
syncFabricationFields()
runCalculation()
