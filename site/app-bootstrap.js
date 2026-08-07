import {
  JOINT_CONFIGURATOR_MODES,
} from './engine/joint-configurator.js'
import {
  buildJointHardwareGeometry,
  clearanceNutOptionsForBolt,
  JOINT_BOLT_LENGTHS_MM,
  THREAD_ENGAGEMENT_FACTORS,
  WELD_LEG_SIZES_MM,
  WELD_SEGMENT_COUNTS,
} from './engine/joint-hardware-catalog.js'
import {
  DEFAULT_NUT_FACTOR,
  DEFAULT_PRELOAD_VARIATION,
  DEFAULT_TIGHTENING_TORQUE_NM,
} from './engine/bolt-preload.js'
import { calculateBoltCapacity } from './engine/bolt-check.js'
import {
  checkJointNutSections,
  DEFAULT_NUT_TO_RIB_AREA_RATIO,
} from './engine/joint-section-check.js'
import {
  DEFAULT_WELD_TO_RIB_AREA_RATIO,
  MAX_WELD_TO_RIB_AREA_RATIO,
  MIN_WELD_TO_RIB_AREA_RATIO,
} from './engine/weld-check.js'
import { JointViewer } from './joint-viewer.js'
import {
  enrichAndRenderUsageResult,
  initializeUsageExperience,
} from './usage-scenarios.js'

const $ = (selector) => document.querySelector(selector)
const form = $('#parameters-form')

function createNumericControl(name, title, attributes = {}) {
  const label = document.createElement('label')
  label.append(document.createTextNode(title))
  const input = document.createElement('input')
  input.name = name
  input.type = 'number'
  for (const [key, value] of Object.entries(attributes)) input.setAttribute(key, String(value))
  label.append(input)
  return label
}

function createSelectControl(name, title) {
  const label = document.createElement('label')
  label.append(document.createTextNode(title))
  const select = document.createElement('select')
  select.name = name
  label.append(select)
  return label
}

function installJointStrengthUi() {
  const grid = document.querySelector('#joint-input-details .joint-form-grid')
  if (grid && !form.elements.namedItem('jointTighteningTorqueNm')) {
    grid.append(
      createNumericControl('jointTighteningTorqueNm', 'Момент затяжки болта, Н·м', { min: 0, step: 10 }),
      createNumericControl('jointNutFactor', 'Коэффициент затяжки K', { min: 0.05, max: 0.5, step: 0.01 }),
      createNumericControl('jointPreloadVariation', 'Разброс преднатяга ±, доля', { min: 0, max: 0.9, step: 0.05 }),
      createSelectControl('jointNutSectionAreaRatio', 'Минимум Anut / Arib'),
      createSelectControl('weldToRibAreaRatio', 'Минимум Aшва / Arib'),
    )
    const note = document.createElement('p')
    note.className = 'hint practical-note'
    note.textContent = 'Затяжка учитывается как преднатяг F0=T/(K·d): увеличение момента уменьшает оставшийся растягивающий резерв болта. Нетто-сечение каждой гайки должно быть не меньше 2× сечения ребра. Эффективная площадь шва задаётся с дополнительным проектным запасом 2–3×.'
    grid.after(note)
  }

  const visualSummary = $('#joint-visual-summary')
  if (visualSummary && !$('#joint-strength-summary')) {
    const strength = document.createElement('p')
    strength.id = 'joint-strength-summary'
    strength.className = 'material-summary joint-strength-summary'
    visualSummary.after(strength)
  }
}

installJointStrengthUi()

