import { DEFAULT_PARAMETERS, calculateMast, resolveCalculationParameters } from './engine/calculate.js'
import {
  REINFORCEMENT_CLASS_IDS,
  STANDARD_DIAMETERS_MM,
  STOCK_BAR_DIVISIONS,
  STOCK_BAR_LENGTHS_MM,
  getReinforcementClass,
} from './engine/catalog.js'
import {
  DEFAULT_GUY_WIRE_ID,
  GUY_WIRE_CATALOG,
} from './engine/guy-wire-catalog.js'
import { calculateGuyedMast } from './engine/guy-wire-system.js'

const $ = (selector) => document.querySelector(selector)
const moduleCount = $('#module-count')
const barDiameter = $('#bar-diameter')
const reinforcementClass = $('#reinforcement-class')
const stockLength = $('#stock-length')
const stockPieces = $('#stock-pieces')
const windPressure = $('#wind-pressure')
const windDirection = $('#wind-direction')
const windStep = $('#wind-step')
const windEnvelope = $('#wind-envelope')
const equipmentMass = $('#equipment-mass')
const equipmentArea = $('#equipment-area')
const extraHorizontal = $('#extra-horizontal')
const extraVertical = $('#extra-vertical')
const iceThickness = $('#ice-thickness')
const displacementLimit = $('#displacement-limit')
const bucklingLimit = $('#buckling-limit')
const tierCount = $('#tier-count')
const safetyFactor = $('#guy-safety')
const terminationEfficiency = $('#termination-efficiency')
const tiersBox = $('#tiers')
const calculateButton = $('#calculate-guys')
const resetButton = $('#reset-guys')
const errorBox = $('#error')
const results = $('#results')

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  : '∞'
const norm3 = (vector) => Math.hypot(...vector)

function fillSelect(select, values, label = String) {
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label(value)
    return option
  }))
}

fillSelect(barDiameter, STANDARD_DIAMETERS_MM, (value) => `Ø${value} мм`)
fillSelect(reinforcementClass, REINFORCEMENT_CLASS_IDS, (id) => getReinforcementClass(id).label)
fillSelect(stockLength, STOCK_BAR_LENGTHS_MM, (value) => `${value / 1000} м`)
fillSelect(stockPieces, STOCK_BAR_DIVISIONS, String)

function setValue(element, value) {
  element.value = String(value)
}

function currentMastHeightM() {
  const p = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: Math.max(1, Math.floor(Number(moduleCount.value) || DEFAULT_PARAMETERS.moduleCount)),
    stockBarLengthMm: Number(stockLength.value) || DEFAULT_PARAMETERS.stockBarLengthMm,
    stockBarPieces: Number(stockPieces.value) || DEFAULT_PARAMETERS.stockBarPieces,
  })
  return p.moduleCount * p.moduleHeightMm / 1000
}

function updateGeometryHint() {
  try {
    const p = resolveCalculationParameters({
      ...DEFAULT_PARAMETERS,
      moduleCount: Number(moduleCount.value),
      stockBarLengthMm: Number(stockLength.value),
      stockBarPieces: Number(stockPieces.value),
      barDiameterMm: Number(barDiameter.value),
      reinforcementClass: reinforcementClass.value,
    })
    $('#mast-geometry').textContent = `Ребро ${format(p.ribCutLengthMm, 1)} мм; высота модуля ${format(p.moduleHeightMm, 1)} мм; высота мачты ${format(p.moduleCount * p.moduleHeightMm / 1000, 2)} м. Растяжка будет привязана к ближайшему узлу с шагом ${format(p.moduleHeightMm / 1000, 3)} м.`
  } catch (error) {
    $('#mast-geometry').textContent = error.message
  }
}

function wireOptions(selectedId) {
  return GUY_WIRE_CATALOG.map((wire) => {
    const option = document.createElement('option')
    option.value = wire.id
    option.textContent = `${wire.label} · Fmin ${format(wire.minimumBreakingLoadKn, 1)} кН`
    option.selected = wire.id === selectedId
    return option
  })
}

