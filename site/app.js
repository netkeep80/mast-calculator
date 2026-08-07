import { DEFAULT_PARAMETERS, resolveCalculationParameters } from './engine/calculate.js'
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
const cancelCalculationButton = document.querySelector('#cancel-calculation-button')
const errorBox = document.querySelector('#error')
const resultsSection = document.querySelector('#results')
const warningsList = document.querySelector('#warnings')
const optimizationBox = document.querySelector('#optimization-result')
const showBucklingMode = document.querySelector('#show-buckling-mode')
const memberResultsBody = document.querySelector('#member-results-body')
const materialSummaryBox = document.querySelector('#material-summary')
const materialInfoBox = document.querySelector('#material-info')
const progressPanel = document.querySelector('#calculation-progress')
const progressBar = document.querySelector('#progress-bar')
const progressStage = document.querySelector('#progress-stage')
const progressPercent = document.querySelector('#progress-percent')
const progressDetail = document.querySelector('#progress-detail')
const progressElapsed = document.querySelector('#progress-elapsed')
const progressEta = document.querySelector('#progress-eta')
const viewer = new MastViewer(document.querySelector('#mast-canvas'))

let lastResult = null
let lastParameters = null
let activeWorker = null
let activeJobId = 0
let activeJobStartedAt = 0
let progressTimer = null
let latestProgressFraction = 0
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

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes} мин ${remainder} с`
}

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

function limitModeLabel(mode) {
  if (mode === 'global-buckling') return 'общая потеря устойчивости'
  if (mode === 'local-member-buckling') return 'локальная устойчивость ребра'
  if (mode === 'material-strength') return 'прочность материала'
  if (mode === 'self-weight-overlimit') return 'собственный вес уже превышает предел'
  return 'не определён'
}

function renderMemberReport(result) {
  const members = buildMemberEnvelope(result).sort((left, right) => right.utilization - left.utilization)
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
  const staticPayload = result.staticPayloadCapacity
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
  document.querySelector('#metric-lateral-buckling').textContent = `${formatForce(lateral.globalBucklingForceKgf, 1)} кгс`
  document.querySelector('#metric-lateral-mode').textContent = limitModeLabel(lateral.governingMode)
  document.querySelector('#metric-static-payload').textContent = `${formatForce(staticPayload.maximumTotalTopMassKg, 1)} кг`
  document.querySelector('#metric-static-reserve').textContent = `${formatForce(staticPayload.remainingAdditionalMassKg, 1)} кг`
  document.querySelector('#metric-water-volume').textContent = `${formatForce(staticPayload.equivalentWaterVolumeM3, 3)} м³ (${formatForce(staticPayload.equivalentWaterVolumeLiters, 0)} л)`
  document.querySelector('#metric-static-mode').textContent = limitModeLabel(staticPayload.governingMode)

  document.querySelector('#metric-displacement').classList.toggle('danger', topDisplacementMm > parameters.displacementLimitMm)
  document.querySelector('#metric-utilization').classList.toggle('danger', result.envelope.maxUtilization > 1)
  document.querySelector('#metric-buckling').classList.toggle('danger', bucklingFactor < parameters.minimumBucklingFactor)
  document.querySelector('#metric-static-reserve').classList.toggle('danger', staticPayload.remainingAdditionalMassKg <= 0)

  document.querySelector('#critical-description').textContent = critical
    ? `Ребро № ${critical.memberId}: N = ${format(critical.axialForceN / 1000, 3)} кН, Vmax = ${format(critical.maxShearN / 1000, 3)} кН, Mmax = ${format(critical.maxBendingNm, 2)} Н·м, σэкв = ${format(critical.equivalentStressPa / 1e6, 2)} МПа, использование = ${format(critical.utilization, 4)} при ветре ${angle(strengthCase.windDirectionDeg)}. Максимальный прогиб возникает при ${angle(displacementCase.windDirectionDeg)}, минимальный множитель общей устойчивости — при ${angle(bucklingCase.windDirectionDeg)}.`
    : 'Критическое ребро не определено.'

  document.querySelector('#lateral-capacity-description').textContent = `Чистая горизонтальная сила прикладывается к вершине и распределяется поровну между тремя верхними узлами. Худшее направление ${angle(lateral.directionDeg)}: первый расчётный предел ${formatForce(lateral.criticalForceN / 1000, 3)} кН = ${formatForce(lateral.criticalForceKgf, 1)} кгс; механизм — ${limitModeLabel(lateral.governingMode)}. Предел по ребру ${formatForce(lateral.memberLimitForceKgf, 1)} кгс, линейная общая потеря устойчивости ${formatForce(lateral.globalBucklingForceKgf, 1)} кгс.`

  const boundedNote = staticPayload.bounded
    ? ''
    : ' Численный предел не был достигнут до программной верхней границы поиска, поэтому результат является нижней оценкой.'
  document.querySelector('#static-payload-description').textContent = `Гравитационный расчёт включает собственный вес мачты с γg = ${format(parameters.deadLoadFactor, 2)} и суммарную массу на вершине с γ = ${format(parameters.equipmentLoadFactor, 2)}, но исключает ветер и лёд. Максимальная суммарная масса на вершине ${formatForce(staticPayload.maximumTotalTopMassKg, 1)} кг (${formatForce(staticPayload.maximumNominalTopForceN / 1000, 3)} кН номинально); механизм — ${limitModeLabel(staticPayload.governingMode)}. После уже заданных оборудования и дополнительной вертикальной силы остаётся ${formatForce(staticPayload.remainingAdditionalMassKg, 1)} кг, что соответствует примерно ${formatForce(staticPayload.equivalentWaterVolumeM3, 3)} м³ воды при ρ = ${format(staticPayload.waterDensityKgM3, 0)} кг/м³. На пределе: использование ребра ${format(staticPayload.utilizationAtLimit, 4)}, λcr = ${formatFactor(staticPayload.bucklingFactorAtLimit)}, осадка вершины ${format(staticPayload.topSettlementAtLimitM * 1000, 2)} мм.${boundedNote}`

  const performance = result.performance
  const performanceText = performance
    ? ` Solver: ${performance.linearSystemSolver}; ${performance.freeDofCount} свободных DOF; полуширина ленты ${performance.stiffnessBandwidth}; факторизация K выполнена ${performance.stiffnessFactorizationCount} раз; ветровых случаев ${performance.operationalCaseCount}, боковых ${performance.lateralCaseCount}, оценок статического груза ${performance.staticPayloadEvaluationCount}.`
    : ''
  document.querySelector('#load-summary').textContent = `Погода: ${parameters.windPresetLabel}; v = ${format(parameters.windSpeedMs, 1)} м/с; q = ${format(parameters.windPressurePa, 1)} Па до γw. Рассмотрено направлений ветра: ${result.envelope.caseCount}. Вес стали с коэффициентом: ${format(result.loads.selfWeightN / 1000)} кН; вес льда: ${format(result.loads.iceWeightN / 1000)} кН; результирующий ветер на рёбра: ${format(result.loads.memberWindN / 1000)} кН.${performanceText}`

  warningsList.replaceChildren(...result.warnings.map((warning) => {
    const item = document.createElement('li')
    item.textContent = warning
    return item
  }))
  renderMemberReport(result)
}

function updateProgressClock() {
  if (!activeWorker) return
  const elapsed = performance.now() - activeJobStartedAt
  progressElapsed.textContent = `Прошло: ${formatDuration(elapsed)}`
  if (latestProgressFraction >= 0.03 && elapsed >= 300) {
    const eta = elapsed * (1 - latestProgressFraction) / Math.max(latestProgressFraction, 1e-6)
    progressEta.textContent = `Осталось: ≈ ${formatDuration(eta)}`
  } else {
    progressEta.textContent = 'Осталось: оценивается…'
  }
}

function showProgress(label) {
  progressPanel.hidden = false
  progressBar.value = 0
  progressStage.textContent = 'Вычисление'
  progressPercent.textContent = '0%'
  progressDetail.textContent = label
  progressElapsed.textContent = 'Прошло: 0 с'
  progressEta.textContent = 'Осталось: оценивается…'
  latestProgressFraction = 0
  activeJobStartedAt = performance.now()
  clearInterval(progressTimer)
  progressTimer = setInterval(updateProgressClock, 500)
}

function renderProgress(progress) {
  latestProgressFraction = Math.min(1, Math.max(0, progress.fraction ?? 0))
  const percent = Math.round(latestProgressFraction * 100)
  progressBar.value = percent
  progressPercent.textContent = `${percent}%`
  if (progress.phase === 'optimize') progressStage.textContent = 'Подбор диаметра'
  else if (progress.phase === 'static-payload') progressStage.textContent = 'Статическая нагрузка вершины'
  else progressStage.textContent = 'Расчёт мачты'
  progressDetail.textContent = progress.label ?? 'Вычисление…'
  updateProgressClock()
}

function setBusy(busy) {
  calculateButton.disabled = busy
  optimizeButton.disabled = busy
  cancelCalculationButton.disabled = !busy
}

function finishProgress(label, success = true) {
  clearInterval(progressTimer)
  progressTimer = null
  const elapsed = performance.now() - activeJobStartedAt
  if (success) {
    latestProgressFraction = 1
    progressBar.value = 100
    progressPercent.textContent = '100%'
  }
  progressStage.textContent = success ? 'Готово' : 'Остановлено'
  progressDetail.textContent = label
  progressElapsed.textContent = `Прошло: ${formatDuration(elapsed)}`
  progressEta.textContent = success ? 'Осталось: 0 с' : 'Осталось: —'
}

function stopActiveWorker() {
  if (activeWorker) activeWorker.terminate()
  activeWorker = null
  setBusy(false)
}

function cancelActiveJob() {
  if (!activeWorker) return
  activeJobId += 1
  stopActiveWorker()
  finishProgress('Расчёт отменён пользователем.', false)
}

function failWorker(message) {
  stopActiveWorker()
  finishProgress('Расчёт завершён с ошибкой.', false)
  errorBox.textContent = message
  errorBox.hidden = false
}

function renderOptimization(summary, result) {
  optimizationBox.hidden = false
  if (!summary?.recommendedDiameter) {
    optimizationBox.textContent = 'В диапазоне стандартных диаметров не найден вариант, проходящий по прочности, прогибу и общей устойчивости.'
    return
  }
  const diameter = summary.recommendedDiameter
  form.elements.namedItem('barDiameterMm').value = diameter
  const payloadText = result?.staticPayloadCapacity
    ? `, статическая масса на вершине ${formatForce(result.staticPayloadCapacity.maximumTotalTopMassKg, 1)} кг`
    : ''
  optimizationBox.textContent = `Минимальный найденный единый диаметр: ${diameter} мм. Использование ${format(result.envelope.maxUtilization, 3)}, прогиб ${format(result.envelope.maxTopDisplacementM * 1000, 2)} мм, множитель общей устойчивости ${formatFactor(result.envelope.minimumBucklingFactor)}, первый боковой предел ${formatForce(result.lateralCapacity.criticalForceKgf, 1)} кгс, боковая общая потеря устойчивости ${formatForce(result.lateralCapacity.globalBucklingForceKgf, 1)} кгс${payloadText}.`
}

function startWorkerJob(action, parameters) {
  if (activeWorker) cancelActiveJob()
  errorBox.hidden = true
  optimizationBox.hidden = true
  const jobId = ++activeJobId
  const worker = new Worker('./calculation-worker.js', { type: 'module' })
  activeWorker = worker
  setBusy(true)
  showProgress(action === 'optimize' ? 'Запуск подбора стандартного диаметра…' : 'Запуск расчёта…')

  worker.onmessage = (event) => {
    const message = event.data ?? {}
    if (message.jobId !== jobId || worker !== activeWorker) return
    if (message.type === 'progress') {
      renderProgress(message.progress)
      return
    }
    if (message.type === 'error') {
      failWorker(message.message ?? 'Неизвестная ошибка worker')
      return
    }
    if (message.type === 'result') {
      if (message.result) renderResult(message.result)
      if (message.optimization) renderOptimization(message.optimization, message.result)
      stopActiveWorker()
      finishProgress(message.optimization ? 'Подбор и итоговый расчёт завершены.' : 'Расчёт завершён.')
    }
  }
  worker.onerror = (event) => {
    if (worker !== activeWorker) return
    failWorker(event.message || 'Ошибка Web Worker')
  }
  worker.postMessage({ jobId, action, parameters })
}

function runCalculation() {
  try {
    startWorkerJob('calculate', readParameters())
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  }
}

function runOptimization() {
  try {
    startWorkerJob('optimize', readParameters())
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  }
}

calculateButton.addEventListener('click', runCalculation)
optimizeButton.addEventListener('click', runOptimization)
cancelCalculationButton.addEventListener('click', cancelActiveJob)
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
setBusy(false)
runCalculation()