const modeSelect = form.elements.namedItem('jointConfiguratorMode')
const boltDiameter = form.elements.namedItem('jointBoltDiameterMm')
const boltClass = form.elements.namedItem('jointBoltClass')
const clearanceNut = form.elements.namedItem('jointClearanceNutThreadMm')
const boltLength = form.elements.namedItem('jointBoltLengthMm')
const engagement = form.elements.namedItem('jointThreadEngagementFactor')
const effectiveRadius = form.elements.namedItem('jointEffectiveRadiusMm')
const weldConsumable = form.elements.namedItem('weldConsumableId')
const weldLeg = form.elements.namedItem('weldLegMm')
const weldSegments = form.elements.namedItem('weldSegmentsPerEnd')
const tighteningTorque = form.elements.namedItem('jointTighteningTorqueNm')
const nutFactor = form.elements.namedItem('jointNutFactor')
const preloadVariation = form.elements.namedItem('jointPreloadVariation')
const nutSectionAreaRatio = form.elements.namedItem('jointNutSectionAreaRatio')
const weldToRibAreaRatio = form.elements.namedItem('weldToRibAreaRatio')
const barDiameter = form.elements.namedItem('barDiameterMm')
const couplingDescription = form.elements.namedItem('jointCouplingNutDescription')
const jointSummary = $('#joint-config-summary')
const jointVisualSummary = $('#joint-visual-summary')
const jointStrengthSummary = $('#joint-strength-summary')
const optimizeButton = $('#optimize-button')
const viewer = new JointViewer($('#joint-canvas'))

function fillSelect(select, values, label = String) {
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label(value)
    return option
  }))
}

fillSelect(modeSelect, JOINT_CONFIGURATOR_MODES.map((item) => item.id), (id) => (
  JOINT_CONFIGURATOR_MODES.find((item) => item.id === id)?.label ?? id
))
fillSelect(boltLength, JOINT_BOLT_LENGTHS_MM, (value) => `${value} мм`)
fillSelect(engagement, THREAD_ENGAGEMENT_FACTORS, (value) => `${value}d`)
fillSelect(weldLeg, WELD_LEG_SIZES_MM, (value) => `${value} мм`)
fillSelect(weldSegments, WELD_SEGMENT_COUNTS, (value) => `${value}`)
fillSelect(nutSectionAreaRatio, [2, 2.5, 3], (value) => `${value}× сечения ребра`)
fillSelect(
  weldToRibAreaRatio,
  [MIN_WELD_TO_RIB_AREA_RATIO, DEFAULT_WELD_TO_RIB_AREA_RATIO, MAX_WELD_TO_RIB_AREA_RATIO],
  (value) => `${value}× сечения ребра`,
)
modeSelect.value = 'auto'
engagement.value = '2'
weldLeg.value = '4'
weldSegments.value = '3'
tighteningTorque.value = String(DEFAULT_TIGHTENING_TORQUE_NM)
nutFactor.value = String(DEFAULT_NUT_FACTOR)
preloadVariation.value = String(DEFAULT_PRELOAD_VARIATION)
nutSectionAreaRatio.value = String(DEFAULT_NUT_TO_RIB_AREA_RATIO)
weldToRibAreaRatio.value = String(DEFAULT_WELD_TO_RIB_AREA_RATIO)

function selectedNumber(element, fallback = null) {
  const value = Number(element?.value)
  return Number.isFinite(value) ? value : fallback
}

function strengthParametersFromUi() {
  return {
    jointTighteningTorqueNm: selectedNumber(tighteningTorque, DEFAULT_TIGHTENING_TORQUE_NM),
    jointNutFactor: selectedNumber(nutFactor, DEFAULT_NUT_FACTOR),
    jointPreloadVariation: selectedNumber(preloadVariation, DEFAULT_PRELOAD_VARIATION),
    jointNutSectionAreaRatio: selectedNumber(nutSectionAreaRatio, DEFAULT_NUT_TO_RIB_AREA_RATIO),
    weldToRibAreaRatio: selectedNumber(weldToRibAreaRatio, DEFAULT_WELD_TO_RIB_AREA_RATIO),
  }
}

