import {
  designResultFromPackage,
  loadDesignPackage,
  parseDesignPackage,
  saveDesignPackage,
  serializeDesignPackage,
} from './engine/design-package.js'
import { createEskdConstructionDocumentationHtml } from './engine/eskd-construction-documentation.js'
import { createMastObj } from './engine/obj-export.js'
import { JointViewer } from './joint-viewer.js'
import { MastViewer } from './viewer.js'

const $ = (selector) => document.querySelector(selector)
const sourceSummary = $('#source-summary')
const sourceError = $('#source-error')
const emptyState = $('#empty-state')
const workspace = $('#workspace')
const kdSection = $('#kd-section')
const moduleSelector = $('#module-selector')
const packageFile = $('#package-file')
const exportPackageButton = $('#export-package')
const exportObjButton = $('#export-obj')
const exportEskdButton = $('#export-eskd')
const kdPreview = $('#kd-preview')

let currentPackage = null
let currentResult = null
let currentEskdHtml = ''

const mastViewer = new MastViewer($('#mast-canvas'), {
  onModuleSelect: (moduleIndex) => {
    moduleSelector.value = String(moduleIndex)
  },
})
const jointViewer = new JointViewer($('#joint-canvas'))

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(value))
  : '—'

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function filenameBase(result) {
  const modules = Number(result?.model?.moduleCount ?? result?.parameters?.moduleCount ?? 0) || 'mast'
  const rib = Number(result?.parameters?.ribCutLengthMm)
  return `mast-${modules}x${Number.isFinite(rib) ? `-${Math.round(rib)}mm` : ''}`
}

function jointConfiguration(result) {
  const geometry = result?.connections?.configurator?.geometry
    ?? result?.connections?.geometry
    ?? result?.connections?.resolvedGeometry
  if (!geometry) return null
  const diameters = result.model.members
    .map((member) => Number(member.diameterM) * 1000)
    .filter((value) => Number.isFinite(value) && value > 0)
  return {
    geometry,
    barDiameterMm: diameters.length ? Math.max(...diameters) : Number(result.parameters?.barDiameterMm ?? 12),
    weldPhysicalLengthMm: Number(result.connections?.weld?.critical?.check?.requiredPhysicalLengthMm ?? 0),
  }
}

function fillModuleSelector(result) {
  moduleSelector.replaceChildren(...result.model.modules.map((module) => {
    const option = document.createElement('option')
    option.value = String(module.index)
    option.textContent = `Модуль ${module.number}${module.index === 0 ? ' · нижний' : module.index === result.model.moduleCount - 1 ? ' · верхний' : ''}`
    return option
  }))
  moduleSelector.value = '0'
}

function renderStats(result) {
  $('#stat-modules').textContent = String(result.model.moduleCount)
  $('#stat-members').textContent = String(result.model.members.length)
  $('#stat-height').textContent = `${format(result.model.moduleCount * result.parameters.moduleHeightMm / 1000, 3)} м`
  $('#stat-mass').textContent = `${format(result.assemblyMass?.mastFabricationEstimate?.uniformModulesMassKg, 1)} кг`
}

function renderJointSummary(configuration, result) {
  const target = $('#joint-summary')
  if (!configuration?.geometry) {
    target.textContent = 'Для конструкции отсутствует выбранная геометрия межмодульного узла.'
    return
  }
  const geometry = configuration.geometry
  target.textContent = `Болт M${geometry.bolt.diameterMm}×${format(geometry.bolt.lengthMm, 0)}, класс ${result.connections?.configurator?.selected?.boltClass ?? result.parameters?.jointBoltClass ?? '—'}; проходная гайка M${geometry.bottomClearanceNut.threadDiameterMm}; длинная M${geometry.topCouplingNut.threadDiameterMm}×${format(geometry.topCouplingNut.lengthMm, 0)}; зацепление ${format(geometry.threadEngagementMm, 1)} мм.`
}

function setReady(ready) {
  emptyState.classList.toggle('hidden', ready)
  workspace.classList.toggle('hidden', !ready)
  kdSection.classList.toggle('hidden', !ready)
  exportPackageButton.disabled = !ready
  exportObjButton.disabled = !ready
  exportEskdButton.disabled = !ready
}

function showError(message) {
  sourceError.textContent = message
  sourceError.classList.remove('hidden')
}

function clearError() {
  sourceError.textContent = ''
  sourceError.classList.add('hidden')
}

function applyPackage(designPackage, { persist = false } = {}) {
  clearError()
  const result = designResultFromPackage(designPackage)
  currentPackage = designPackage
  currentResult = result
  if (persist) saveDesignPackage(designPackage)

  mastViewer.setResult(result)
  mastViewer.setSelectedModule(0)
  fillModuleSelector(result)
  const configuration = jointConfiguration(result)
  jointViewer.setConfiguration(configuration)
  renderJointSummary(configuration, result)
  renderStats(result)

  currentEskdHtml = createEskdConstructionDocumentationHtml(result, {
    source: designPackage.source?.sha
      ? `${designPackage.source.repository ?? 'mast-calculator'}@${designPackage.source.sha}`
      : designPackage.source?.repository ?? 'mast-calculator',
  })
  kdPreview.srcdoc = currentEskdHtml
  sourceSummary.textContent = `${result.model.moduleCount} модулей; ребро ${format(result.parameters.ribCutLengthMm, 1)} мм; ${result.parameters.reinforcementClass}; пакет ${designPackage.schema}; сформирован ${new Date(designPackage.createdAt).toLocaleString('ru-RU')}.`
  setReady(true)
}

moduleSelector.addEventListener('change', () => {
  mastViewer.setSelectedModule(Number(moduleSelector.value))
})

packageFile.addEventListener('change', async () => {
  const file = packageFile.files?.[0]
  if (!file) return
  try {
    const designPackage = parseDesignPackage(await file.text())
    applyPackage(designPackage, { persist: true })
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  } finally {
    packageFile.value = ''
  }
})

exportPackageButton.addEventListener('click', () => {
  if (!currentPackage || !currentResult) return
  downloadText(`${filenameBase(currentResult)}-design.json`, serializeDesignPackage(currentPackage), 'application/json;charset=utf-8')
})

exportObjButton.addEventListener('click', () => {
  if (!currentResult) return
  try {
    downloadText(`${filenameBase(currentResult)}.obj`, createMastObj(currentResult), 'text/plain;charset=utf-8')
  } catch (error) {
    showError(`Не удалось сформировать OBJ: ${error instanceof Error ? error.message : String(error)}`)
  }
})

exportEskdButton.addEventListener('click', () => {
  if (!currentResult || !currentEskdHtml) return
  downloadText(`${filenameBase(currentResult)}-eskd.html`, currentEskdHtml, 'text/html;charset=utf-8')
})

try {
  const saved = loadDesignPackage()
  if (saved) applyPackage(saved)
  else {
    sourceSummary.textContent = 'Последний расчёт ещё не передан в модуль 3D/КД.'
    setReady(false)
  }
} catch (error) {
  sourceSummary.textContent = 'Последний сохранённый пакет повреждён или имеет старую схему.'
  showError(error instanceof Error ? error.message : String(error))
  setReady(false)
}
