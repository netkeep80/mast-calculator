import { previewProjectGeometry } from '../../packages/application/index.js'
import {
  DEFAULT_GUY_WIRE_ID,
  GUY_WIRE_CATALOG,
} from '../../packages/domain/index.js'
import { readProjectInputFromForm } from './project-form-dom.js'

let singleton = null

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

function element(tag, className = '', text = '') {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function labeledControl(labelText, control) {
  const label = document.createElement('label')
  label.append(document.createTextNode(labelText), control)
  return label
}

function numberInput(value, { min = null, max = null, step = null } = {}) {
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value)
  if (min !== null) input.min = String(min)
  if (max !== null) input.max = String(max)
  if (step !== null) input.step = String(step)
  return input
}

function selectInput(values, selected, label = String) {
  const select = document.createElement('select')
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement('option')
    option.value = String(value)
    option.textContent = label(value)
    option.selected = String(value) === String(selected)
    return option
  }))
  return select
}

function defaultMastHeight(form) {
  try {
    return previewProjectGeometry(readProjectInputFromForm(form)).mastHeightM
  } catch {
    return 6
  }
}

function normalizedTierInput(tier = {}, index = 0, total = 1, form = null) {
  const height = finite(tier.heightM, defaultMastHeight(form) * (index + 1) / Math.max(1, total))
  return {
    id: typeof tier.id === 'string' && tier.id ? tier.id : `web-tier-${index + 1}`,
    heightM: Math.max(0.1, height),
    guyCount: Math.max(3, Math.min(6, Math.round(finite(tier.guyCount, 3)))),
    anchorRadiusM: Math.max(0.1, finite(tier.anchorRadiusM ?? tier.anchorDistanceM, 8)),
    pretensionN: Math.max(0, finite(tier.pretensionN, 1200)),
    azimuthOffsetDeg: finite(tier.azimuthOffsetDeg, 0),
    wireId: typeof tier.wireId === 'string' && tier.wireId ? tier.wireId : DEFAULT_GUY_WIRE_ID,
  }
}

function createTierCard(tier, index) {
  const card = element('article', 'guy-editor-tier')
  card.dataset.tierId = tier.id
  const title = element('h4', '', `Ярус ${index + 1}`)

  const height = numberInput(tier.heightM, { min: 0.1, step: 0.1 })
  height.dataset.field = 'heightM'
  const guyCount = selectInput([3, 4, 5, 6], tier.guyCount)
  guyCount.dataset.field = 'guyCount'
  const anchor = numberInput(tier.anchorRadiusM, { min: 0.1, step: 0.1 })
  anchor.dataset.field = 'anchorRadiusM'
  const pretension = numberInput(tier.pretensionN / 1000, { min: 0, step: 0.1 })
  pretension.dataset.field = 'pretensionKn'
  const azimuth = numberInput(tier.azimuthOffsetDeg, { step: 5 })
  azimuth.dataset.field = 'azimuthOffsetDeg'
  const wire = selectInput(
    GUY_WIRE_CATALOG.map((item) => item.id),
    tier.wireId,
    (id) => GUY_WIRE_CATALOG.find((item) => item.id === id)?.label ?? id,
  )
  wire.dataset.field = 'wireId'

  const grid = element('div', 'guy-editor-tier-grid')
  grid.append(
    labeledControl('Высота, м', height),
    labeledControl('Растяжек', guyCount),
    labeledControl('Анкер от оси, м', anchor),
    labeledControl('Преднатяг, кН', pretension),
    labeledControl('Поворот анкеров, °', azimuth),
    labeledControl('Трос', wire),
  )
  card.append(title, grid)
  return card
}

function tierValue(card, field) {
  return card.querySelector(`[data-field="${field}"]`)
}

