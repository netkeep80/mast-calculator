import {
  createDesignPackage,
  createProcurementEstimateFromCalculation,
} from '../../packages/application/index.js'
import {
  createMastObj,
  createProcurementEstimateHtml,
  designResultFromPackage,
  serializeDesignPackage,
} from '../../packages/design/index.js'
import { createEskdConstructionDocumentationHtml } from '../../packages/reporting/index.js'
import { fileAdapter } from './file-adapter.js'
import { subscribeCalculationResult } from './result-channel.js'

const $ = (selector, root = document) => root.querySelector(selector)

let initialized = false
let currentSnapshot = null
let currentBuildInfo = {
  repository: 'netkeep80/mast-calculator',
  ref: 'local',
  sha: 'development',
  runId: 'local',
}

const ARTIFACTS = Object.freeze([
  { id: 'project', title: 'Project package', source: 'ProjectInput + ProjectGuysInput', schema: 'mast-calculator/project/v1' },
  { id: 'report', title: 'Расчётный отчёт', source: 'CalculationResult', schema: 'HTML' },
  { id: 'csv', title: 'Ведомость рёбер', source: 'CalculationResult', schema: 'CSV' },
  { id: 'design', title: 'Design package', source: 'CalculationResult → design projection', schema: 'mast-calculator/design-package/v1' },
  { id: 'obj', title: 'OBJ', source: 'design-package/v1 geometry', schema: 'Wavefront OBJ' },
  { id: 'eskd', title: 'КД / ЕСКД', source: 'design-package/v1 geometry', schema: 'HTML' },
  { id: 'procurement', title: 'Закупочная смета', source: 'CalculationResult + optional GuyedResult', schema: 'HTML' },
])

