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

function ensureJointDesignReference(root, data) {
  const details = root.querySelector('#reference-details')
  if (!details || details.querySelector('#reference-joint-design')) return
  const section = document.createElement('section')
  section.id = 'reference-joint-design'
  section.className = 'reference-joint-design'
  const preload = data.jointDesign.boltPreload
  const nut = data.jointDesign.nutNetSection
  const weld = data.jointDesign.weldEffectiveArea
  section.innerHTML = `
    <h3>Проектные критерии соединительного узла</h3>
    <div class="table-scroll"><table class="member-table reference-table">
      <thead><tr><th>Проверка</th><th>Принято</th><th>Формула / источник</th></tr></thead>
      <tbody>
        <tr><td>Преднатяг болта от момента</td><td>T=${format(preload.defaultTighteningTorqueNm, 0)} Н·м; K=${format(preload.defaultNutFactor, 2)}; разброс ±${format(preload.defaultPreloadVariation * 100, 0)}%</td><td>${preload.relation}. ${preload.source}</td></tr>
        <tr><td>Нетто-сечение гайки</td><td>не менее ${format(nut.minimumAreaRatioToSingleRib, 1)}× площади одного ребра</td><td>${nut.relation}. ${nut.source}</td></tr>
        <tr><td>Эффективная площадь шва</td><td>${format(weld.minimumAreaRatioToRib, 1)}…${format(weld.maximumSelectableAreaRatioToRib, 1)}× Arib; по умолчанию ${format(weld.defaultAreaRatioToRib, 1)}×</td><td>${weld.relation}. ${weld.source}</td></tr>
      </tbody>
    </table></div>
    <p class="hint practical-note"><strong>Важно:</strong> коэффициенты 2× для гайки и 2–3× для шва — дополнительные консервативные критерии этого проекта. Они не подменяют проверки резьбы, смятия, prying и силовой расчёт шва.</p>`
  details.append(section)
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
  ensureJointDesignReference(root, data)
  return data
}