export function initializeGuyEditor(form) {
  if (singleton) return singleton
  if (!form) throw new Error('Guy editor requires the canonical project form')

  const details = element('details', 'input-details guy-editor')
  details.id = 'guy-input-details'
  details.open = false
  const summary = element('summary', '', 'Растяжки — отключены')
  const intro = element('p', 'hint practical-note', 'Растяжки являются частью того же project/v1. При включении основной расчёт дополнительно выполняет нелинейный tension-only cable analysis; отдельная форма мачты не используется.')

  const enabled = document.createElement('input')
  enabled.type = 'checkbox'
  enabled.id = 'guys-enabled'
  const enabledLabel = element('label', 'checkbox guy-editor-enabled')
  enabledLabel.append(enabled, document.createTextNode(' Учитывать растяжки в этом проекте'))

  const globalGrid = element('div', 'form-grid guy-editor-global')
  const tierCount = numberInput(2, { min: 1, max: 8, step: 1 })
  tierCount.id = 'guy-tier-count'
  const safety = numberInput(3, { min: 1, step: 0.25 })
  safety.id = 'guy-safety-factor'
  const termination = numberInput(0.8, { min: 0.1, max: 1, step: 0.05 })
  termination.id = 'guy-termination-efficiency'
  globalGrid.append(
    labeledControl('Ярусов', tierCount),
    labeledControl('Запас троса', safety),
    labeledControl('Эффективность заделки', termination),
  )

  const tiers = element('div', 'guy-editor-tiers')
  tiers.id = 'guy-tiers-editor'
  const note = element('p', 'hint practical-note', 'Высота яруса привязывается расчётом к ближайшему реальному уровню модулей. Длины, углы, натяжения и реакции являются результатом и в project package не сохраняются.')

  details.append(summary, intro, enabledLabel, globalGrid, tiers, note)
  const advanced = form.querySelector('.advanced-inputs')
  if (advanced) form.insertBefore(details, advanced)
  else form.append(details)

  const listeners = new Set()
  const notify = () => {
    summary.textContent = enabled.checked ? `Растяжки — включены, ${tierCount.value} ярус(а)` : 'Растяжки — отключены'
    globalGrid.hidden = !enabled.checked
    tiers.hidden = !enabled.checked
    note.hidden = !enabled.checked
    for (const listener of listeners) listener(api)
  }

  function currentTierDrafts() {
    return [...tiers.querySelectorAll('.guy-editor-tier')].map((card, index) => ({
      id: card.dataset.tierId || `web-tier-${index + 1}`,
      heightM: finite(tierValue(card, 'heightM')?.value, 0),
      guyCount: Math.round(finite(tierValue(card, 'guyCount')?.value, 3)),
      anchorRadiusM: finite(tierValue(card, 'anchorRadiusM')?.value, 0),
      pretensionN: finite(tierValue(card, 'pretensionKn')?.value, 0) * 1000,
      azimuthOffsetDeg: finite(tierValue(card, 'azimuthOffsetDeg')?.value, 0),
      wireId: tierValue(card, 'wireId')?.value || DEFAULT_GUY_WIRE_ID,
    }))
  }

  function rebuild(count, presets = currentTierDrafts()) {
    const normalizedCount = Math.max(1, Math.min(8, Math.round(finite(count, 1))))
    tierCount.value = String(normalizedCount)
    const normalized = Array.from({ length: normalizedCount }, (_, index) => normalizedTierInput(
      presets[index],
      index,
      normalizedCount,
      form,
    ))
    tiers.replaceChildren(...normalized.map(createTierCard))
    notify()
  }

  function read() {
    if (!enabled.checked) return undefined
    const value = {
      tiers: currentTierDrafts().map((tier, index) => {
        if (!(tier.heightM > 0)) throw new Error(`Растяжки: высота яруса ${index + 1} должна быть > 0`)
        if (!(tier.anchorRadiusM > 0)) throw new Error(`Растяжки: расстояние до анкера яруса ${index + 1} должно быть > 0`)
        if (tier.guyCount < 3 || tier.guyCount > 6) throw new Error(`Растяжки: число тросов яруса ${index + 1} должно быть 3…6`)
        if (tier.pretensionN < 0) throw new Error(`Растяжки: преднатяг яруса ${index + 1} не может быть отрицательным`)
        return Object.freeze({ ...tier })
      }),
      safetyFactor: finite(safety.value, 3),
      terminationEfficiency: finite(termination.value, 0.8),
    }
    if (!(value.safetyFactor > 0)) throw new Error('Растяжки: коэффициент запаса должен быть > 0')
    if (!(value.terminationEfficiency > 0 && value.terminationEfficiency <= 1)) {
      throw new Error('Растяжки: эффективность заделки должна быть в диапазоне (0, 1]')
    }
    return Object.freeze({
      tiers: Object.freeze(value.tiers),
      safetyFactor: value.safetyFactor,
      terminationEfficiency: value.terminationEfficiency,
    })
  }

  function apply(value) {
    const hasGuys = Boolean(value?.tiers?.length)
    enabled.checked = hasGuys
    safety.value = String(finite(value?.safetyFactor, 3))
    termination.value = String(finite(value?.terminationEfficiency, 0.8))
    rebuild(hasGuys ? value.tiers.length : 2, hasGuys ? value.tiers : [])
    details.open = hasGuys
    notify()
  }

  const api = Object.freeze({
    element: details,
    get enabled() { return enabled.checked },
    read,
    apply,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  singleton = api

  tierCount.addEventListener('change', () => rebuild(tierCount.value))
  enabled.addEventListener('change', notify)
  details.addEventListener('change', (event) => {
    if (event.target === enabled || event.target === tierCount) return
    notify()
  })

  apply(undefined)
  return api
}

export function getGuyEditor() {
  return singleton
}
