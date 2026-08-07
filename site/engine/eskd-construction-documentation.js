import { calculateAssemblyMass } from './assembly-mass.js'
import { getReinforcementClass } from './catalog.js'
import { WELD_CONSUMABLES } from './connection-catalog.js'
import { buildDetailedMastModel } from './detailed-mast-model.js'
import { buildJointVisualGeometry } from './joint-visual-geometry.js'
import {
  dimensionHorizontalSvg,
  dimensionVerticalSvg,
  projectMeshToSvg,
  TECHNICAL_PROJECTION_SCHEMA,
} from './technical-projection.js'

export const ESKD_EXPORT_SCHEMA = 'mast-calculator/eskd-construction-documentation/v2'

export const ESKD_STANDARDS = Object.freeze([
  Object.freeze({ id: 'ГОСТ Р 2.102-2023', purpose: 'виды и комплектность конструкторских документов' }),
  Object.freeze({ id: 'ГОСТ Р 2.104-2023', purpose: 'основные надписи и дополнительные графы' }),
  Object.freeze({ id: 'ГОСТ Р 2.105-2019', purpose: 'общие требования к текстовым документам' }),
  Object.freeze({ id: 'ГОСТ Р 2.109-2023', purpose: 'основные требования к чертежам' }),
  Object.freeze({ id: 'ГОСТ Р 2.201-2023', purpose: 'обозначение изделий и конструкторских документов' }),
  Object.freeze({ id: 'ГОСТ 2.301-68', purpose: 'форматы листов' }),
])

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const number = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(value))
  : '—'

function resolvedJointGeometry(result) {
  return result?.connections?.configurator?.geometry
    ?? result?.connections?.geometry
    ?? result?.connections?.resolvedGeometry
    ?? null
}

function memberDiameters(result) {
  return [...new Set(result.model.members.map((member) => Math.round(Number(member.diameterM) * 1000 * 1000) / 1000))]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
}

export function buildEskdConstructionDocumentationModel(result) {
  if (!result?.parameters || !result?.model?.members?.length) {
    throw new Error('Для экспорта КД требуется готовый расчёт мачты')
  }
  const geometry = resolvedJointGeometry(result)
  if (!geometry) throw new Error('Для экспорта КД отсутствует выбранная геометрия соединительного узла')
  const p = result.parameters
  const mass = result.assemblyMass ?? calculateAssemblyMass(result)
  const reinforcement = getReinforcementClass(p.reinforcementClass)
  const weld = WELD_CONSUMABLES.find((item) => item.id === p.weldConsumableId)
  const detailedModel = buildDetailedMastModel(result, { radialSegments: 8, includeJointHardware: true })
  const jointVisual = buildJointVisualGeometry({
    geometry,
    barDiameterMm: Math.max(...memberDiameters(result)),
    weldPhysicalLengthMm: Number(result.connections?.weld?.critical?.check?.requiredPhysicalLengthMm ?? 0),
  })
  const moduleCount = Number(result.model.moduleCount)
  return {
    schema: ESKD_EXPORT_SCHEMA,
    technicalProjectionSchema: TECHNICAL_PROJECTION_SCHEMA,
    productName: 'Мачта модульная',
    moduleName: 'Модуль мачты',
    jointName: 'Узел межмодульный',
    ribName: 'Ребро',
    documentDesignation: '',
    moduleCount,
    moduleHeightMm: Number(p.moduleHeightMm),
    mastHeightMm: moduleCount * Number(p.moduleHeightMm),
    ribLengthMm: Number(p.ribCutLengthMm),
    ribDiametersMm: memberDiameters(result),
    reinforcement,
    weld,
    weldLegMm: Number(mass.weld.legMm),
    weldLengthMm: Number(mass.weld.designPhysicalLengthPerEndMm),
    boltClass: result.connections?.configurator?.selected?.boltClass ?? p.jointBoltClass ?? '—',
    bolt: mass.hardware.bolt,
    clearanceNut: mass.hardware.clearanceNut,
    couplingNut: mass.hardware.couplingNut,
    geometry,
    jointVisual,
    detailedModel,
    mass,
  }
}

