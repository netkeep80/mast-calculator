import './guy-result-panel.js'
import { renderGuyedConnectionProjection } from './guyed-connection-panel.js'
import { renderWindActionProvenance } from './wind-action-result.js'
import { subscribeCalculationResult } from './result-channel.js'

const TAB_DEFINITIONS = Object.freeze([
  { id: 'summary', label: 'Сводка' },
  { id: 'limits', label: 'Пределы' },
  { id: 'connections', label: 'Соединения' },
  { id: 'guys', label: 'Растяжки', conditional: true },
  { id: 'verification', label: 'Верификация' },
  { id: 'reports', label: 'Отчёты и экспорт' },
])

const SCENARIO_TAB = Object.freeze({
  check: 'summary',
  design: 'connections',
  limits: 'limits',
  verify: 'verification',
})

let initialized = false
let currentSnapshot = null
let activeTabId = 'summary'
const tabButtons = new Map()
const tabPanels = new Map()

const $ = (selector, root = document) => root.querySelector(selector)

function makeElement(tag, className = '', text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function selectableTabs() {
  return TAB_DEFINITIONS
    .map(({ id }) => tabButtons.get(id))
    .filter((button) => button && !button.hidden && !button.disabled)
}

function activateTab(id, { focus = false } = {}) {
  const button = tabButtons.get(id)
  if (!button || button.hidden || button.disabled) return false
  activeTabId = id
  for (const definition of TAB_DEFINITIONS) {
    const tab = tabButtons.get(definition.id)
    const panel = tabPanels.get(definition.id)
    const selected = definition.id === id
    if (tab) {
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
      tab.tabIndex = selected ? 0 : -1
    }
    if (panel) panel.hidden = !selected
  }
  if (focus) button.focus()
  return true
}

function handleTabKeydown(event) {
  const available = selectableTabs()
  const current = available.indexOf(event.currentTarget)
  if (current < 0) return
  let next = null
  if (event.key === 'ArrowRight') next = available[(current + 1) % available.length]
  else if (event.key === 'ArrowLeft') next = available[(current - 1 + available.length) % available.length]
  else if (event.key === 'Home') next = available[0]
  else if (event.key === 'End') next = available.at(-1)
  if (!next) return
  event.preventDefault()
  activateTab(next.dataset.resultTab, { focus: true })
}

function createTabWorkspace(results) {
  const tabList = makeElement('div', 'result-tablist')
  tabList.setAttribute('role', 'tablist')
  tabList.setAttribute('aria-label', 'Раздел результата')

  for (const definition of TAB_DEFINITIONS) {
    const button = makeElement('button', 'result-tab', definition.label)
    button.type = 'button'
    button.id = `result-tab-${definition.id}`
    button.dataset.resultTab = definition.id
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', `result-panel-${definition.id}`)
    button.setAttribute('aria-selected', definition.id === activeTabId ? 'true' : 'false')
    button.tabIndex = definition.id === activeTabId ? 0 : -1
    if (definition.conditional) {
      button.hidden = true
      button.disabled = true
      button.setAttribute('aria-disabled', 'true')
    }
    button.addEventListener('click', () => activateTab(definition.id))
    button.addEventListener('keydown', handleTabKeydown)
    tabButtons.set(definition.id, button)
    tabList.append(button)

    const panel = makeElement('section', 'result-tabpanel')
    panel.id = `result-panel-${definition.id}`
    panel.dataset.resultPanel = definition.id
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', button.id)
    panel.tabIndex = 0
    panel.hidden = definition.id !== activeTabId
    tabPanels.set(definition.id, panel)
  }

  const summary = tabPanels.get('summary')
  const limits = tabPanels.get('limits')
  const connections = tabPanels.get('connections')
  const verification = tabPanels.get('verification')
  const reports = tabPanels.get('reports')

  const assembly = $('.assembly-mass-card', results)
  const allMetrics = $('#all-metrics-details', results)
  const governing = $('#governing-details', results)
  const connectionSummary = $('#connection-summary-card', results)
  const verificationSummary = $('#verification-summary-card', results)
  const loadSummary = $('#load-summary', results)
  const exportRow = $('.export-row', results)
  const verificationDetails = $('#verification-details', results)
  const connectionDetails = $('#connection-details', results)
  const memberDetails = [...results.querySelectorAll('details')]
    .find((details) => details.querySelector('#member-results-body'))
  const warningsDetails = [...results.querySelectorAll('details')]
    .find((details) => details.querySelector('#warnings'))
  const jointVisual = $('.joint-visual')
  const moduleVisual = $('.module-visual')
  const referencePanel = $('.reference-panel')

  for (const node of [assembly, allMetrics, memberDetails, moduleVisual, loadSummary, warningsDetails]) {
    if (node) summary.append(node)
  }
  if (governing) limits.append(governing)
  for (const node of [connectionSummary, connectionDetails, jointVisual]) {
    if (node) connections.append(node)
  }
  for (const node of [verificationSummary, verificationDetails, referencePanel]) {
    if (node) verification.append(node)
  }
  if (exportRow) reports.append(exportRow)
  const reportsNote = makeElement(
    'p',
    'result-tab-note',
    'Расчётный проект, CSV и комплект 3D/КД используют текущий CalculationResult. Единый экспортный workspace будет расширен в следующем срезе Web UI 2.0.',
  )
  reports.prepend(reportsNote)

  // Preserve any unclassified result child instead of silently dropping legacy content.
  for (const node of [...results.children]) summary.append(node)

  results.classList.add('workspace-result-tabs')
  results.replaceChildren(tabList, ...TAB_DEFINITIONS.map(({ id }) => tabPanels.get(id)))
  activateTab(activeTabId)
}

function requestModuleSelection(moduleIndex) {
  const selector = $('#module-selector')
  if (!selector || !Number.isInteger(moduleIndex)) return false
  const max = Math.max(0, selector.options.length - 1)
  const clamped = Math.max(0, Math.min(max, moduleIndex))
  selector.value = String(clamped)
  selector.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

function makeRowSelectable(row, moduleIndex, label) {
  if (!row || !Number.isInteger(moduleIndex)) return
  row.dataset.moduleIndex = String(moduleIndex)
  row.tabIndex = 0
  row.classList.add('module-selectable-row')
  row.setAttribute('aria-label', label ?? `Показать модуль ${moduleIndex + 1}`)
}

function decorateMemberRows() {
  const body = $('#member-results-body')
  if (!body) return
  for (const row of body.querySelectorAll('tr')) {
    if (row.classList.contains('member-group-row')) {
      const match = row.textContent.match(/Модуль\s+(\d+)/i)
      if (match) makeRowSelectable(row, Number(match[1]) - 1, `Показать модуль ${match[1]}`)
      continue
    }
    const moduleNumber = Number(row.cells?.[0]?.textContent)
    if (Number.isInteger(moduleNumber) && moduleNumber > 0) {
      makeRowSelectable(row, moduleNumber - 1, `Показать модуль ${moduleNumber} для выбранного ребра`)
    }
  }
}

function decorateConnectionRows() {
  const result = currentSnapshot?.result
  if (!result) return
  const boltRows = $('#bolt-recommendations-body')?.querySelectorAll('tr') ?? []
  const recommendations = result.connections?.bolt?.recommendationsByClass ?? []
  ;[...boltRows].forEach((row, index) => {
    const level = recommendations[index]?.recommended?.evaluation?.governingDemand?.level
    if (Number.isInteger(level) && level > 0) {
      makeRowSelectable(row, level - 1, `Показать модуль ${level} у определяющего межмодульного соединения`)
    }
  })

  const weldRows = $('#weld-results-body')?.querySelectorAll('tr') ?? []
  const envelope = result.connections?.weld?.envelope ?? []
  ;[...weldRows].forEach((row, index) => {
    const memberId = envelope[index]?.memberId
    const moduleIndex = Number.isInteger(memberId) ? result.model?.members?.[memberId]?.moduleIndex : null
    if (Number.isInteger(moduleIndex)) {
      makeRowSelectable(row, moduleIndex, `Показать модуль ${moduleIndex + 1} для сварного конца ребра ${memberId}`)
    }
  })
}

function decorateGuyRows() {
  const body = $('#guy-cable-envelope-body')
  const cables = currentSnapshot?.guyResult?.cableEnvelope ?? []
  if (!body) return
  ;[...body.querySelectorAll('tr')].forEach((row, index) => {
    const level = cables[index]?.attachmentLevel
    if (Number.isInteger(level) && level > 0) {
      makeRowSelectable(row, level - 1, `Показать модуль ${level} в уровне крепления растяжки`)
    }
  })
}

function installSelectableTable(bodySelector, decorate) {
  const body = $(bodySelector)
  if (!body) return
  const activateRow = (row) => {
    const moduleIndex = Number(row?.dataset?.moduleIndex)
    if (!Number.isInteger(moduleIndex)) return
    requestModuleSelection(moduleIndex)
    syncSelectedRows()
  }
  body.addEventListener('click', (event) => activateRow(event.target.closest('tr.module-selectable-row')))
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const row = event.target.closest('tr.module-selectable-row')
    if (!row) return
    event.preventDefault()
    activateRow(row)
  })
  const observer = new MutationObserver(() => {
    decorate()
    syncSelectedRows()
  })
  observer.observe(body, { childList: true, subtree: true })
  decorate()
}

