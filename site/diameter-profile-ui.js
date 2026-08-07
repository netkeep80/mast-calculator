import { STANDARD_DIAMETERS_MM } from './engine/catalog.js'
import {
  buildDiameterTiers,
  diameterProfileSummary,
  resolveModuleDiameters,
} from './engine/diameter-profile.js'

function optionForDiameter(diameter) {
  const option = document.createElement('option')
  option.value = String(diameter)
  option.textContent = `Ø${diameter} мм`
  return option
}

function installProfileUi() {
  if (typeof document === 'undefined') return null
  const form = document.querySelector('#parameters-form')
  const essentialGrid = form?.querySelector('.essential-grid')
  const moduleCountInput = form?.elements?.namedItem('moduleCount')
  const uniformDiameterInput = form?.elements?.namedItem('barDiameterMm')
  if (!form || !essentialGrid || !moduleCountInput || !uniformDiameterInput) return null
  if (document.querySelector('#diameter-profile-details')) return globalThis.__mastDiameterProfileUi ?? null

  const details = document.createElement('details')
  details.id = 'diameter-profile-details'
  details.className = 'input-details'
  const summary = document.createElement('summary')
  summary.textContent = 'Диаметры арматуры по ярусам — экономия материала и парусности'

  const intro = document.createElement('p')
  intro.className = 'hint practical-note'
  intro.textContent = 'Модули нумеруются снизу вверх: модуль 1 стоит на фундаменте. В смешанном режиме каждое из 9 рёбер физического модуля получает выбранный диаметр. Класс стали и длина ребра пока остаются общими для всей мачты.'

  const modeLabel = document.createElement('label')
  modeLabel.textContent = 'Режим диаметров '
  const mode = document.createElement('select')
  mode.id = 'diameter-profile-mode'
  mode.name = 'diameterProfileMode'
  for (const [value, label] of [
    ['uniform', 'Один диаметр для всех модулей'],
    ['mixed', 'Разные диаметры по модулям'],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    mode.append(option)
  }
  modeLabel.append(mode)

  const profileSummary = document.createElement('p')
  profileSummary.id = 'diameter-profile-summary'
  profileSummary.className = 'hint practical-note'

  const rows = document.createElement('div')
  rows.id = 'diameter-profile-rows'
  rows.className = 'form-grid advanced-grid'

  const resultSummary = document.createElement('p')
  resultSummary.id = 'diameter-profile-result'
  resultSummary.className = 'hint practical-note'

  details.append(summary, intro, modeLabel, profileSummary, rows, resultSummary)
  essentialGrid.after(details)

  let storedDiameters = []

  function moduleCount() {
    return Math.max(1, Math.floor(Number(moduleCountInput.value) || 1))
  }

  function uniformDiameter() {
    const value = Number(uniformDiameterInput.value)
    return Number.isFinite(value) && value > 0 ? value : 12
  }

  function selectedDiameters() {
    if (mode.value === 'uniform') return Array(moduleCount()).fill(uniformDiameter())
    const selects = [...rows.querySelectorAll('select[data-module-index]')]
    return Array.from({ length: moduleCount() }, (_, index) => {
      const value = Number(selects[index]?.value ?? storedDiameters[index] ?? storedDiameters.at(-1) ?? uniformDiameter())
      return Number.isFinite(value) && value > 0 ? value : uniformDiameter()
    })
  }

  function updateSummary() {
    const diameters = selectedDiameters()
    storedDiameters = [...diameters]
    profileSummary.textContent = mode.value === 'uniform'
      ? `Все ${diameters.length} модулей: Ø${diameters[0]} мм.`
      : `Снизу вверх: ${diameterProfileSummary(diameters)}.`
  }

  function rebuildRows(preferred = storedDiameters) {
    const count = moduleCount()
    const fallback = preferred.at(-1) ?? uniformDiameter()
    const next = Array.from({ length: count }, (_, index) => Number(preferred[index] ?? fallback))
    storedDiameters = next
    rows.replaceChildren(...next.map((diameter, index) => {
      const label = document.createElement('label')
      label.textContent = `Модуль ${index + 1}${index === 0 ? ' · нижний' : index === count - 1 ? ' · верхний' : ''}`
      const select = document.createElement('select')
      select.dataset.moduleIndex = String(index)
      select.replaceChildren(...STANDARD_DIAMETERS_MM.map(optionForDiameter))
      select.value = STANDARD_DIAMETERS_MM.includes(diameter) ? String(diameter) : String(uniformDiameter())
      select.disabled = mode.value !== 'mixed'
      select.addEventListener('change', updateSummary)
      label.append(select)
      return label
    }))
    updateSummary()
  }

  function syncMode() {
    const mixed = mode.value === 'mixed'
    details.open = mixed
    uniformDiameterInput.disabled = false
    for (const select of rows.querySelectorAll('select[data-module-index]')) select.disabled = !mixed
    updateSummary()
  }

  function readParameters() {
    if (mode.value !== 'mixed') return {}
    return { moduleDiametersMm: selectedDiameters() }
  }

  function synchronizeFromResult(result) {
    const diameters = result?.model?.moduleDiametersMm
      ?? result?.model?.modules?.map((module) => module.diameterMm)
      ?? (result?.parameters ? resolveModuleDiameters(result.parameters) : [])
    if (!diameters.length) return
    const unique = new Set(diameters.map(Number))
    mode.value = unique.size > 1 ? 'mixed' : 'uniform'
    if (unique.size === 1 && STANDARD_DIAMETERS_MM.includes(Number(diameters[0]))) {
      uniformDiameterInput.value = String(diameters[0])
    }
    rebuildRows(diameters)
    syncMode()

    const tiers = buildDiameterTiers(diameters)
    const mass = result?.assemblyMass?.mastFabricationEstimate
    const massText = mass?.savingsVsUniformMaximumDiameterKg > 1e-9
      ? ` Оценочная экономия изготовленной мачты относительно всех модулей Ø${Math.max(...diameters)}: ${mass.savingsVsUniformMaximumDiameterKg.toFixed(1)} кг.`
      : ''
    resultSummary.textContent = `Рассчитанный профиль: ${tiers.map((tier) => `${tier.fromModule === tier.toModule ? tier.fromModule : `${tier.fromModule}–${tier.toModule}`} → Ø${tier.diameterMm}`).join('; ')}.${massText}`
  }

  mode.addEventListener('change', syncMode)
  moduleCountInput.addEventListener('change', () => rebuildRows(selectedDiameters()))
  moduleCountInput.addEventListener('input', () => rebuildRows(selectedDiameters()))
  uniformDiameterInput.addEventListener('change', () => {
    if (mode.value === 'uniform') rebuildRows(Array(moduleCount()).fill(uniformDiameter()))
    else updateSummary()
  })

  rebuildRows(Array(moduleCount()).fill(uniformDiameter()))
  syncMode()

  const api = {
    readParameters,
    synchronizeFromResult,
    selectedDiameters,
    maximumDiameterMm: () => Math.max(...selectedDiameters()),
  }
  globalThis.__mastDiameterProfileUi = api
  return api
}

const profileUi = installProfileUi()

// app-bootstrap.js wraps Worker later to inject joint parameters. Installing
// this wrapper while its dependency graph is evaluated makes the two wrappers
// compose: mixed diameters are added/removed at the final postMessage boundary.
if (profileUi && typeof globalThis.Worker === 'function' && !globalThis.__mastDiameterProfileWorkerInstalled) {
  const NativeWorker = globalThis.Worker
  class DiameterProfileWorker extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      this.addEventListener('message', (event) => {
        if (event.data?.type === 'result' && event.data?.result) {
          profileUi.synchronizeFromResult(event.data.result)
        }
      })
    }

    postMessage(message, transfer) {
      let outgoing = message
      if (message?.parameters) {
        const { moduleDiametersMm: _oldProfile, ...baseParameters } = message.parameters
        const profileParameters = message.action === 'optimize' ? {} : profileUi.readParameters()
        outgoing = {
          ...message,
          parameters: { ...baseParameters, ...profileParameters },
        }
      }
      if (transfer === undefined) super.postMessage(outgoing)
      else super.postMessage(outgoing, transfer)
    }
  }
  globalThis.Worker = DiameterProfileWorker
  globalThis.__mastDiameterProfileWorkerInstalled = true
}
