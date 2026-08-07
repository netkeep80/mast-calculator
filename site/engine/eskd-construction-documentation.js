import { calculateAssemblyMass } from './assembly-mass.js'
import { getReinforcementClass } from './catalog.js'
import { WELD_CONSUMABLES } from './connection-catalog.js'

export const ESKD_EXPORT_SCHEMA = 'mast-calculator/eskd-construction-documentation/v1'

export const ESKD_STANDARDS = Object.freeze([
  Object.freeze({ id: 'ГОСТ Р 2.102-2023', purpose: 'виды и комплектность конструкторских документов' }),
  Object.freeze({ id: 'ГОСТ Р 2.104-2023', purpose: 'основные надписи и дополнительные графы' }),
  Object.freeze({ id: 'ГОСТ Р 2.105-2019', purpose: 'общие требования к текстовым документам' }),
  Object.freeze({ id: 'ГОСТ Р 2.109-2023', purpose: 'основные требования к чертежам' }),
  Object.freeze({ id: 'ГОСТ Р 2.201-2023', purpose: 'обозначения изделий и конструкторских документов' }),
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

const svgText = (x, y, text, options = {}) => {
  const size = options.size ?? 4
  const anchor = options.anchor ?? 'start'
  const weight = options.weight ?? 'normal'
  const rotate = options.rotate == null ? '' : ` transform="rotate(${options.rotate} ${x} ${y})"`
  return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}"${rotate}>${escapeHtml(text)}</text>`
}

function resolveEskdModel(result) {
  if (!result?.parameters || !result?.model) throw new Error('Для экспорта КД требуется готовый расчёт мачты')
  const p = result.parameters
  const mass = result.assemblyMass ?? calculateAssemblyMass(result)
  const geometry = result.connections?.configurator?.geometry
  if (!geometry) throw new Error('Для экспорта КД отсутствует выбранная геометрия соединительного узла')
  const reinforcement = getReinforcementClass(p.reinforcementClass)
  const weld = WELD_CONSUMABLES.find((item) => item.id === p.weldConsumableId)
  const moduleCount = Number(result.model.moduleCount)
  const moduleHeightMm = Number(p.moduleHeightMm)
  const mastHeightMm = moduleCount * moduleHeightMm
  const boltClass = result.connections?.configurator?.selected?.boltClass ?? p.jointBoltClass ?? '—'
  return {
    schema: ESKD_EXPORT_SCHEMA,
    productName: 'Мачта модульная',
    moduleName: 'Модуль мачты',
    jointName: 'Узел межмодульный',
    ribName: 'Ребро',
    moduleCount,
    moduleHeightMm,
    mastHeightMm,
    ribLengthMm: Number(p.ribCutLengthMm),
    ribDiameterMm: Number(p.barDiameterMm),
    reinforcement,
    weld,
    weldLegMm: Number(mass.weld.legMm),
    weldLengthMm: Number(mass.weld.designPhysicalLengthPerEndMm),
    boltClass,
    bolt: mass.hardware.bolt,
    clearanceNut: mass.hardware.clearanceNut,
    couplingNut: mass.hardware.couplingNut,
    mass,
    documentDesignation: '',
  }
}

function titleBlock(model, {
  name,
  form = '1',
  sheet = 1,
  sheets = 1,
  scale = 'Б/М',
  material = '',
}) {
  const heightClass = form === '1' ? 'eskd-title-form1' : 'eskd-title-form2'
  return `
<div class="eskd-title-block ${heightClass}" aria-label="Основная надпись, форма ${escapeHtml(form)} по ГОСТ Р 2.104-2023">
  <div class="eskd-approval-grid">
    <span>Разраб.</span><span class="eskd-signature"></span><span></span><span></span>
    <span>Провер.</span><span class="eskd-signature"></span><span></span><span></span>
    <span>Н. контр.</span><span class="eskd-signature"></span><span></span><span></span>
    <span>Утв.</span><span class="eskd-signature"></span><span></span><span></span>
  </div>
  <div class="eskd-title-name">${escapeHtml(name)}</div>
  <div class="eskd-title-designation">
    <small>Обозначение</small>
    <strong>${model.documentDesignation ? escapeHtml(model.documentDesignation) : 'НЕ ПРИСВОЕНО'}</strong>
  </div>
  <div class="eskd-title-material">${material ? `<small>Материал</small><br>${escapeHtml(material)}` : ''}</div>
  <div class="eskd-title-meta"><span>Лит.</span><span>Масса</span><span>Масштаб</span><b>—</b><b>${number(model.mass.mastFabricationEstimate.uniformModulesMassKg, 2)}</b><b>${escapeHtml(scale)}</b></div>
  <div class="eskd-title-sheet"><span>Лист</span><span>Листов</span><b>${sheet}</b><b>${sheets}</b></div>
  <div class="eskd-title-org">Организация-разработчик: ____________________</div>
</div>`
}

function sheet({ model, name, form = '1', sheet = 1, sheets = 1, scale = 'Б/М', material = '', body }) {
  return `
<article class="eskd-sheet" data-format="A4" data-title-block-form="${escapeHtml(form)}">
  <div class="eskd-frame"></div>
  <div class="eskd-zone eskd-zone-top">1&nbsp;&nbsp;2&nbsp;&nbsp;3&nbsp;&nbsp;4&nbsp;&nbsp;5&nbsp;&nbsp;6&nbsp;&nbsp;7&nbsp;&nbsp;8</div>
  <div class="eskd-sheet-content">${body}</div>
  ${titleBlock(model, { name, form, sheet, sheets, scale, material })}
</article>`
}

function mastDrawing(model) {
  const modulesShown = Math.min(model.moduleCount, 16)
  const xLeft = 48
  const xRight = 96
  const xMid = (xLeft + xRight) / 2
  const yBottom = 182
  const totalGraphicHeight = 145
  const step = totalGraphicHeight / modulesShown
  const lines = []
  for (let index = 0; index < modulesShown; index += 1) {
    const y0 = yBottom - index * step
    const y1 = yBottom - (index + 1) * step
    lines.push(`<line x1="${xLeft}" y1="${y0}" x2="${xRight}" y2="${y0}"/>`)
    lines.push(`<line x1="${xLeft}" y1="${y0}" x2="${xMid}" y2="${y1}"/>`)
    lines.push(`<line x1="${xRight}" y1="${y0}" x2="${xMid}" y2="${y1}"/>`)
    lines.push(`<line x1="${xMid}" y1="${y1}" x2="${xLeft}" y2="${y0 - step * 0.48}"/>`)
    lines.push(`<line x1="${xMid}" y1="${y1}" x2="${xRight}" y2="${y0 - step * 0.48}"/>`)
  }
  const topY = yBottom - totalGraphicHeight
  return `
<div class="eskd-drawing-grid">
<svg class="eskd-drawing" viewBox="0 0 145 215" role="img" aria-label="Сборочный чертёж модульной мачты">
  <g class="eskd-thick">${lines.join('')}</g>
  <g class="eskd-thin">
    <line x1="40" y1="${topY}" x2="30" y2="${topY}"/><line x1="40" y1="${yBottom}" x2="30" y2="${yBottom}"/>
    <line x1="33" y1="${topY}" x2="33" y2="${yBottom}"/>
    <path d="M31 ${topY + 5} L33 ${topY} L35 ${topY + 5}"/><path d="M31 ${yBottom - 5} L33 ${yBottom} L35 ${yBottom - 5}"/>
    <line x1="${xLeft}" y1="190" x2="${xRight}" y2="190"/>
    <line x1="${xLeft}" y1="186" x2="${xLeft}" y2="194"/><line x1="${xRight}" y1="186" x2="${xRight}" y2="194"/>
  </g>
  ${svgText(27, (topY + yBottom) / 2, `H=${number(model.mastHeightMm, 0)}`, { size: 4, anchor: 'middle', rotate: -90 })}
  ${svgText(xMid, 198, `a=${number(model.ribLengthMm, 0)}`, { size: 4, anchor: 'middle' })}
  ${model.moduleCount > modulesShown ? svgText(xMid, 108, `условно показано ${modulesShown} из ${model.moduleCount} модулей`, { size: 3.5, anchor: 'middle' }) : ''}
  ${svgText(105, 55, '1', { size: 5, weight: 'bold' })}<line x1="103" y1="57" x2="88" y2="75" class="eskd-thin"/>
  ${svgText(105, 95, '2', { size: 5, weight: 'bold' })}<line x1="103" y1="97" x2="90" y2="108" class="eskd-thin"/>
</svg>
<div class="eskd-tech">
  <h4>Технические требования</h4>
  <ol>
    <li>Мачту собирать из ${model.moduleCount} одинаковых модулей, ориентация — ножками вниз.</li>
    <li>Межмодульные соединения — по чертежу «${escapeHtml(model.jointName)}».</li>
    <li>Перед изготовлением присвоить обозначения КД по ГОСТ Р 2.201-2023 и заполнить подписи.</li>
    <li>Защитное покрытие и требования к монтажу задаются проектировщиком для конкретной площадки; автоматически не назначаются.</li>
  </ol>
  <h4>Позиции</h4><p>1 — ${escapeHtml(model.moduleName)}; 2 — ${escapeHtml(model.jointName)}.</p>
</div>
</div>`
}

function moduleDrawing(model) {
  return `
<div class="eskd-drawing-grid">
<svg class="eskd-drawing" viewBox="0 0 145 215" role="img" aria-label="Сборочный чертёж модуля мачты">
  <g class="eskd-thick">
    <polygon points="30,55 100,55 65,112" fill="none"/>
    <line x1="30" y1="55" x2="42" y2="155"/><line x1="100" y1="55" x2="88" y2="155"/>
    <line x1="65" y1="112" x2="42" y2="155"/><line x1="65" y1="112" x2="88" y2="155"/>
    <line x1="30" y1="55" x2="88" y2="155"/><line x1="100" y1="55" x2="42" y2="155"/>
  </g>
  <g class="eskd-thin">
    <line x1="22" y1="55" x2="17" y2="55"/><line x1="38" y1="155" x2="17" y2="155"/><line x1="20" y1="55" x2="20" y2="155"/>
    <line x1="30" y1="165" x2="100" y2="165"/><line x1="30" y1="160" x2="30" y2="170"/><line x1="100" y1="160" x2="100" y2="170"/>
  </g>
  ${svgText(14, 105, `h=${number(model.moduleHeightMm, 1)}`, { size: 4, anchor: 'middle', rotate: -90 })}
  ${svgText(65, 173, `a=${number(model.ribLengthMm, 1)}`, { size: 4, anchor: 'middle' })}
  ${svgText(112, 61, '1', { size: 5, weight: 'bold' })}<line x1="108" y1="63" x2="93" y2="66" class="eskd-thin"/>
  ${svgText(112, 126, '2', { size: 5, weight: 'bold' })}<line x1="108" y1="128" x2="88" y2="142" class="eskd-thin"/>
</svg>
<div class="eskd-tech">
  <h4>Технические требования</h4>
  <ol>
    <li>9 рёбер одинаковой длины ${number(model.ribLengthMm, 1)} мм.</li>
    <li>Материал рёбер: ${escapeHtml(model.reinforcement.label)}, Ø${number(model.ribDiameterMm, 0)}; ${escapeHtml(model.reinforcement.standard)}.</li>
    <li>Угловые швы: катет ${number(model.weldLegMm, 1)} мм; расчётная физическая длина не менее ${number(model.weldLengthMm, 1)} мм на конец.</li>
    <li>Сварочный материал: ${escapeHtml(model.weld?.label ?? model.mass.weld.uniformDesignRule)}${model.weld?.standard ? `; ${escapeHtml(model.weld.standard)}` : ''}.</li>
  </ol>
  <h4>Позиции</h4><p>1 — ребро; 2 — элементы межмодульного узла.</p>
</div>
</div>`
}

function jointDrawing(model) {
  const bolt = model.bolt
  const bottom = model.clearanceNut
  const top = model.couplingNut
  return `
<div class="eskd-drawing-grid">
<svg class="eskd-drawing" viewBox="0 0 145 215" role="img" aria-label="Сборочный чертёж межмодульного узла">
  <g class="eskd-thick">
    <rect x="56" y="42" width="20" height="45" fill="none"/>
    <rect x="53" y="105" width="26" height="18" fill="none"/>
    <rect x="62" y="35" width="8" height="98" fill="none"/>
    <polygon points="57,35 75,35 70,27 62,27" fill="none"/>
    <line x1="56" y1="55" x2="22" y2="33"/><line x1="76" y1="55" x2="110" y2="33"/>
    <line x1="56" y1="72" x2="22" y2="92"/><line x1="76" y1="72" x2="110" y2="92"/>
    <line x1="53" y1="113" x2="20" y2="145"/><line x1="79" y1="113" x2="112" y2="145"/>
  </g>
  <g class="eskd-thin">
    <line x1="90" y1="27" x2="90" y2="133"/><line x1="86" y1="27" x2="94" y2="27"/><line x1="86" y1="133" x2="94" y2="133"/>
  </g>
  ${svgText(97, 82, `Lболта=${number(bolt.lengthMm, 0)}`, { size: 4, anchor: 'middle', rotate: -90 })}
  ${svgText(118, 47, '1', { size: 5, weight: 'bold' })}<line x1="114" y1="49" x2="76" y2="63" class="eskd-thin"/>
  ${svgText(118, 112, '2', { size: 5, weight: 'bold' })}<line x1="114" y1="114" x2="79" y2="114" class="eskd-thin"/>
  ${svgText(118, 132, '3', { size: 5, weight: 'bold' })}<line x1="114" y1="134" x2="69" y2="126" class="eskd-thin"/>
</svg>
<div class="eskd-tech">
  <h4>Технические требования</h4>
  <ol>
    <li>Болт M${bolt.diameterMm}×${number(bolt.lengthMm, 0)}, класс ${escapeHtml(model.boltClass)}.</li>
    <li>Проходная гайка: M${bottom.threadDiameterMm}, размер под ключ ${number(bottom.acrossFlatsMm, 1)} мм.</li>
    <li>Длинная соединительная гайка: M${top.threadDiameterMm}×${number(top.lengthMm, 0)} мм.</li>
    <li>Болт свободно проходит через проходную гайку и ввинчивается в длинную; зацепление ${number(model.mass.hardware.bolt.threadEngagementMm ?? model.mass.hardware.couplingNut.threadEngagementMm, 1)} мм уточнять по итоговой геометрии.</li>
    <li>Сварные концы выполнять по расчётной длине не менее ${number(model.weldLengthMm, 1)} мм.</li>
  </ol>
  <h4>Позиции</h4><p>1 — длинная гайка; 2 — проходная гайка; 3 — болт.</p>
</div>
</div>`
}

function ribDrawing(model) {
  return `
<div class="eskd-drawing-grid">
<svg class="eskd-drawing" viewBox="0 0 145 215" role="img" aria-label="Чертёж детали ребра">
  <g class="eskd-thick"><rect x="18" y="92" width="108" height="12" rx="6" fill="none"/></g>
  <g class="eskd-thin">
    <line x1="18" y1="120" x2="126" y2="120"/><line x1="18" y1="114" x2="18" y2="126"/><line x1="126" y1="114" x2="126" y2="126"/>
    <line x1="132" y1="92" x2="132" y2="104"/><line x1="128" y1="92" x2="136" y2="92"/><line x1="128" y1="104" x2="136" y2="104"/>
  </g>
  ${svgText(72, 129, `${number(model.ribLengthMm, 1)} мм`, { size: 4.5, anchor: 'middle' })}
  ${svgText(138, 101, `Ø${number(model.ribDiameterMm, 0)}`, { size: 4.5, anchor: 'middle', rotate: -90 })}
</svg>
<div class="eskd-tech">
  <h4>Технические требования</h4>
  <ol>
    <li>Заготовка — арматурный стержень ${escapeHtml(model.reinforcement.label)} Ø${number(model.ribDiameterMm, 0)}.</li>
    <li>Длина после резки ${number(model.ribLengthMm, 1)} мм. Допуск длины должен быть назначен изготовителем исходя из принятого технологического процесса.</li>
    <li>Торцы подготовить под принятую технологию сварки; заусенцы удалить.</li>
    <li>Не подменять этим чертежом требования сертификата на фактическую партию стали.</li>
  </ol>
</div>
</div>`
}

function specificationTable(rows) {
  return `<table class="eskd-spec-table"><thead><tr><th>Формат</th><th>Зона</th><th>Поз.</th><th>Обозначение</th><th>Наименование</th><th>Кол.</th><th>Примечание</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.section ? 'eskd-spec-section' : ''}"><td>${escapeHtml(row.format ?? '')}</td><td>${escapeHtml(row.zone ?? '')}</td><td>${escapeHtml(row.position ?? '')}</td><td>${escapeHtml(row.designation ?? '')}</td><td>${escapeHtml(row.name ?? '')}</td><td>${escapeHtml(row.quantity ?? '')}</td><td>${escapeHtml(row.note ?? '')}</td></tr>`).join('')}</tbody></table>`
}

function mastSpecification(model) {
  return specificationTable([
    { section: true, name: 'Документация' },
    { format: 'А4', name: `${model.productName}. Сборочный чертеж`, quantity: '1', note: 'лист комплекта' },
    { section: true, name: 'Сборочные единицы' },
    { position: '1', name: model.moduleName, quantity: model.moduleCount, note: `${number(model.moduleHeightMm, 1)} мм` },
    { section: true, name: 'Примечание' },
    { name: 'Обозначения изделий и КД до выпуска в производство присваивает организация-разработчик по ГОСТ Р 2.201-2023.' },
  ])
}

function moduleSpecification(model) {
  return specificationTable([
    { section: true, name: 'Документация' },
    { format: 'А4', name: `${model.moduleName}. Сборочный чертеж`, quantity: '1' },
    { format: 'А4', name: `${model.ribName}. Чертеж детали`, quantity: '1' },
    { section: true, name: 'Детали' },
    { position: '1', name: `${model.ribName}, ${model.reinforcement.label} Ø${number(model.ribDiameterMm, 0)}×${number(model.ribLengthMm, 1)}`, quantity: '9', note: model.reinforcement.standard },
    { section: true, name: 'Стандартные и покупные изделия' },
    { position: '2', name: `Болт M${model.bolt.diameterMm}×${number(model.bolt.lengthMm, 0)}, класс ${model.boltClass}`, quantity: '3' },
    { position: '3', name: `Гайка проходная M${model.clearanceNut.threadDiameterMm}`, quantity: '3' },
    { position: '4', name: `Гайка соединительная M${model.couplingNut.threadDiameterMm}×${number(model.couplingNut.lengthMm, 0)}`, quantity: '3' },
    { section: true, name: 'Материалы' },
    { position: '5', name: model.weld?.label ?? 'Сварочный материал по расчёту', quantity: '—', note: model.weld?.standard ?? '' },
  ])
}

function normativeIntro(model) {
  return `