function makeElement(tag, className = '', text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function filenameBase(result) {
  const modules = Number(result?.model?.moduleCount ?? result?.parameters?.moduleCount ?? 0) || 'mast'
  const rib = Number(result?.parameters?.ribCutLengthMm)
  return `mast-${modules}x${Number.isFinite(rib) ? `-${Math.round(rib)}mm` : ''}`
}

function sourceText(definition) {
  return `${definition.source} · ${definition.schema}`
}

function cardFor(definition) {
  const card = makeElement('article', 'artifact-card')
  card.dataset.artifact = definition.id
  const heading = makeElement('div', 'artifact-card-heading')
  heading.append(
    makeElement('strong', '', definition.title),
    makeElement('span', 'artifact-status', definition.id === 'project' ? 'всегда доступен' : 'нужен расчёт'),
  )
  const source = makeElement('p', 'artifact-source', sourceText(definition))
  const actions = makeElement('div', 'artifact-actions')
  actions.dataset.artifactActions = definition.id
  card.append(heading, source, actions)
  return card
}

function statusFor(id) {
  return $(`[data-artifact="${id}"] .artifact-status`)
}

function setArtifactStatus(id, text, state = 'neutral') {
  const target = statusFor(id)
  if (!target) return
  target.textContent = text
  target.dataset.state = state
}

function reportError(message) {
  const target = $('#reports-export-status')
  if (!target) return
  target.textContent = message
  target.dataset.state = 'error'
  target.hidden = false
}

function reportSuccess(message) {
  const target = $('#reports-export-status')
  if (!target) return
  target.textContent = message
  target.dataset.state = 'success'
  target.hidden = false
}

function createAction(id, label, title) {
  const button = makeElement('button', 'secondary artifact-action', label)
  button.type = 'button'
  button.id = id
  button.title = title
  button.disabled = true
  return button
}

async function saveText(options, successMessage) {
  const saved = await fileAdapter.saveText(options)
  if (saved) reportSuccess(`${successMessage}${saved.path ? `: ${saved.path}` : ''}`)
  return saved
}

function designArtifacts(result) {
  const createdAt = new Date().toISOString()
  const designPackage = createDesignPackage(result, {
    createdAt,
    repository: currentBuildInfo.repository,
    ref: currentBuildInfo.ref,
    sha: currentBuildInfo.sha,
  })
  const designResult = designResultFromPackage(designPackage)
  const eskdHtml = createEskdConstructionDocumentationHtml(designResult, {
    source: designPackage.source?.sha
      ? `${designPackage.source.repository ?? 'mast-calculator'}@${designPackage.source.sha}`
      : designPackage.source?.repository ?? 'mast-calculator',
  })
  return Object.freeze({ designPackage, designResult, eskdHtml })
}

function attachExistingAction(button, artifactId, label = null) {
  const actions = $(`[data-artifact-actions="${artifactId}"]`)
  if (!actions || !button) return
  if (label) button.textContent = label
  button.classList.add('artifact-action')
  actions.append(button)
}

function projectActionProxy(sourceId, label) {
  const button = createAction(`reports-${sourceId}`, label, 'Тот же project/v1 action из верхней панели')
  button.disabled = false
  button.addEventListener('click', () => document.querySelector(`#${sourceId}`)?.click())
  return button
}

function installProjectPackageCard() {
  const actions = $('[data-artifact-actions="project"]')
  if (!actions) return
  actions.append(
    projectActionProxy('open-project-package-button', 'Открыть project/v1'),
    projectActionProxy('export-project-package-button', 'Сохранить project/v1'),
  )
  const status = $('#project-package-status')
  if (status) {
    const observer = new MutationObserver(() => {
      if (!status.hidden && status.textContent) {
        const target = $('#reports-project-status')
        if (target) target.textContent = status.textContent
      }
    })
    observer.observe(status, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  }
}

function installResultArtifacts() {
  const reportButton = $('#export-note-button')
  const csvButton = $('#export-csv-button')
  attachExistingAction(reportButton, 'report', 'Сохранить расчётный отчёт')
  attachExistingAction(csvButton, 'csv', 'Сохранить CSV рёбер')

  const designButton = createAction('export-design-package-button', 'Сохранить design-package/v1', 'Версионированная геометрия для 3D/КД')
  const objButton = createAction('export-design-obj-button', 'Сохранить OBJ', 'OBJ из той же design-package геометрии')
  const eskdButton = createAction('export-design-eskd-button', 'Сохранить КД / ЕСКД', 'Комплект КД из той же design-package геометрии')
  const previewButton = createAction('preview-design-eskd-button', 'Предпросмотр КД', 'Показать текущую КД без нового FEM расчёта')
  const procurementButton = createAction('export-procurement-button', 'Сохранить закупочную смету', 'Учитывает current GuyedResult, если растяжки включены')

  $('[data-artifact-actions="design"]')?.append(designButton)
  $('[data-artifact-actions="obj"]')?.append(objButton)
  $('[data-artifact-actions="eskd"]')?.append(eskdButton, previewButton)
  $('[data-artifact-actions="procurement"]')?.append(procurementButton)

  designButton.addEventListener('click', async () => {
    const result = currentSnapshot?.result
    if (!result) return
    try {
      const artifacts = designArtifacts(result)
      await saveText({
        suggestedName: `${filenameBase(result)}-design.json`,
        content: serializeDesignPackage(artifacts.designPackage),
        mediaType: 'application/json;charset=utf-8',
        extensions: ['json'],
      }, 'Сохранён design-package/v1')
    } catch (error) {
      reportError(`Не удалось сохранить design-package: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  objButton.addEventListener('click', async () => {
    const result = currentSnapshot?.result
    if (!result) return
    try {
      const artifacts = designArtifacts(result)
      await saveText({
        suggestedName: `${filenameBase(result)}.obj`,
        content: createMastObj(artifacts.designResult),
        mediaType: 'text/plain;charset=utf-8',
        extensions: ['obj'],
      }, 'Сохранён OBJ')
    } catch (error) {
      reportError(`Не удалось сохранить OBJ: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  eskdButton.addEventListener('click', async () => {
    const result = currentSnapshot?.result
    if (!result) return
    try {
      const artifacts = designArtifacts(result)
      await saveText({
        suggestedName: `${filenameBase(result)}-eskd.html`,
        content: artifacts.eskdHtml,
        mediaType: 'text/html;charset=utf-8',
        extensions: ['html'],
      }, 'Сохранена КД / ЕСКД')
    } catch (error) {
      reportError(`Не удалось сохранить КД: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  previewButton.addEventListener('click', () => {
    const result = currentSnapshot?.result
    const preview = $('#reports-eskd-preview')
    if (!result || !preview) return
    try {
      preview.srcdoc = designArtifacts(result).eskdHtml
      preview.hidden = false
      reportSuccess('Предпросмотр КД построен из текущего design-package без повторного FEM.')
    } catch (error) {
      reportError(`Не удалось построить предпросмотр КД: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  procurementButton.addEventListener('click', async () => {
    const result = currentSnapshot?.result
    if (!result) return
    try {
      const estimate = createProcurementEstimateFromCalculation(result, {
        guyedResult: currentSnapshot?.guyResult ?? null,
      })
      const html = createProcurementEstimateHtml(estimate, new Date().toISOString())
      await saveText({
        suggestedName: `${filenameBase(result)}-procurement.html`,
        content: html,
        mediaType: 'text/html;charset=utf-8',
        extensions: ['html'],
      }, 'Сохранена закупочная смета')
    } catch (error) {
      reportError(`Не удалось сохранить смету: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return { designButton, objButton, eskdButton, previewButton, procurementButton }
}

function updateAvailability(snapshot, controls) {
  const ready = Boolean(snapshot?.result)
  for (const button of Object.values(controls)) button.disabled = !ready
  for (const id of ['report', 'csv', 'design', 'obj', 'eskd', 'procurement']) {
    setArtifactStatus(id, ready ? 'готов' : 'нужен расчёт', ready ? 'ready' : 'neutral')
  }
  if (ready && snapshot?.guyResult) {
    setArtifactStatus('procurement', 'готов · включает растяжки', 'ready')
  }
}

function createWorkspace(panel) {
  panel.replaceChildren()
  const intro = makeElement('div', 'reports-heading')
  intro.append(
    makeElement('h3', '', 'Reports & Exports'),
    makeElement('p', 'result-tab-note', 'Все артефакты строятся из текущего проекта и текущего результата. Экспорт не запускает FEM повторно и не создаёт вторую design geometry.'),
  )
  const status = makeElement('p', 'reports-export-status')
  status.id = 'reports-export-status'
  status.hidden = true
  const projectStatus = makeElement('p', 'artifact-project-status')
  projectStatus.id = 'reports-project-status'
  projectStatus.textContent = 'ProjectInput редактируется в левой панели; Open/Save используют тот же project/v1 contract.'
  const grid = makeElement('div', 'artifact-grid')
  grid.append(...ARTIFACTS.map(cardFor))
  const preview = document.createElement('iframe')
  preview.id = 'reports-eskd-preview'
  preview.className = 'reports-eskd-preview'
  preview.title = 'Предпросмотр конструкторской документации'
  preview.hidden = true
  panel.append(intro, status, projectStatus, grid, preview)
}

export async function initializeReportsExports(panel = document.querySelector('#result-panel-reports')) {
  if (initialized || !panel || typeof document === 'undefined') return
  initialized = true
  createWorkspace(panel)
  installProjectPackageCard()
  const controls = installResultArtifacts()

  try {
    const response = await fetch('./build-info.json', { cache: 'no-store' })
    if (response.ok) currentBuildInfo = { ...currentBuildInfo, ...await response.json() }
  } catch {}

  subscribeCalculationResult((snapshot) => {
    currentSnapshot = snapshot
    updateAvailability(snapshot, controls)
  }, { replay: true })
}