function titleBlock(model, name, options = {}) {
  const form = options.form ?? '1'
  return `<div class="eskd-title-block eskd-title-form${form}" data-title-block-form="${form}">
    <div class="eskd-signatures"><span>Разраб.</span><b></b><span>Провер.</span><b></b><span>Н. контр.</span><b></b><span>Утв.</span><b></b></div>
    <div class="eskd-name">${escapeHtml(name)}</div>
    <div class="eskd-designation"><small>Обозначение</small><strong>${model.documentDesignation || 'НЕ ПРИСВОЕНО'}</strong></div>
    <div class="eskd-meta"><span>Масса ${number(model.mass.mastFabricationEstimate.uniformModulesMassKg, 2)} кг</span><span>Масштаб ${escapeHtml(options.scale ?? 'Б/М')}</span><span>Лист ${options.sheet ?? 1}</span><span>Листов ${options.sheets ?? 1}</span></div>
    <div class="eskd-org">Организация-разработчик: ____________________</div>
  </div>`
}

function sheet(model, name, body, options = {}) {
  return `<article class="eskd-sheet" data-format="A4" data-document="${escapeHtml(name)}">
    <div class="eskd-frame"></div>
    <div class="eskd-content">${body}</div>
    ${titleBlock(model, name, options)}
  </article>`
}

function drawingSvg(content, label) {
  return `<svg class="eskd-drawing" viewBox="0 0 180 210" role="img" aria-label="${escapeHtml(label)}">${content}</svg>`
}

function mastDrawing(model) {
  const scene = model.detailedModel
  const structural = (object) => object.kind === 'member'
  const front = projectMeshToSvg(scene, { view: 'front', x: 12, y: 8, width: 98, height: 160, padding: 4, objectFilter: structural, label: 'Вид спереди' })
  const iso = projectMeshToSvg(scene, { view: 'iso', x: 116, y: 10, width: 55, height: 92, padding: 3, objectFilter: structural, label: 'Изометрия' })
  const dimensions = [
    dimensionVerticalSvg(7, 12, 168, `H = ${number(model.mastHeightMm, 0)} мм`),
    dimensionHorizontalSvg(25, 96, 177, `ребро a = ${number(model.ribLengthMm, 0)} мм`),
  ].join('')
  return `<div class="eskd-drawing-grid">${drawingSvg(`${front}${iso}${dimensions}`, 'Сборочный чертёж модульной мачты')}
    <div class="eskd-tech"><h4>Технические требования</h4><ol>
      <li>Мачту собирать из ${model.moduleCount} модулей; геометрия видов автоматически получена из той же 3D-модели, что используется в просмотрщике и OBJ.</li>
      <li>Межмодульные соединения выполнить по отдельному листу узла.</li>
      <li>Перед выпуском присвоить обозначения КД по ГОСТ Р 2.201-2023, заполнить подписи и провести нормоконтроль.</li>
      <li>Защитное покрытие, монтажные допуски и требования к основанию назначаются проектировщиком для конкретного объекта.</li>
    </ol></div></div>`
}

function mastSpecification(model) {
  const jointCount = Math.max(0, 3 * (model.moduleCount - 1))
  return `<h3>Спецификация изделия</h3><table class="eskd-spec"><thead><tr><th>Поз.</th><th>Наименование</th><th>Кол.</th><th>Примечание</th></tr></thead><tbody>
    <tr><td>1</td><td>${escapeHtml(model.moduleName)}</td><td>${model.moduleCount}</td><td>унифицированный модуль</td></tr>
    <tr><td>2</td><td>${escapeHtml(model.jointName)}</td><td>${jointCount}</td><td>по 3 стыка на внутренний уровень</td></tr>
  </tbody></table><p class="eskd-note">Масса изготовленной мачты по геометрической оценке: ${number(model.mass.mastFabricationEstimate.uniformModulesMassKg, 2)} кг.</p>`
}