function rebuildClearanceNutOptions(preferred = null) {
  const diameter = selectedNumber(boltDiameter, 24)
  const options = clearanceNutOptionsForBolt(diameter)
  fillSelect(clearanceNut, options.map((item) => item.threadDiameterMm), (value) => {
    const item = options.find((candidate) => candidate.threadDiameterMm === value)
    return `M${value} · проход ${item?.basicMinorDiameterMm.toFixed(1)} мм`
  })
  const preferredNumber = Number(preferred)
  if (options.some((item) => item.threadDiameterMm === preferredNumber)) clearanceNut.value = String(preferredNumber)
  else if (options[0]) clearanceNut.value = String(options[0].threadDiameterMm)
}

function currentGeometry() {
  const diameter = selectedNumber(boltDiameter, 24)
  const manual = modeSelect.value === 'manual'
  return buildJointHardwareGeometry({
    boltDiameterMm: diameter,
    boltClass: boltClass.value || '8.8',
    clearanceNutThreadMm: manual ? selectedNumber(clearanceNut) : undefined,
    boltLengthMm: manual ? selectedNumber(boltLength) : undefined,
    threadEngagementFactor: selectedNumber(engagement, 2),
  })
}

function syncControlsFromGeometry(geometry, preserveManualLength = false) {
  if (!geometry) return
  rebuildClearanceNutOptions(geometry.bottomClearanceNut.threadDiameterMm)
  clearanceNut.value = String(geometry.bottomClearanceNut.threadDiameterMm)
  if (!preserveManualLength || !boltLength.value) boltLength.value = String(geometry.bolt.lengthMm)
  engagement.value = String(geometry.threadEngagementFactor)
  effectiveRadius.value = geometry.effectiveRadiusMm.toFixed(1)
  couplingDescription.value = `M${geometry.topCouplingNut.threadDiameterMm} × ${geometry.topCouplingNut.lengthMm} мм · ${geometry.topCouplingNut.ribCount} ребра`
}

function geometryText(geometry, mode = modeSelect.value) {
  const bottom = geometry.bottomClearanceNut
  const top = geometry.topCouplingNut
  const bolt = geometry.bolt
  const status = geometry.passes ? 'геометрия проходит' : 'геометрия не проходит'
  return `${mode === 'auto' ? 'Автоподбор' : 'Ручной режим'}: болт M${bolt.diameterMm}×${bolt.lengthMm} мм; на ножке проходная гайка M${bottom.threadDiameterMm} (${bottom.ribCount} ребра, зазор ${bottom.diametralClearanceMm.toFixed(1)} мм); верхний узел — длинная M${top.threadDiameterMm}×${top.lengthMm} мм (${top.ribCount} ребра); зацепление ${geometry.threadEngagementMm.toFixed(0)} мм ≈ ${geometry.engagedThreadTurns.toFixed(1)} витка; ${status}.`
}

function previewStrengthText(geometry) {
  const strength = strengthParametersFromUi()
  const diameter = selectedNumber(barDiameter, 12)
  const sections = checkJointNutSections(geometry, diameter, {
    requiredRatio: strength.jointNutSectionAreaRatio,
  })
  const bolt = calculateBoltCapacity({
    diameterMm: geometry.bolt.diameterMm,
    boltClass: boltClass.value || '8.8',
    tighteningTorqueNm: strength.jointTighteningTorqueNm,
    nutFactor: strength.jointNutFactor,
    preloadVariation: strength.jointPreloadVariation,
  })
  const preload = bolt.preload.maximumPreloadN / 1000
  const reserve = bolt.externalTensionReserveN == null ? null : bolt.externalTensionReserveN / 1000
  return `Проверки issue #33: min(Anut/Arib)=${sections.minimumRatio.toFixed(2)} при требовании ≥${sections.requiredRatio.toFixed(1)}; T=${strength.jointTighteningTorqueNm.toFixed(0)} Н·м, K=${strength.jointNutFactor.toFixed(2)} → F0,max≈${preload.toFixed(1)} кН${reserve == null ? '' : `, остаток расчётного растягивающего резерва ≈${reserve.toFixed(1)} кН`}; эффективная площадь шва требуется ≥${strength.weldToRibAreaRatio.toFixed(1)}×Arib.`
}