function selectedModuleIndex() {
  const selector = $('#module-selector')
  const value = Number(selector?.value)
  return Number.isInteger(value) ? value : 0
}

function syncSelectedRows() {
  const selected = selectedModuleIndex()
  for (const row of document.querySelectorAll('.module-selectable-row')) {
    const active = Number(row.dataset.moduleIndex) === selected
    row.classList.toggle('module-selected-row', active)
    row.setAttribute('aria-current', active ? 'true' : 'false')
  }
}

function syncGuyTab(snapshot) {
  const button = tabButtons.get('guys')
  const panel = tabPanels.get('guys')
  if (!button || !panel) return
  const enabled = Boolean(snapshot?.guyResult)
  button.hidden = !enabled
  button.disabled = !enabled
  button.setAttribute('aria-disabled', enabled ? 'false' : 'true')

  const guyPanel = $('#guy-result-panel')
  if (enabled && guyPanel && guyPanel.parentElement !== panel) panel.append(guyPanel)
  if (!enabled && activeTabId === 'guys') activateTab('summary')
  decorateGuyRows()
}

function installScenarioFocus() {
  document.addEventListener('change', (event) => {
    const radio = event.target.closest?.('input[name="usageScenario"]')
    if (!radio?.checked) return
    const tab = SCENARIO_TAB[radio.value]
    if (tab) activateTab(tab)
  })
}