function moduleDrawing(model) {
  const moduleFilter = (object) => object.moduleIndices?.includes(0)
  const front = projectMeshToSvg(model.detailedModel, { view: 'front', x: 8, y: 8, width: 78, height: 108, padding: 5, objectFilter: moduleFilter, label: 'Спереди' })
  const top = projectMeshToSvg(model.detailedModel, { view: 'top', x: 94, y: 8, width: 78, height: 78, padding: 5, objectFilter: moduleFilter, label: 'Сверху' })
  const iso = projectMeshToSvg(model.detailedModel, { view: 'iso', x: 94, y: 92, width: 78, height: 72, padding: 5, objectFilter: moduleFilter, label: 'Изометрия' })
  const dimensions = `${dimensionVerticalSvg(5, 12, 112, `h = ${number(model.moduleHeightMm, 1)} мм`)}${dimensionHorizontalSvg(16, 78, 124, `a = ${number(model.ribLengthMm, 1)} мм`)}`
  return `<div class="eskd-drawing-grid">${drawingSvg(`${front}${top}${iso}${dimensions}`, 'Сборочный чертёж модуля')}
    <div class="eskd-tech"><h4>Технические требования</h4><ol>
      <li>Каркас: 9 одинаковых рёбер длиной ${number(model.ribLengthMm, 1)} мм.</li>
      <li>Арматура: ${escapeHtml(model.reinforcement.label)}, Ø${model.ribDiametersMm.map((d) => number(d, 0)).join('/')} мм; ${escapeHtml(model.reinforcement.standard)}.</li>
      <li>Угловые швы: катет ${number(model.weldLegMm, 1)} мм; физическая длина не менее ${number(model.weldLengthMm, 1)} мм на конец.</li>
      <li>Сварочный материал: ${escapeHtml(model.weld?.label ?? 'по расчёту')}${model.weld?.standard ? `; ${escapeHtml(model.weld.standard)}` : ''}.</li>
    </ol></div></div>`
}

function moduleSpecification(model) {
  return `<h3>Спецификация модуля</h3><table class="eskd-spec"><thead><tr><th>Поз.</th><th>Наименование</th><th>Кол.</th><th>Материал / размер</th></tr></thead><tbody>
    <tr><td>1</td><td>Ребро</td><td>9</td><td>${escapeHtml(model.reinforcement.label)} Ø${model.ribDiametersMm.map((d) => number(d, 0)).join('/')} × ${number(model.ribLengthMm, 0)}; ${escapeHtml(model.reinforcement.standard)}</td></tr>
    <tr><td>2</td><td>Болт M${model.bolt.diameterMm}×${number(model.bolt.lengthMm, 0)}</td><td>3</td><td>класс ${escapeHtml(model.boltClass)}</td></tr>
    <tr><td>3</td><td>Гайка проходная M${model.clearanceNut.threadDiameterMm}</td><td>3</td><td>s=${number(model.clearanceNut.acrossFlatsMm, 1)} мм</td></tr>
    <tr><td>4</td><td>Гайка соединительная M${model.couplingNut.threadDiameterMm}×${number(model.couplingNut.lengthMm, 0)}</td><td>3</td><td>зацепление ${number(model.geometry.threadEngagementMm, 0)} мм</td></tr>
    <tr><td>5</td><td>Сварной шов</td><td>18 концов</td><td>k=${number(model.weldLegMm, 1)}; L≥${number(model.weldLengthMm, 1)} мм/конец</td></tr>
  </tbody></table><p class="eskd-note">Расчётная производственная масса модуля: ${number(model.mass.module.totalMassKg, 3)} кг.</p>`
}

