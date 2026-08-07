import { getReinforcementClass } from './engine/catalog.js'
import { getWeldConsumable } from './engine/connection-catalog.js'
import { buildJointHardwareGeometry } from './engine/joint-hardware-catalog.js'
import {
  buildProcurementEstimate,
  createProcurementEstimateHtml,
  PROCUREMENT_GUY_STORAGE_KEY,
} from './engine/procurement-estimate.js'

const $ = (selector) => document.querySelector(selector)
const form = $('#parameters-form')
const results = $('#results')

function selectedNumber(name, fallback = 0) {
  const value = Number(form?.elements.namedItem(name)?.value)
  return Number.isFinite(value) ? value : fallback
}
function selectedText(name) {
  const select = form?.elements.namedItem(name)
  return select?.selectedOptions?.[0]?.textContent?.trim() ?? String(select?.value ?? '')
}
function parseDisplayedNumber(value) {
  const normalized = String(value ?? '').replaceAll('\u00a0', '').replace(',', '.')
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : Number.NaN
}
function currentModuleDiameters() {
  const values = globalThis.__mastDiameterProfileUi?.selectedDiameters?.()
  return Array.isArray(values) && values.length ? values.map(Number) : undefined
}
function numericEqual(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) < 1e-9
}

function currentGuySignature() {
  return {
    moduleCount: selectedNumber('moduleCount'),
    stockBarLengthMm: selectedNumber('stockBarLengthMm'),
    stockBarPieces: selectedNumber('stockBarPieces'),
    barDiameterMm: selectedNumber('barDiameterMm'),
    reinforcementClass: form?.elements.namedItem('reinforcementClass')?.value ?? '',
    windPressurePa: selectedNumber('windPressurePa'),
    equipmentMassKg: selectedNumber('equipmentMassKg'),
    equipmentWindAreaM2: selectedNumber('equipmentWindAreaM2'),
    iceThicknessMm: selectedNumber('iceThicknessMm'),
  }
}

