import { createCalculationNoteHtml as createBaseCalculationNoteHtml } from './calculation-note.js'
import { STANDARD_GRAVITY_M_S2 } from './lateral-capacity.js'

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const number = (value, digits = 3) => Number.isFinite(value)
  ? new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value)
  : '∞'

const modeLabel = (mode) => {
  if (mode === 'global-buckling') return 'общая потеря устойчивости'
  if (mode === 'local-member-buckling') return 'локальная устойчивость ребра'
  if (mode === 'material-strength') return 'прочность материала'
  return 'не определён'
}

function lateralRows(lateral) {
  return lateral.cases.map((item) => `
    <tr>
      <td>${number(item.directionDeg, 0)}°</td>
      <td>${number(item.memberLimitForceKgf, 1)}</td>
      <td>${number(item.globalBucklingForceKgf, 1)}</td>
      <td>${number(item.criticalForceKgf, 1)}</td>
      <td>${escapeHtml(modeLabel(item.governingMode))}</td>
    </tr>`).join('')
}

function createV06Appendix(result) {
  const p = result.parameters
  const lateral = result.lateralCapacity
  if (!lateral) {
    throw new Error('Для бумажного проекта не выполнен расчёт боковой нагрузки вершины')
  }

  const pressureSubstitution = `q = 0,5·1,225·${number(p.windSpeedMs, 3)}² = ${number(p.windPressurePa, 3)} Па`
  const memberForceN = lateral.memberLimitForceN
  const memberUnitUtilization = Number.isFinite(memberForceN) && memberForceN > 0
    ? 1 / memberForceN
    : 0

  return `
<section class="page-break">
<h2>10. Погодный сценарий и боковая испытательная нагрузка вершины</h2>

<h3>10.1. Погодный сценарий</h3>
<p>Выбран сценарий: <strong>${escapeHtml(p.windPresetLabel)}</strong>. Для сценариев шкалы Бофорта характерная скорость переводится в динамическое давление до применения коэффициента ветровой нагрузки.</p>
<div class="formula">
  <div class="formula-symbolic">q = ρv²/2</div>
  <div>${escapeHtml(pressureSubstitution)}</div>
  <div class="formula-result">q = ${number(p.windPressurePa, 3)} Па; γw = ${number(p.windLoadFactor, 3)}</div>
</div>
<p class="equation-note">Шкала Бофорта используется только как удобный набор сравнительных погодных сценариев. Нормативный расчёт по ветровому району, высоте, пульсации и порывам должен выполняться отдельно.</p>

<h3>10.2. Определение чистой боковой нагрузки</h3>
<p>Для возможности прямой натурной проверки вводится отдельный нормированный расчётный случай: горизонтальная сила <strong>1 Н</strong> прикладывается к геометрической вершине и поровну распределяется между тремя узлами верхней треугольной грани. В этом специальном случае отключены ветер, лёд, собственный вес, оборудование и дополнительные нагрузки. Благодаря линейности frame-модели внутренние усилия, напряжения и перемещения от этой силы масштабируются пропорционально прикладываемой силе.</p>
<div class="formula">
  <div class="formula-symbolic">Fmember = 1/U(1 Н)</div>
  <div>U(1 Н) = ${number(memberUnitUtilization, 8)}</div>
  <div class="formula-result">Fmember = ${number(lateral.memberLimitForceN, 3)} Н = ${number(lateral.memberLimitForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Fglobal = λcr(1 Н)·1 Н</div>
  <div>линейный eigen-buckling для единичного бокового случая</div>
  <div class="formula-result">Fglobal = ${number(lateral.globalBucklingForceN, 3)} Н = ${number(lateral.globalBucklingForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Flim = min(Fmember, Fglobal)</div>
  <div>худшее направление = ${number(lateral.directionDeg, 0)}°</div>
  <div class="formula-result">Flim = ${number(lateral.criticalForceN, 3)} Н = ${number(lateral.criticalForceKgf, 1)} кгс; ${escapeHtml(modeLabel(lateral.governingMode))}</div>
</div>
<p>Пересчёт Н → кгс выполняется через стандартное ускорение свободного падения: <em>1 кгс = ${number(STANDARD_GRAVITY_M_S2, 5)} Н</em>. Значение в кгс удобно интерпретировать как силу от подвешенной массы в килограммах при стандартной гравитации.</p>

<table>
<thead><tr><th>Направление</th><th>Предел ребра, кгс</th><th>Глобальная устойчивость, кгс</th><th>Первый предел, кгс</th><th>Механизм</th></tr></thead>
<tbody>${lateralRows(lateral)}</tbody>
</table>

<p class="notice"><strong>Интерпретация для натурного теста.</strong> Это чистый сравнительный случай для проверки расчётного ядра, а не разрешённая рабочая грузоподъёмность крана. Реальная мачта во время испытания имеет собственный вес, начальную кривизну, люфты и конечную жёсткость узлов; геометрическая нелинейность в текущем solver не учитывается. Деструктивное испытание до потери устойчивости требует удалённого нагружения и исключения нахождения людей в плоскости возможного падения.</p>
</section>`
}

export function createCalculationProjectHtml(
  result,
  parameters = result?.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo = {},
) {
  const base = createBaseCalculationNoteHtml(result, parameters, generatedAt, buildInfo)
  const appendix = createV06Appendix(result)
  if (!base.includes('</body>')) throw new Error('Базовый расчётный проект имеет некорректную HTML-структуру')
  return base.replace('</body>', `${appendix}\n</body>`)
}