function createTier(index, preset = {}) {
  const article = document.createElement('article')
  article.className = 'guy-tier'
  article.dataset.tierIndex = String(index)
  const height = Number(preset.heightM ?? currentMastHeightM() * (index + 1) / Math.max(1, Number(tierCount.value)))
  const anchor = Number(preset.anchorRadiusM ?? 8)
  const guys = Number(preset.guyCount ?? 3)
  const pretensionKn = Number(preset.pretensionKn ?? 1.2)
  const azimuth = Number(preset.azimuthOffsetDeg ?? 0)
  article.innerHTML = `
    <h3>Ярус ${index + 1}</h3>
    <div class="guy-tier-grid">
      <label>Высота крепления, м<input data-field="heightM" type="number" min="0.1" step="0.1" value="${height.toFixed(2)}"></label>
      <label>Растяжек в ярусе<select data-field="guyCount"><option>3</option><option>4</option><option>5</option><option>6</option></select></label>
      <label>Расстояние до анкеров, м<input data-field="anchorRadiusM" type="number" min="0.2" step="0.1" value="${anchor}"></label>
      <label>Преднатяг каждой, кН<input data-field="pretensionKn" type="number" min="0" step="0.1" value="${pretensionKn}"></label>
      <label>Поворот анкеров, °<input data-field="azimuthOffsetDeg" type="number" step="5" value="${azimuth}"></label>
      <label>Трос<select data-field="wireId"></select></label>
    </div>`
  article.querySelector('[data-field="guyCount"]').value = String(guys)
  article.querySelector('[data-field="wireId"]').replaceChildren(...wireOptions(preset.wireId ?? DEFAULT_GUY_WIRE_ID))
  return article
}

function currentTierPresets() {
  return [...tiersBox.querySelectorAll('.guy-tier')].map((tier) => ({
    heightM: Number(tier.querySelector('[data-field="heightM"]').value),
    guyCount: Number(tier.querySelector('[data-field="guyCount"]').value),
    anchorRadiusM: Number(tier.querySelector('[data-field="anchorRadiusM"]').value),
    pretensionKn: Number(tier.querySelector('[data-field="pretensionKn"]').value),
    azimuthOffsetDeg: Number(tier.querySelector('[data-field="azimuthOffsetDeg"]').value),
    wireId: tier.querySelector('[data-field="wireId"]').value,
  }))
}

function rebuildTiers() {
  const count = Math.max(1, Math.min(8, Math.floor(Number(tierCount.value) || 1)))
  tierCount.value = String(count)
  const previous = currentTierPresets()
  tiersBox.replaceChildren(...Array.from({ length: count }, (_, index) => createTier(index, previous[index])))
}

function setExample() {
  setValue(moduleCount, DEFAULT_PARAMETERS.moduleCount)
  setValue(barDiameter, DEFAULT_PARAMETERS.barDiameterMm)
  reinforcementClass.value = DEFAULT_PARAMETERS.reinforcementClass
  setValue(stockLength, DEFAULT_PARAMETERS.stockBarLengthMm)
  setValue(stockPieces, DEFAULT_PARAMETERS.stockBarPieces)
  setValue(windPressure, DEFAULT_PARAMETERS.windPressurePa)
  setValue(windDirection, 0)
  setValue(windStep, DEFAULT_PARAMETERS.windEnvelopeStepDeg)
  windEnvelope.checked = true
  setValue(equipmentMass, DEFAULT_PARAMETERS.equipmentMassKg)
  setValue(equipmentArea, DEFAULT_PARAMETERS.equipmentWindAreaM2)
  setValue(extraHorizontal, DEFAULT_PARAMETERS.extraHorizontalLoadN)
  setValue(extraVertical, DEFAULT_PARAMETERS.extraVerticalLoadN)
  setValue(iceThickness, DEFAULT_PARAMETERS.iceThicknessMm)
  setValue(displacementLimit, DEFAULT_PARAMETERS.displacementLimitMm)
  setValue(bucklingLimit, DEFAULT_PARAMETERS.minimumBucklingFactor)
  setValue(tierCount, 2)
  setValue(safetyFactor, 3)
  setValue(terminationEfficiency, 0.8)
  tiersBox.replaceChildren(
    createTier(0, { heightM: currentMastHeightM() * 0.55, anchorRadiusM: 7, pretensionKn: 1.0 }),
    createTier(1, { heightM: currentMastHeightM(), anchorRadiusM: 9, pretensionKn: 1.2 }),
  )
  updateGeometryHint()
}