function loadCompatibleGuyGroups() {
  try {
    const raw = localStorage.getItem(PROCUREMENT_GUY_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (saved?.schema !== PROCUREMENT_GUY_STORAGE_KEY || !Array.isArray(saved.groups) || !saved.groups.length) return null
    const diameters = currentModuleDiameters()
    if (diameters && new Set(diameters).size > 1) return null
    const current = currentGuySignature()
    const stored = saved.signature ?? {}
    const numericFields = [
      'moduleCount', 'stockBarLengthMm', 'stockBarPieces', 'barDiameterMm',
      'windPressurePa', 'equipmentMassKg', 'equipmentWindAreaM2', 'iceThicknessMm',
    ]
    if (!numericFields.every((field) => numericEqual(current[field], stored[field]))) return null
    if (current.reinforcementClass !== stored.reinforcementClass) return null
    return saved
  } catch {
    return null
  }
}

function installStyles() {
  if ($('style[data-procurement-estimate-style]')) return
  const style = document.createElement('style')
  style.dataset.procurementEstimateStyle = 'true'
  style.textContent = `
    .procurement-estimate-card { margin-top: 1rem; padding: 1rem; border: 1px solid var(--border, #d0d7de); border-radius: 12px; }
    .procurement-estimate-card h2 { margin-top: 0; }
    .procurement-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .75rem; align-items: end; }
    .procurement-controls label { display: grid; gap: .3rem; }
    .procurement-controls input { width: 100%; box-sizing: border-box; }
    .procurement-action { margin-top: .9rem; }
    .procurement-status { margin: .7rem 0 0; }
  `
  document.head.append(style)
}

function createControl(labelText, id, attributes = {}) {
  const label = document.createElement('label')
  label.append(document.createTextNode(labelText))
  const input = document.createElement('input')
  input.id = id
  input.type = 'number'
  for (const [key, value] of Object.entries(attributes)) input.setAttribute(key, String(value))
  label.append(input)
  return label
}

function guySourceText() {
  const saved = loadCompatibleGuyGroups()
  if (!saved) return 'Совместимый расчёт оттяжек не найден: трос берётся из ручных полей ниже.'
  const total = saved.groups.reduce((sum, group) => sum + Number(group.designLengthM || 0), 0)
  return `Найден совместимый расчёт оттяжек: ${saved.groups.length} тип(а) троса, суммарно ${total.toFixed(2)} м. Он будет использован вместо ручных полей.`
}

function createPanel() {
  if (!results || $('#procurement-estimate-card')) return null
  const section = document.createElement('section')
  section.id = 'procurement-estimate-card'
  section.className = 'procurement-estimate-card'
  const heading = document.createElement('h2')
  heading.textContent = 'Закупочная смета'
  const hint = document.createElement('p')
  hint.className = 'hint practical-note'
  hint.innerHTML = 'Арматура по фактическим диаметрам, метизы и сварочный материал берутся из рассчитанной конструкции. <a href="./guys.html">Рассчитать оттяжки</a> — последний совместимый результат автоматически попадёт в смету.'
  const source = document.createElement('p')
  source.id = 'procurement-guy-source'
  source.className = 'hint practical-note'
  source.textContent = guySourceText()
  const controls = document.createElement('div')
  controls.className = 'procurement-controls'
  controls.append(
    createControl('Запас на закупку, %', 'procurement-reserve-percent', { min: 0, max: 100, step: 1, value: 5 }),
    createControl('Трос вручную: диаметр, мм', 'procurement-cable-diameter-mm', { min: 0, step: 0.5, value: 0 }),
    createControl('Трос вручную: общая длина, м', 'procurement-cable-length-m', { min: 0, step: 0.5, value: 0 }),
  )
  const button = document.createElement('button')
  button.id = 'print-procurement-estimate-button'
  button.type = 'button'
  button.className = 'secondary procurement-action'
  button.textContent = 'Открыть и распечатать смету'
  const status = document.createElement('p')
  status.id = 'procurement-estimate-status'
  status.className = 'hint procurement-status'
  section.append(heading, hint, source, controls, button, status)
  const assemblyCard = results.querySelector('.assembly-mass-card')
  if (assemblyCard) assemblyCard.after(section)
  else results.prepend(section)
  return section
}

function buildCurrentEstimate() {
  if (!form || results?.hidden) throw new Error('Сначала выполните расчёт мачты')
  const weldLengthMm = parseDisplayedNumber($('#metric-weld-length')?.textContent)
  if (!Number.isFinite(weldLengthMm) || weldLengthMm < 0) {
    throw new Error('Не удалось получить рассчитанную длину сварного шва')
  }
  const geometry = buildJointHardwareGeometry({
    boltDiameterMm: selectedNumber('jointBoltDiameterMm'),
    boltClass: form.elements.namedItem('jointBoltClass')?.value || '8.8',
    clearanceNutThreadMm: selectedNumber('jointClearanceNutThreadMm'),
    boltLengthMm: selectedNumber('jointBoltLengthMm'),
    threadEngagementFactor: selectedNumber('jointThreadEngagementFactor', 2),
  })
  const reinforcement = getReinforcementClass(form.elements.namedItem('reinforcementClass')?.value)
  const weldConsumable = getWeldConsumable(form.elements.namedItem('weldConsumableId')?.value)
  const savedGuys = loadCompatibleGuyGroups()
  const guyInput = savedGuys
    ? { guyCableGroups: savedGuys.groups }
    : {
        guyCableDiameterMm: Number($('#procurement-cable-diameter-mm')?.value ?? 0),
        guyCableLengthM: Number($('#procurement-cable-length-m')?.value ?? 0),
      }

  return buildProcurementEstimate({
    moduleCount: selectedNumber('moduleCount'),
    moduleHeightMm: selectedNumber('moduleHeightMm'),
    stockBarLengthMm: selectedNumber('stockBarLengthMm'),
    stockBarPieces: selectedNumber('stockBarPieces'),
    ribCutLengthMm: selectedNumber('ribCutLengthMm'),
    barDiameterMm: selectedNumber('barDiameterMm'),
    moduleDiametersMm: currentModuleDiameters(),
    reinforcementLabel: selectedText('reinforcementClass'),
    densityKgM3: reinforcement.densityKgM3,
    boltClass: form.elements.namedItem('jointBoltClass')?.value || '—',
    geometry,
    weldConsumable,
    weldLegMm: selectedNumber('weldLegMm'),
    weldPhysicalLengthPerEndMm: weldLengthMm,
    reservePercent: Number($('#procurement-reserve-percent')?.value ?? 0),
    ...guyInput,
  })
}

function openPrintableEstimate() {
  const status = $('#procurement-estimate-status')
  try {
    const estimate = buildCurrentEstimate()
    const html = createProcurementEstimateHtml(estimate, new Date().toLocaleString('ru-RU'))
    const printWindow = window.open('', '_blank')
    if (!printWindow) throw new Error('Браузер заблокировал новое окно. Разрешите всплывающие окна для печати сметы.')
    printWindow.opener = null
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    const rebar = estimate.rebar.groups.map((group) => `Ø${group.diameterMm}: ${group.stockBarCount} прутк.`).join('; ')
    const guySource = estimate.guyCable.imported ? 'оттяжки из расчёта' : 'оттяжки вручную'
    status.textContent = `Смета сформирована: ${rebar}; по ${estimate.hardware.purchaseCountEach} комплектов метизов; ${guySource}.`
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
  }
}

function install() {
  installStyles()
  const panel = createPanel()
  panel?.querySelector('#print-procurement-estimate-button')?.addEventListener('click', openPrintableEstimate)
}

install()