function installSelectionProjection() {
  installSelectableTable('#member-results-body', decorateMemberRows)
  installSelectableTable('#bolt-recommendations-body', decorateConnectionRows)
  installSelectableTable('#weld-results-body', decorateConnectionRows)

  const title = $('#module-detail-title')
  if (title) new MutationObserver(syncSelectedRows).observe(title, { childList: true, subtree: true })
  $('#module-selector')?.addEventListener('change', syncSelectedRows)
}

export function initializeResultTabs() {
  if (initialized || typeof document === 'undefined') return
  const results = $('#results')
  if (!results || !$('.workspace-details')) return
  initialized = true
  createTabWorkspace(results)
  installScenarioFocus()
  installSelectionProjection()

  subscribeCalculationResult((snapshot) => {
    currentSnapshot = snapshot
    decorateMemberRows()
    decorateConnectionRows()
    syncGuyTab(snapshot)
    renderGuyedConnectionProjection(snapshot)
    renderWindActionProvenance(snapshot)
    const guyBody = $('#guy-cable-envelope-body')
    if (guyBody && !guyBody.dataset.selectionWired) {
      guyBody.dataset.selectionWired = 'true'
      installSelectableTable('#guy-cable-envelope-body', decorateGuyRows)
    }
    queueMicrotask(syncSelectedRows)
  }, { replay: true })
}