<section class="page-break eskd-package-intro">
<h2>15. Комплект конструкторской документации ЕСКД</h2>
<p>Ниже автоматически сформирован рабочий комплект КД для рассчитанной модульной мачты. Комплект включает спецификацию изделия, сборочный чертёж мачты, сборочный чертёж модуля, спецификацию модуля, сборочный чертёж межмодульного узла и чертёж детали ребра.</p>
<p><strong>Нормативная база:</strong> ${ESKD_STANDARDS.map((item) => `${escapeHtml(item.id)} — ${escapeHtml(item.purpose)}`).join('; ')}.</p>
<p class="notice"><strong>Статус документа:</strong> автоматически сформированный проект КД. Генератор намеренно не выдумывает код организации, уникальное обозначение, фамилии и подписи. Перед выпуском в производство организация-разработчик должна присвоить обозначения по ГОСТ Р 2.201-2023, заполнить реквизиты и подписи, назначить отсутствующие технологические допуски/покрытие и провести нормоконтроль. Расчётный HTML не является подписанным подлинником КД.</p>
<p>Схема экспорта: <code>${escapeHtml(model.schema)}</code>. Формат печатных листов — А4; рамка имеет поле подшивки 20 мм слева и 5 мм по остальным сторонам. Для графических листов используется основная надпись формы 1, для спецификаций — формы 2.</p>
</section>`
}

function styles() {
  return `<style>
