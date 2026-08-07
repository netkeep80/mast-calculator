import { createCalculationExport } from './report.js'

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const number = (value, digits = 3) => Number.isFinite(value)
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
  : '∞'

const tableRows = (rows) => rows.map((cells) => (
  `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
)).join('')

export function createCalculationNoteHtml(
  result,
  parameters = result?.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo = {},
) {
  const snapshot = createCalculationExport(result, parameters, generatedAt, buildInfo)
  const p = snapshot.parameters
  const s = snapshot.summary
  const material = snapshot.material
  const members = [...snapshot.members].sort((left, right) => right.utilization - left.utilization)

  const materialRows = material.groups.map((group) => [
    group.familyName,
    `Ø${number(group.diameterMm, 1)}`,
    `${number(group.lengthMm, 1)} мм`,
    group.count,
    `${number(group.totalLengthM, 3)} м`,
    `${number(group.totalMassKg, 3)} кг`,
  ])

  const loadRows = snapshot.loadCases.map((loadCase) => [
    `${number(loadCase.windDirectionDeg, 0)}°`,
    `${number(loadCase.loads.selfWeightN / 1000, 3)} кН`,
    `${number(loadCase.loads.memberWindN / 1000, 3)} кН`,
    `${number(loadCase.analysis.maxTopDisplacementM * 1000, 3)} мм`,
    number(loadCase.analysis.maxUtilization, 4),
    number(loadCase.analysis.buckling.criticalLoadFactor, 4),
  ])

  const memberRows = members.map((member) => [
    member.memberId,
    member.familyName,
    `${member.nodeA}–${member.nodeB}`,
    `${number(member.lengthM * 1000, 2)} мм`,
    member.mode === 'compression' ? 'сжатие' : 'растяжение',
    `${number(member.axialForceN / 1000, 4)} кН`,
    `${number(member.stressPa / 1e6, 3)} МПа`,
    `${number(member.designCapacityN / 1000, 4)} кН`,
    number(member.slenderness, 2),
    number(member.utilization, 4),
  ])

  const warningItems = snapshot.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
  const snapshotJson = JSON.stringify(snapshot, null, 2)
  const method = snapshot.software.method ?? {}
  const sha = snapshot.software.sha ?? 'не указан'

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Расчётная записка Mast Calculator</title>
<style>
  :root { font-family: Arial, sans-serif; color: #17212b; }
  body { max-width: 1180px; margin: 0 auto; padding: 28px; line-height: 1.42; }
  h1 { margin-bottom: 4px; }
  h2 { margin-top: 28px; border-bottom: 1px solid #ccd4dc; padding-bottom: 6px; }
  .meta, .notice { padding: 12px 14px; background: #f3f6f8; border-left: 4px solid #52697d; }
  .notice { border-left-color: #b87815; background: #fff8e9; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }
  .grid div { padding: 6px 0; border-bottom: 1px dotted #d8dee5; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cfd6dd; padding: 5px 7px; text-align: right; }
  th { background: #eef2f5; }
  td:nth-child(2), th:nth-child(2) { text-align: left; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f5f7f9; border: 1px solid #d7dee5; padding: 12px; font-size: 10px; }
  .bad { color: #a5232f; font-weight: bold; }
  @media print {
    body { max-width: none; padding: 0; font-size: 10pt; }
    h2 { break-after: avoid; }
    table, pre { break-inside: auto; }
    tr { break-inside: avoid; }
    details { display: block; }
    details > summary { display: none; }
  }
</style>
</head>
<body>
<h1>Расчётная записка</h1>
<p>Mast Calculator — расчёт арматурного каркаса модульной мачты</p>
<div class="meta">
  <strong>Схема данных:</strong> ${escapeHtml(snapshot.schema)}<br>
  <strong>Дата формирования:</strong> ${escapeHtml(snapshot.generatedAt)}<br>
  <strong>Метод:</strong> ${escapeHtml(method.id ?? 'не указан')} — ${escapeHtml(method.description ?? '')}<br>
  <strong>Git commit:</strong> ${escapeHtml(sha)}<br>
  <strong>Repository/ref:</strong> ${escapeHtml(snapshot.software.repository)} / ${escapeHtml(snapshot.software.ref ?? 'не указан')}
</div>

<p class="notice"><strong>Статус документа.</strong> Это автоматически сформированный протокол расчёта для технической проверки и воспроизведения. Он не является экспертным заключением или подтверждением нормативного соответствия. Таблицы ниже и встроенный JSON сформированы из того же объекта результата, который использует интерфейс программы; отдельный повторный расчёт при формировании документа не выполняется.</p>

<h2>1. Исходные данные</h2>
<div class="grid">
  <div><strong>Модулей:</strong> ${escapeHtml(p.moduleCount)}</div>
  <div><strong>Высота модуля:</strong> ${number(p.moduleHeightMm, 2)} мм</div>
  <div><strong>Закупочная длина:</strong> ${number(p.stockBarLengthMm, 0)} мм</div>
  <div><strong>Деление прутка:</strong> ${escapeHtml(p.stockBarPieces)} частей</div>
  <div><strong>Теоретическая длина отрезка:</strong> ${number(p.ribCutLengthMm, 2)} мм</div>
  <div><strong>Сторона расчётного треугольника:</strong> ${number(p.triangleSideMm, 2)} мм</div>
  <div><strong>Класс арматуры:</strong> ${escapeHtml(p.reinforcementClass)}</div>
  <div><strong>Стандарт материала:</strong> ${escapeHtml(p.reinforcementStandard)}</div>
  <div><strong>Диаметр:</strong> ${number(p.barDiameterMm, 1)} мм</div>
  <div><strong>Предел текучести:</strong> ${number(p.yieldStrengthMPa, 0)} МПа</div>
  <div><strong>Модуль упругости:</strong> ${number(p.youngModulusGPa, 0)} ГПа</div>
  <div><strong>Плотность:</strong> ${number(p.densityKgM3, 0)} кг/м³</div>
  <div><strong>Ветровое давление:</strong> ${number(p.windPressurePa, 1)} Па</div>
  <div><strong>Толщина льда:</strong> ${number(p.iceThicknessMm, 1)} мм</div>
  <div><strong>Масса оборудования:</strong> ${number(p.equipmentMassKg, 2)} кг</div>
  <div><strong>Парусная площадь:</strong> ${number(p.equipmentWindAreaM2, 3)} м²</div>
</div>

<h2>2. Расчётная модель</h2>
<p>Узлов: <strong>${snapshot.model.nodes.length}</strong>; стержней: <strong>${snapshot.model.members.length}</strong>; расчётных направлений ветра: <strong>${snapshot.loadCases.length}</strong>. Координаты узлов, связи стержней, закрепления, узловые нагрузки, перемещения, реакции и результаты каждого стержня сохранены без сокращения в машинном приложении в конце документа.</p>
<p>Текущая версия использует линейную 3D-ферму. Требуемая целевая архитектура предусматривает отдельную глобальную модель арматурного каркаса с идеальными жёсткими узлами и независимую проверку фактических болтовых/резьбовых/сварных узлов по переданным им усилиям и моментам.</p>

<h2>3. Сводные результаты</h2>
<div class="grid">
  <div><strong>Высота:</strong> ${number(s.heightM, 3)} м</div>
  <div><strong>Масса стержней:</strong> ${number(s.totalMassKg, 3)} кг</div>
  <div><strong>Макс. использование:</strong> <span class="${s.maximumUtilization > 1 ? 'bad' : ''}">${number(s.maximumUtilization, 4)}</span></div>
  <div><strong>Макс. отклонение вершины:</strong> ${number(s.maximumTopDisplacementMm, 3)} мм</div>
  <div><strong>Мин. множитель общей устойчивости:</strong> ${number(s.minimumBucklingFactor, 4)}</div>
  <div><strong>Определяющий ветер:</strong> ${number(s.governingWindDirectionDeg, 0)}°</div>
</div>

<h2>4. Расчётные случаи</h2>
<table>
<thead><tr><th>Ветер</th><th>Вес стали</th><th>Ветер на стержни</th><th>Отклонение вершины</th><th>Использование</th><th>λ устойчивости</th></tr></thead>
<tbody>${tableRows(loadRows)}</tbody>
</table>

<h2>5. Материальная ведомость расчётной модели</h2>
<table>
<thead><tr><th>Тип</th><th>Диаметр</th><th>Расчётная длина</th><th>Количество</th><th>Суммарная длина</th><th>Масса</th></tr></thead>
<tbody>${tableRows(materialRows)}</tbody>
</table>

<h2>6. Огибающая по стержням</h2>
<table>
<thead><tr><th>№</th><th>Тип</th><th>Узлы</th><th>Длина</th><th>Режим</th><th>N</th><th>σ</th><th>Несущая</th><th>Гибкость</th><th>Исп.</th></tr></thead>
<tbody>${tableRows(memberRows)}</tbody>
</table>

<h2>7. Численная диагностика</h2>
<div class="grid">
  <div><strong>Относительная невязка Ku−F:</strong> ${escapeHtml(snapshot.diagnostics.relativeResidual)}</div>
  <div><strong>Минимальное отношение pivot:</strong> ${escapeHtml(snapshot.diagnostics.minPivotRatio)}</div>
  <div><strong>Макс. невязка узлов:</strong> ${escapeHtml(snapshot.diagnostics.maximumNodeEquilibriumResidual)}</div>
  <div><strong>Глобальная невязка моментов:</strong> ${escapeHtml(snapshot.diagnostics.globalMomentResidual)}</div>
</div>

<h2>8. Ограничения и предупреждения</h2>
<ul>${warningItems}</ul>

<h2>9. Машинное приложение</h2>
<p>Ниже встроен полный канонический снимок расчёта. Он предназначен для независимого воспроизведения, автоматического сравнения версий и проверки того, какие именно данные использовались программой.</p>
<details open><summary>Полный JSON</summary><pre>${escapeHtml(snapshotJson)}</pre></details>
</body>
</html>`
}