function jointDrawing(model) {
  const visual = model.jointVisual
  const coupling = visual.couplingNut
  const clearance = visual.clearanceNut
  const cx = 54
  const scale = 0.95
  const y0 = 132
  const z = (value) => y0 - Number(value) * scale
  const width = (value) => Number(value) * scale
  const couplingX = cx - width(coupling.acrossFlatsMm) / 2
  const clearanceX = cx - width(clearance.acrossFlatsMm) / 2
  const ribLines = visual.ribs.map((rib) => {
    const x1 = cx + rib.startPoint[0] * 0.55
    const y1 = z(rib.startPoint[2])
    const x2 = cx + rib.endPoint[0] * 0.55
    const y2 = z(rib.endPoint[2])
    return `<line class="joint-rib ${rib.group}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`
  }).join('')
  const side = `<g class="joint-detail">
    <rect x="${couplingX}" y="${z(visual.couplingZ1)}" width="${width(coupling.acrossFlatsMm)}" height="${width(visual.couplingZ1 - visual.couplingZ0)}"/>
    <rect x="${clearanceX}" y="${z(visual.clearanceZ1)}" width="${width(clearance.acrossFlatsMm)}" height="${width(visual.clearanceZ1 - visual.clearanceZ0)}"/>
    <line class="joint-bolt" x1="${cx}" y1="${z(visual.couplingZ0)}" x2="${cx}" y2="${z(visual.boltTop)}"/>
    ${ribLines}
    <text x="8" y="12" class="tech-view-label">Продольный вид</text>
  </g>`
  const dims = `${dimensionVerticalSvg(94, z(visual.couplingZ0), z(visual.boltTop), `Lболта ${number(model.bolt.lengthMm, 0)} мм`)}${dimensionHorizontalSvg(28, 80, 150, `M${model.bolt.diameterMm}; sгайки ${number(model.couplingNut.acrossFlatsMm, 0)} мм`)}`
  const top = `<g transform="translate(126 62)"><polygon class="joint-hex" points="0,-24 20.78,-12 20.78,12 0,24 -20.78,12 -20.78,-12"/><circle class="joint-hole" cx="0" cy="0" r="${Math.max(4, model.bolt.diameterMm * 0.34)}"/><text class="tech-view-label" x="-28" y="-31">Вид сверху</text></g>`
  return `<div class="eskd-drawing-grid">${drawingSvg(`${side}${top}${dims}`, 'Сборочный чертёж межмодульного узла')}
    <div class="eskd-tech"><h4>Технические требования</h4><ol>
      <li>Болт M${model.bolt.diameterMm}×${number(model.bolt.lengthMm, 0)}, класс ${escapeHtml(model.boltClass)} свободно проходит через гайку M${model.clearanceNut.threadDiameterMm} и ввинчивается в длинную M${model.couplingNut.threadDiameterMm}.</li>
      <li>Длина зацепления резьбы: ${number(model.geometry.threadEngagementMm, 1)} мм ≈ ${number(model.geometry.engagedThreadTurns, 1)} витков.</li>
      <li>К длинной гайке приварить 4 ребра, к проходной — 2 ребра. Направления рёбер взяты из той же joint geometry, что используется 3D-просмотрщиком.</li>
      <li>Фактические размеры покупных гаек и болта сверить с документацией поставщика.</li>
    </ol></div></div>`
}

function ribDrawing(model) {
  const diameter = Math.max(...model.ribDiametersMm)
  const y = 86
  return `<div class="eskd-drawing-grid">${drawingSvg(`
    <g class="rib-detail"><line x1="22" y1="${y}" x2="152" y2="${y}"/><line x1="22" y1="${y - 2.5}" x2="152" y2="${y - 2.5}"/><line x1="22" y1="${y + 2.5}" x2="152" y2="${y + 2.5}"/><line x1="22" y1="${y - 5}" x2="22" y2="${y + 5}"/><line x1="152" y1="${y - 5}" x2="152" y2="${y + 5}"/></g>
    ${dimensionHorizontalSvg(22, 152, 112, `L = ${number(model.ribLengthMm, 1)} мм`)}
    <text x="28" y="65" class="tech-callout">Ø${number(diameter, 0)} ${escapeHtml(model.reinforcement.label)}</text>
    <line class="tech-leader" x1="52" y1="67" x2="69" y2="82"/>
  `, 'Чертёж детали ребра')}
    <div class="eskd-tech"><h4>Технические требования</h4><ol>
      <li>Заготовка: арматура ${escapeHtml(model.reinforcement.label)}, ${escapeHtml(model.reinforcement.standard)}.</li>
      <li>Длина после резки ${number(model.ribLengthMm, 1)} мм. Допуск на резку назначить технологом до выпуска КД.</li>
      <li>Заусенцы удалить. Подготовку концов под сварку назначить по принятой технологии сварки.</li>
    </ol></div></div>`
}

function standardsNote() {
  return ESKD_STANDARDS.map((item) => `${escapeHtml(item.id)} — ${escapeHtml(item.purpose)}`).join('; ')
}

export function createEskdConstructionDocumentation(result) {
  const model = buildEskdConstructionDocumentationModel(result)
  const sheets = [
    sheet(model, 'Мачта модульная. Сборочный чертеж', mastDrawing(model), { form: '1', sheet: 1, sheets: 6, scale: 'Б/М' }),
    sheet(model, 'Мачта модульная. Спецификация', mastSpecification(model), { form: '2', sheet: 2, sheets: 6 }),
    sheet(model, 'Модуль мачты. Сборочный чертеж', moduleDrawing(model), { form: '1', sheet: 3, sheets: 6, scale: 'Б/М' }),
    sheet(model, 'Модуль мачты. Спецификация', moduleSpecification(model), { form: '2', sheet: 4, sheets: 6 }),
    sheet(model, 'Узел межмодульный. Сборочный чертеж', jointDrawing(model), { form: '1', sheet: 5, sheets: 6, scale: '2:1 условно' }),
    sheet(model, 'Ребро. Чертеж детали', ribDrawing(model), { form: '1', sheet: 6, sheets: 6, scale: 'Б/М' }),
  ].join('')
  return `<section class="eskd-package" data-schema="${ESKD_EXPORT_SCHEMA}">${sheets}</section>`
}