function viewerConfiguration(geometry, result = null) {
  return {
    geometry,
    barDiameterMm: Number(result?.parameters?.barDiameterMm ?? selectedNumber(barDiameter, 12)),
    weldPhysicalLengthMm: Number(result?.connections?.weld?.critical?.check?.requiredPhysicalLengthMm ?? 0),
  }
}

function resultStrengthText(result) {
  const connections = result?.connections
  if (!connections) return ''
  const sections = connections.nutSections
  const selected = connections.bolt?.selected
  const check = selected?.governingCheck
  const demand = selected?.governingDemand
  const weld = connections.weld?.critical?.check
  const parts = []
  if (sections) {
    parts.push(`нетто-сечение гаек: минимум ${sections.minimumRatio.toFixed(2)}×Arib при требовании ≥${sections.requiredRatio.toFixed(1)}×`)
  }
  if (check?.preload) {
    parts.push(`затяжка ${check.preload.tighteningTorqueNm.toFixed(0)} Н·м → F0,max=${(check.preload.maximumPreloadN / 1000).toFixed(1)} кН, Upreload=${check.preloadUtilization.toFixed(3)}`)
  }
  if (demand) {
    parts.push(`наклонная сила даёт прямой срез ${(demand.shearFromInclinedForceN / 1000).toFixed(2)} кН; полный Ns=${(check?.shearN / 1000 ?? 0).toFixed(2)} кН`)
  }
  if (weld?.minimumAreaRatio != null) {
    parts.push(`критический шов: Aeff/Arib=${weld.requiredAreaRatio.toFixed(2)} при требовании ≥${weld.minimumAreaRatio.toFixed(1)}`)
  }
  return `Усиленная проверка: ${parts.join('; ')}.`
}

function syncJointPreview() {
  if (!boltDiameter.value) return
  try {
    if (!clearanceNut.options.length) rebuildClearanceNutOptions()
    const geometry = currentGeometry()
    if (modeSelect.value === 'auto') syncControlsFromGeometry(geometry)
    else {
      effectiveRadius.value = geometry.effectiveRadiusMm.toFixed(1)
      couplingDescription.value = `M${geometry.topCouplingNut.threadDiameterMm} × ${geometry.topCouplingNut.lengthMm} мм · ${geometry.topCouplingNut.ribCount} ребра`
    }
    jointSummary.textContent = geometryText(geometry)
    jointVisualSummary.textContent = geometryText(geometry)
    jointStrengthSummary.textContent = previewStrengthText(geometry)
    viewer.setConfiguration(viewerConfiguration(geometry))
  } catch (error) {
    jointSummary.textContent = error instanceof Error ? error.message : String(error)
    jointVisualSummary.textContent = jointSummary.textContent
    jointStrengthSummary.textContent = jointSummary.textContent
  }
}

function syncMode() {
  const automatic = modeSelect.value === 'auto'
  for (const control of [boltDiameter, boltClass, clearanceNut, boltLength, engagement, weldConsumable, weldLeg, weldSegments]) {
    control.disabled = automatic
  }
  syncJointPreview()
}

function readJointUiParameters() {
  const geometry = currentGeometry()
  return {
    jointConfiguratorMode: modeSelect.value,
    jointClearanceNutThreadMm: selectedNumber(clearanceNut, geometry.bottomClearanceNut.threadDiameterMm),
    jointBoltLengthMm: selectedNumber(boltLength, geometry.bolt.lengthMm),
    jointThreadEngagementFactor: selectedNumber(engagement, geometry.threadEngagementFactor),
    jointEffectiveRadiusMm: geometry.effectiveRadiusMm,
    ...strengthParametersFromUi(),
  }
}

