import {
  JOINT_CONFIGURATOR_MODES,
  jointGeometryFromParameters,
} from './engine/joint-configurator.js'
import {
  buildJointHardwareGeometry,
  clearanceNutOptionsForBolt,
  JOINT_BOLT_LENGTHS_MM,
  THREAD_ENGAGEMENT_FACTORS,
  WELD_LEG_SIZES_MM,
  WELD_SEGMENT_COUNTS,
} from './engine/joint-hardware-catalog.js'
import { JointViewer } from './joint-viewer.js'
import {
  enrichAndRenderUsageResult,
  initializeUsageExperience,
} from './usage-scenarios.js'

const $ = (selector) => document.querySelector(selector)
const form = $('#parameters-form')
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
const couplingDescription = form.elements.namedItem('jointCouplingNutDescription')
const jointSummary = $('#joint-config-summary')
const jointVisualSummary = $('#joint-visual-summary')
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
modeSelect.value = 'auto'
engagement.value = '2'
weldLeg.value = '4'
weldSegments.value = '3'

function selectedNumber(element, fallback = null) {
  const value = Number(element?.value)
  return Number.isFinite(value) ? value : fallback
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
  return `${mode === 'auto' ? 'Автоподбор' : 'Ручной режим'}: болт M${bolt.diameterMm}×${bolt.lengthMm} мм; на ножке проходная гайка M${bottom.threadDiameterMm} (${bottom.ribCount} ребра, зазор по базовому внутреннему диаметру ${bottom.diametralClearanceMm.toFixed(1)} мм); верхний узел — длинная соединительная гайка M${top.threadDiameterMm}×${top.lengthMm} мм (${top.ribCount} ребра); зацепление болта ${geometry.threadEngagementMm.toFixed(0)} мм ≈ ${geometry.engagedThreadTurns.toFixed(1)} витка; ${status}.`
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
    viewer.setConfiguration({ geometry })
  } catch (error) {
    jointSummary.textContent = error instanceof Error ? error.message : String(error)
    jointVisualSummary.textContent = jointSummary.textContent
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
  syncControlsFromGeometry(geometry, true)
  jointSummary.textContent = `${configurator.explanation} ${geometryText(geometry, configurator.mode)}`
  jointVisualSummary.textContent = jointSummary.textContent
  viewer.setConfiguration({ geometry })
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
for (const control of [boltDiameter, boltClass, clearanceNut, boltLength, engagement, weldConsumable, weldLeg, weldSegments]) {
  control.addEventListener('change', () => {
    if (control === boltDiameter) rebuildClearanceNutOptions()
    syncJointPreview()
  })
}
optimizeButton.addEventListener('click', () => {
  modeSelect.value = 'auto'
  syncMode()
}, { capture: true })

// app.js остаётся владельцем основной формы/визуализации. Bootstrap добавляет
// физический конфигуратор, сценарный UX, справочники и сборочную массу, не
// создавая второй расчётный путь для FEM.
await import('./app.js')
rebuildClearanceNutOptions(30)
syncMode()
initializeUsageExperience()