const documentCss = `
@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;background:#d8dde1;color:#111;font-family:"Arial Narrow",Arial,sans-serif}.eskd-package{display:flex;flex-direction:column;align-items:center;gap:8mm;padding:8mm}.eskd-sheet{position:relative;width:210mm;height:297mm;background:white;page-break-after:always;break-after:page;box-shadow:0 1mm 5mm #0003}.eskd-frame{position:absolute;left:20mm;right:5mm;top:5mm;bottom:5mm;border:.5mm solid #111}.eskd-content{position:absolute;left:25mm;right:10mm;top:10mm;bottom:62mm;overflow:hidden}.eskd-title-block{position:absolute;right:5mm;bottom:5mm;width:185mm;height:55mm;border:.35mm solid #111;display:grid;grid-template-columns:42mm 1fr 58mm;grid-template-rows:24mm 16mm 15mm;font-size:3mm}.eskd-title-block>div{border:.18mm solid #111;padding:1.2mm}.eskd-signatures{grid-row:1/4;display:grid;grid-template-columns:16mm 1fr;grid-auto-rows:6mm}.eskd-signatures b{border-bottom:.15mm solid #777}.eskd-name{font-size:5mm;font-weight:700;text-align:center;display:flex;align-items:center;justify-content:center}.eskd-designation{text-align:center}.eskd-designation small{display:block}.eskd-designation strong{font-size:4mm}.eskd-meta{display:flex;justify-content:space-around;gap:2mm}.eskd-org{text-align:center}.eskd-drawing-grid{display:grid;grid-template-columns:2fr 1fr;gap:4mm;height:100%}.eskd-drawing{width:100%;height:100%;border:.2mm solid #888}.eskd-tech{font-size:3.15mm;line-height:1.25}.eskd-tech h4{margin:0 0 2mm}.eskd-tech ol{padding-left:5mm;margin:0}.eskd-tech li{margin-bottom:2mm}.tech-visible{stroke:#111;stroke-width:.42;fill:none}.tech-hidden{stroke:#777;stroke-width:.22;stroke-dasharray:1.5 1;fill:none}.tech-view-label,.tech-callout{font-size:3.3px;font-weight:700}.tech-dimension{stroke:#111;stroke-width:.25;fill:none}.tech-dimension text{stroke:none;fill:#111;font-size:3.2px}.tech-leader{stroke:#111;stroke-width:.3}.eskd-spec{width:100%;border-collapse:collapse;font-size:3.4mm}.eskd-spec th,.eskd-spec td{border:.25mm solid #111;padding:2mm}.eskd-spec th{height:10mm}.eskd-note{font-size:3.2mm}.joint-detail rect,.joint-hex{fill:#f0f0f0;stroke:#111;stroke-width:.45}.joint-hole{fill:white;stroke:#111;stroke-width:.35}.joint-bolt{stroke:#111;stroke-width:3}.joint-rib{stroke-width:4;stroke-linecap:round}.joint-rib.coupling{stroke:#222}.joint-rib.clearance{stroke:#555}.rib-detail{stroke:#111;stroke-width:.45}@media print{body{background:white}.eskd-package{padding:0;gap:0}.eskd-sheet{box-shadow:none;margin:0}}
`

export function createEskdConstructionDocumentationHtml(result, metadata = {}) {
  const model = buildEskdConstructionDocumentationModel(result)
  const packageHtml = createEskdConstructionDocumentation(result)
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>КД ЕСКД — ${escapeHtml(model.productName)}</title><style>${documentCss}</style></head><body>
    ${packageHtml}
    <aside class="eskd-release-note" style="display:none">Схема ${ESKD_EXPORT_SCHEMA}; источник ${escapeHtml(metadata.source ?? 'mast-calculator')}; нормативная база: ${standardsNote()}. Автоматически сформирован проект КД. Обозначения, подписи, технологические допуски, покрытие и нормоконтроль должны быть назначены разработчиком.</aside>
  </body></html>`
}