function readNumber(element, label, minimum = null) {
  const value = Number(element.value)
  if (!Number.isFinite(value)) throw new Error(`${label}: требуется число`)
  if (minimum != null && value < minimum) throw new Error(`${label}: значение должно быть не меньше ${minimum}`)
  return value
}

function readParameters() {
  return resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: Math.floor(readNumber(moduleCount, 'Число модулей', 1)),
    stockBarLengthMm: readNumber(stockLength, 'Длина прутка', 1),
    stockBarPieces: Math.floor(readNumber(stockPieces, 'Число частей', 1)),
    barDiameterMm: readNumber(barDiameter, 'Диаметр арматуры', 1),
    reinforcementClass: reinforcementClass.value,
    windPresetId: 'custom',
    windPressurePa: readNumber(windPressure, 'Давление ветра', 0),
    windDirectionDeg: readNumber(windDirection, 'Направление ветра'),
    windEnvelopeEnabled: windEnvelope.checked,
    windEnvelopeStepDeg: readNumber(windStep, 'Шаг огибающей', 1),
    equipmentMassKg: readNumber(equipmentMass, 'Масса оборудования', 0),
    equipmentWindAreaM2: readNumber(equipmentArea, 'Парусная площадь', 0),
    extraHorizontalLoadN: readNumber(extraHorizontal, 'Доп. горизонтальная сила', 0),
    extraVerticalLoadN: readNumber(extraVertical, 'Доп. вертикальная сила', 0),
    iceThicknessMm: readNumber(iceThickness, 'Толщина льда', 0),
    displacementLimitMm: readNumber(displacementLimit, 'Допустимый прогиб', 1),
    minimumBucklingFactor: readNumber(bucklingLimit, 'Минимальный λ', 1),
  })
}

function readTiers() {
  return [...tiersBox.querySelectorAll('.guy-tier')].map((tier, index) => {
    const value = (field) => tier.querySelector(`[data-field="${field}"]`)
    return {
      id: `ui-tier-${index + 1}`,
      heightM: readNumber(value('heightM'), `Ярус ${index + 1}: высота`, 0.1),
      guyCount: Math.floor(readNumber(value('guyCount'), `Ярус ${index + 1}: число растяжек`, 3)),
      anchorRadiusM: readNumber(value('anchorRadiusM'), `Ярус ${index + 1}: анкеры`, 0.1),
      pretensionN: readNumber(value('pretensionKn'), `Ярус ${index + 1}: преднатяг`, 0) * 1000,
      azimuthOffsetDeg: readNumber(value('azimuthOffsetDeg'), `Ярус ${index + 1}: поворот`),
      wireId: value('wireId').value,
    }
  })
}

function cell(value) {
  const td = document.createElement('td')
  td.textContent = String(value)
  return td
}

function renderCatalog() {
  $('#catalog-body').replaceChildren(...GUY_WIRE_CATALOG.map((wire) => {
    const row = document.createElement('tr')
    const source = cell(wire.source)
    source.className = 'guy-catalog-source'
    row.append(
      cell(wire.label),
      cell(format(wire.diameterMm, 0)),
      cell(format(wire.metallicAreaMm2, 2)),
      cell(format(wire.massKgM, 3)),
      cell(format(wire.minimumBreakingLoadKn, 2)),
      cell(format(wire.effectiveYoungModulusGPa, 0)),
      source,
    )
    return row
  }))
}