function synchronizeFromResult(result) {
  const configurator = result?.connections?.configurator
  if (!configurator?.geometry) return
  const geometry = configurator.geometry
  const resolved = configurator.resolvedParameters ?? result.connections.resolvedParameters ?? {}
  modeSelect.value = configurator.mode ?? result.parameters.jointConfiguratorMode ?? 'auto'
  boltDiameter.value = String(resolved.jointBoltDiameterMm ?? geometry.bolt.diameterMm)
  boltClass.value = String(resolved.jointBoltClass ?? configurator.selected?.boltClass ?? boltClass.value)
  rebuildClearanceNutOptions(resolved.jointClearanceNutThreadMm ?? geometry.bottomClearanceNut.threadDiameterMm)
  boltLength.value = String(resolved.jointBoltLengthMm ?? geometry.bolt.lengthMm)
  engagement.value = String(resolved.jointThreadEngagementFactor ?? geometry.threadEngagementFactor)
  if (resolved.weldConsumableId) weldConsumable.value = resolved.weldConsumableId
  if (resolved.weldLegMm != null) weldLeg.value = String(resolved.weldLegMm)
  if (resolved.weldSegmentsPerEnd != null) weldSegments.value = String(resolved.weldSegmentsPerEnd)
  tighteningTorque.value = String(resolved.jointTighteningTorqueNm ?? DEFAULT_TIGHTENING_TORQUE_NM)
  nutFactor.value = String(resolved.jointNutFactor ?? DEFAULT_NUT_FACTOR)
  preloadVariation.value = String(resolved.jointPreloadVariation ?? DEFAULT_PRELOAD_VARIATION)
  nutSectionAreaRatio.value = String(resolved.jointNutSectionAreaRatio ?? DEFAULT_NUT_TO_RIB_AREA_RATIO)
  weldToRibAreaRatio.value = String(resolved.weldToRibAreaRatio ?? DEFAULT_WELD_TO_RIB_AREA_RATIO)
  syncControlsFromGeometry(geometry, true)
  jointSummary.textContent = `${configurator.explanation} ${geometryText(geometry, configurator.mode)}`
  jointVisualSummary.textContent = jointSummary.textContent
  jointStrengthSummary.textContent = resultStrengthText(result)
  viewer.setConfiguration(viewerConfiguration(geometry, result))
  syncMode()
}

const NativeWorker = globalThis.Worker
class JointAwareWorker extends NativeWorker {
  constructor(url, options) {
    super(url, options)
    this.addEventListener('message', (event) => {
      if (event.data?.type === 'result' && event.data?.result) {
        synchronizeFromResult(event.data.result)
        enrichAndRenderUsageResult(event.data.result)
      }
    })
  }

  postMessage(message, transfer) {
    let outgoing = message
    if (message?.parameters) {
      outgoing = {
        ...message,
        parameters: {
          ...message.parameters,
          ...readJointUiParameters(),
          jointConfiguratorMode: message.action === 'optimize' ? 'auto' : modeSelect.value,
        },
      }
    }
    if (transfer === undefined) super.postMessage(outgoing)
    else super.postMessage(outgoing, transfer)
  }
}
globalThis.Worker = JointAwareWorker

modeSelect.addEventListener('change', syncMode)
for (const control of [
  boltDiameter, boltClass, clearanceNut, boltLength, engagement,
  weldConsumable, weldLeg, weldSegments, tighteningTorque, nutFactor,
  preloadVariation, nutSectionAreaRatio, weldToRibAreaRatio, barDiameter,
]) {
  control.addEventListener('change', () => {
    if (control === boltDiameter) rebuildClearanceNutOptions()
    syncJointPreview()
  })
}
optimizeButton.addEventListener('click', () => {
  modeSelect.value = 'auto'
  syncMode()
}, { capture: true })

// app.js остаётся владельцем основной формы и расчётной визуализации.
// Bootstrap добавляет физический конфигуратор и сценарный UX; экспорт 3D/КД
// принадлежит отдельному design workspace issue #47.
await import('./app.js')
rebuildClearanceNutOptions(30)
syncMode()
initializeUsageExperience()
