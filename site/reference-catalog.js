import './usage-style.js'
import { buildReferenceData } from './engine/reference-data.js'

const format = (value, digits = 3) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
  : '—'

function cells(values) {
  return values.map((value) => {
    const cell = document.createElement('td')
    cell.textContent = value
    return cell
  })
}

function rows(items, values) {
  return items.map((item) => {
    const row = document.createElement('tr')
    row.append(...cells(values(item)))
    return row
  })
}

export function renderReferenceCatalogs(root = document) {
  const data = buildReferenceData()

  root.querySelector('#reference-rebar-classes')?.replaceChildren(...rows(
    data.reinforcement.classes,
    (item) => [
      item.label,
      format(item.yieldStrengthMPa, 0),
      format(item.tensileStrengthMPa, 0),
      format(item.youngModulusGPa, 0),
      format(item.poissonRatio, 2),
      format(item.densityKgM3, 0),
      item.weldabilityGuaranteed ? 'да' : 'нет',
      item.standard,
    ],
  ))

  root.querySelector('#reference-rebar-diameters')?.replaceChildren(...rows(
    data.reinforcement.diameters,
    (item) => [
      `Ø${item.diameterMm}`,
      format(item.areaMm2, 2),
      format(item.massPerMeterKg, 3),
    ],
  ))

  root.querySelector('#reference-bolt-classes')?.replaceChildren(...rows(
    data.fasteners.classes,
    (item) => [
      item.label,
      format(item.rbunMPa, 0),
      format(item.rbsMPa, 0),
      item.rbtMPa == null ? '—' : format(item.rbtMPa, 0),
      item.nutClassForTension,
      item.standard,
    ],
  ))

  root.querySelector('#reference-bolt-sizes')?.replaceChildren(...rows(
    data.fasteners.sizes,
    (item) => [
      `M${item.diameterMm}×${item.pitchMm}`,
      format(item.grossAreaMm2, 0),
      format(item.netAreaMm2, 0),
      format(item.headAcrossFlatsMm, 1),
      format(item.headHeightMm, 1),
      item.threadStandard,
    ],
  ))

  root.querySelector('#reference-regular-nuts')?.replaceChildren(...rows(
    data.fasteners.regularNuts,
    (item) => [
      `M${item.threadDiameterMm}×${item.pitchMm}`,
      format(item.acrossFlatsMm, 1),
      format(item.heightMm, 1),
      item.standard,
    ],
  ))

  root.querySelector('#reference-coupling-nuts')?.replaceChildren(...rows(
    data.fasteners.couplingNuts,
    (item) => [
      `M${item.threadDiameterMm}×${item.pitchMm}`,
      format(item.acrossFlatsMm, 1),
      format(item.lengthMm, 1),
      item.standard,
    ],
  ))

  root.querySelector('#reference-welding')?.replaceChildren(...rows(
    data.welding.consumables,
    (item) => [
      item.label,
      item.process === 'wire' ? 'проволока' : 'электрод',
      format(item.rwunMPa, 0),
      format(item.rwfMPa, 0),
      item.standard,
      item.resistanceStandard,
    ],
  ))

  const weldLegs = root.querySelector('#reference-weld-legs')
  if (weldLegs) weldLegs.textContent = data.welding.filletLegSizesMm.map((value) => `${value} мм`).join(', ')

  const schema = root.querySelector('#reference-schema')
  if (schema) schema.textContent = data.schema
  return data
}