@page eskd-a4 { size: A4 portrait; margin: 0; }
.eskd-sheet { page: eskd-a4; position: relative; width: 210mm; height: 297mm; margin: 0 auto; box-sizing: border-box; background: #fff; color: #000; break-before: page; break-after: page; font-family: Arial, sans-serif; font-size: 3.5mm; overflow: hidden; }
.eskd-frame { position: absolute; left: 20mm; top: 5mm; right: 5mm; bottom: 5mm; border: .7mm solid #000; box-sizing: border-box; }
.eskd-zone { position: absolute; font-size: 2.4mm; letter-spacing: 7mm; }
.eskd-zone-top { left: 28mm; top: 6mm; }
.eskd-sheet-content { position: absolute; left: 22mm; top: 12mm; width: 181mm; height: 221mm; box-sizing: border-box; }
.eskd-drawing-grid { display: grid; grid-template-columns: 1fr 58mm; gap: 3mm; width: 100%; height: 100%; }
.eskd-drawing { width: 100%; height: 100%; }
.eskd-drawing text { font-family: Arial, sans-serif; fill: #000; }
.eskd-drawing .eskd-thick, .eskd-thick { stroke: #000; stroke-width: 1.1; fill: none; }
.eskd-drawing .eskd-thin, .eskd-thin { stroke: #000; stroke-width: .45; fill: none; }
.eskd-tech { border-left: .35mm solid #000; padding-left: 3mm; font-size: 2.8mm; line-height: 1.25; }
.eskd-tech h4 { margin: 1mm 0; font-size: 3.2mm; }
.eskd-tech ol { padding-left: 5mm; margin: 1mm 0 3mm; }
.eskd-title-block { position: absolute; right: 5mm; bottom: 5mm; width: 185mm; border: .7mm solid #000; box-sizing: border-box; display: grid; grid-template-columns: 65mm 70mm 50mm; grid-template-rows: 15mm 15mm 10mm 15mm; font-size: 2.7mm; background: #fff; }
.eskd-title-form1 { height: 55mm; }
.eskd-title-form2 { height: 40mm; grid-template-rows: 15mm 10mm 15mm; }
.eskd-title-block > div { border-right: .35mm solid #000; border-bottom: .35mm solid #000; padding: 1mm; box-sizing: border-box; overflow: hidden; }
.eskd-approval-grid { grid-row: 1 / span 4; display: grid; grid-template-columns: 15mm 22mm 14mm 14mm; grid-auto-rows: 7mm; padding: 0 !important; }
.eskd-approval-grid span { border-right: .25mm solid #000; border-bottom: .25mm solid #000; padding: .8mm; }
.eskd-signature { min-width: 20mm; }
.eskd-title-name { grid-column: 2; grid-row: 1 / span 2; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 4.5mm; font-weight: 700; }
.eskd-title-designation { grid-column: 3; grid-row: 1; text-align: center; }
.eskd-title-designation strong { display: block; margin-top: 2mm; font-size: 3.7mm; }
.eskd-title-material { grid-column: 2; grid-row: 3; }
.eskd-title-meta { grid-column: 3; grid-row: 2 / span 2; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; padding: 0 !important; }
.eskd-title-meta span, .eskd-title-meta b { border-right: .25mm solid #000; border-bottom: .25mm solid #000; padding: 1mm .3mm; }
.eskd-title-sheet { grid-column: 2; grid-row: 4; display: grid; grid-template-columns: repeat(2, 1fr); text-align: center; padding: 0 !important; }
.eskd-title-sheet span, .eskd-title-sheet b { border-right: .25mm solid #000; padding: 1mm; }
.eskd-title-org { grid-column: 3; grid-row: 4; font-size: 2.4mm; }
.eskd-title-form2 .eskd-approval-grid { grid-row: 1 / span 3; }
.eskd-title-form2 .eskd-title-name { grid-row: 1; }
.eskd-title-form2 .eskd-title-designation { grid-row: 1; }
.eskd-title-form2 .eskd-title-material { display: none; }
.eskd-title-form2 .eskd-title-meta { grid-row: 2; }
.eskd-title-form2 .eskd-title-sheet { grid-row: 3; }
.eskd-title-form2 .eskd-title-org { grid-row: 3; }
.eskd-spec-table { width: 100%; border-collapse: collapse; font-size: 3mm; }
.eskd-spec-table th, .eskd-spec-table td { border: .3mm solid #000; padding: 1.2mm; height: 7mm; vertical-align: top; }
.eskd-spec-table th:nth-child(1) { width: 13mm; }.eskd-spec-table th:nth-child(2) { width: 10mm; }.eskd-spec-table th:nth-child(3) { width: 10mm; }.eskd-spec-table th:nth-child(4) { width: 34mm; }.eskd-spec-table th:nth-child(6) { width: 11mm; }.eskd-spec-table th:nth-child(7) { width: 30mm; }
.eskd-spec-section td { height: 10mm; font-weight: 700; text-decoration: underline; padding-top: 4mm; }
@media print { .eskd-sheet { margin: 0; box-shadow: none; } .eskd-package-intro { break-before: page; } }
</style>`
}

export function buildEskdConstructionDocumentationModel(result) {
  return resolveEskdModel(result)
}

export function createEskdConstructionDocumentation(result) {
  const model = resolveEskdModel(result)
  const sheets = 6
  const rebarMaterial = `${model.reinforcement.label} Ø${number(model.ribDiameterMm, 0)} · ${model.reinforcement.standard}`
  return `${styles()}${normativeIntro(model)}
${sheet({ model, name: `${model.productName}. Сборочный чертеж`, sheet: 1, sheets, body: mastDrawing(model) })}
${sheet({ model, name: `${model.productName}. Спецификация`, form: '2', sheet: 2, sheets, body: mastSpecification(model) })}
${sheet({ model, name: `${model.moduleName}. Сборочный чертеж`, sheet: 3, sheets, body: moduleDrawing(model) })}
${sheet({ model, name: `${model.moduleName}. Спецификация`, form: '2', sheet: 4, sheets, body: moduleSpecification(model) })}
${sheet({ model, name: `${model.jointName}. Сборочный чертеж`, sheet: 5, sheets, body: jointDrawing(model) })}
${sheet({ model, name: `${model.ribName}. Чертеж детали`, sheet: 6, sheets, material: rebarMaterial, body: ribDrawing(model) })}`
}