function renderResults(bare, guyed) {
  results.hidden = false
  const status = $('#pass-status')
  status.textContent = guyed.passes ? 'Проходит выбранные критерии' : 'Не проходит выбранные критерии'
  status.className = guyed.passes ? 'guy-status-pass' : 'guy-status-fail'
  const bareMm = bare.envelope.maxTopDisplacementM * 1000
  const guyedMm = guyed.envelope.maxTopDisplacementM * 1000
  $('#bare-displacement').textContent = `${format(bareMm, 1)} мм`
  $('#guyed-displacement').textContent = `${format(guyedMm, 1)} мм`
  const reduction = bareMm > 1e-9 ? (1 - guyedMm / bareMm) * 100 : 0
  $('#displacement-change').textContent = `изменение ${format(reduction, 1)}%`
  $('#member-utilization').textContent = format(guyed.envelope.maxUtilization, 3)
  $('#buckling-factor').textContent = format(guyed.envelope.minimumBucklingFactor, 2)
  $('#buckling-criterion').textContent = `требуется ≥ ${format(guyed.parameters.minimumBucklingFactor, 2)}`
  $('#cable-utilization').textContent = format(guyed.envelope.maximumCableUtilization, 3)
  $('#cable-count').textContent = `${guyed.cableSystem.cables.length} / ${format(guyed.cableSystem.totalCableLengthM, 1)} м`
  $('#cable-mass').textContent = `масса тросов ≈ ${format(guyed.cableSystem.totalCableMassKg, 1)} кг`

  $('#cable-envelope-body').replaceChildren(...guyed.cableEnvelope.map((cable) => {
    const row = document.createElement('tr')
    if (!cable.passes) row.classList.add('danger-row')
    row.append(
      cell(cable.tierNumber),
      cell(cable.cableNumber),
      cell(cable.attachmentNodeId),
      cell(format(cable.attachmentPosition[2], 2)),
      cell(format(cable.anchorRadiusM, 2)),
      cell(`${format(cable.initialAngleToHorizontalDeg, 1)}°`),
      cell(format(cable.initialLengthM, 2)),
      cell(format(cable.minimumTensionN / 1000, 2)),
      cell(format(cable.maximumTensionN / 1000, 2)),
      cell(format(cable.capacity.designWorkingLoadN / 1000, 2)),
      cell(format(cable.maximumUtilization, 3)),
      cell(cable.slackInEnvelope ? 'да' : 'нет'),
    )
    return row
  }))

  const governing = guyed.envelope.governing
  $('#governing-case').textContent = `Определяющее направление ветра: ${format(governing.windDirectionDeg, 0)}°. Newton: ${governing.nonlinear.converged ? 'сошёлся' : 'НЕ сошёлся'}, ${governing.nonlinear.iterations} итераций.`
  $('#reaction-body').replaceChildren(...governing.cables.map((cable) => {
    const reaction = cable.moduleNodeReactionN
    const row = document.createElement('tr')
    row.append(
      cell(cable.tierNumber),
      cell(cable.cableNumber),
      cell(cable.attachmentNodeId),
      cell(format(cable.tensionN / 1000, 2)),
      cell(format(reaction[0] / 1000, 2)),
      cell(format(reaction[1] / 1000, 2)),
      cell(format(reaction[2] / 1000, 2)),
      cell(format(norm3(reaction) / 1000, 2)),
      cell(format(norm3(cable.anchorLoadN) / 1000, 2)),
    )
    return row
  }))
  $('#warnings').replaceChildren(...guyed.warnings.map((warning) => {
    const item = document.createElement('li')
    item.textContent = warning
    return item
  }))
}

function calculate() {
  errorBox.hidden = true
  results.hidden = true
  calculateButton.disabled = true
  calculateButton.textContent = 'Расчёт…'
  try {
    const p = readParameters()
    const tiers = readTiers()
    const guyOptions = {
      safetyFactor: readNumber(safetyFactor, 'Коэффициент запаса', 1),
      terminationEfficiency: readNumber(terminationEfficiency, 'Эффективность заделки', 0.01),
    }
    const bare = calculateMast(p)
    const guyed = calculateGuyedMast(p, tiers, guyOptions)
    renderResults(bare, guyed)
  } catch (error) {
    errorBox.textContent = error.stack || error.message
    errorBox.hidden = false
  } finally {
    calculateButton.disabled = false
    calculateButton.textContent = 'Рассчитать мачту с растяжками'
  }
}

tierCount.addEventListener('change', rebuildTiers)
for (const element of [moduleCount, stockLength, stockPieces, barDiameter, reinforcementClass]) {
  element.addEventListener('change', updateGeometryHint)
}
calculateButton.addEventListener('click', calculate)
resetButton.addEventListener('click', setExample)

renderCatalog()
setExample()
