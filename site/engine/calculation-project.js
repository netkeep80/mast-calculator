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
  if (mode === 'self-weight-overlimit') return 'собственный вес уже превышает расчётный предел'
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

function createV08Appendix(result) {
  const p = result.parameters
  const lateral = result.lateralCapacity
  const staticPayload = result.staticPayloadCapacity
  if (!lateral) throw new Error('Для бумажного проекта не выполнен расчёт боковой нагрузки вершины')
  if (!staticPayload) throw new Error('Для бумажного проекта не выполнен расчёт статической нагрузки вершины')

  const pressureSubstitution = `q = 0,5·1,225·${number(p.windSpeedMs, 3)}² = ${number(p.windPressurePa, 3)} Па`
  const memberForceN = lateral.memberLimitForceN
  const memberUnitUtilization = Number.isFinite(memberForceN) && memberForceN > 0
    ? 1 / memberForceN
    : 0

  return `
<section class="page-break">
<h2>10. Погодный сценарий, боковая и статическая нагрузки вершины</h2>

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
  <div>U(1 Н) = ${number(memberUnitUtilization, 8)}; худшее направление = ${number(lateral.memberLimitDirectionDeg, 0)}°</div>
  <div class="formula-result">Fmember = ${number(lateral.memberLimitForceN, 3)} Н = ${number(lateral.memberLimitForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Fglobal = λcr(1 Н)·1 Н</div>
  <div>отдельная огибающая eigen-buckling; худшее направление = ${number(lateral.globalBucklingDirectionDeg, 0)}°</div>
  <div class="formula-result">Fglobal = ${number(lateral.globalBucklingForceN, 3)} Н = ${number(lateral.globalBucklingForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Flim = min(Fmember, Fglobal)</div>
  <div>худшее направление первого предела = ${number(lateral.directionDeg, 0)}°</div>
  <div class="formula-result">Flim = ${number(lateral.criticalForceN, 3)} Н = ${number(lateral.criticalForceKgf, 1)} кгс; ${escapeHtml(modeLabel(lateral.governingMode))}</div>
</div>
<p>Пересчёт Н → кгс выполняется через стандартное ускорение свободного падения: <em>1 кгс = ${number(STANDARD_GRAVITY_M_S2, 5)} Н</em>.</p>

<table>
<thead><tr><th>Направление</th><th>Предел ребра, кгс</th><th>Глобальная устойчивость, кгс</th><th>Первый предел, кгс</th><th>Механизм</th></tr></thead>
<tbody>${lateralRows(lateral)}</tbody>
</table>

<h3>10.3. Максимальная статическая масса на вершине</h3>
<p>Для задачи водонапорной башни выполняется отдельный gravity-only расчёт. Собственный вес арматурного каркаса остаётся включённым с коэффициентом γg = ${number(p.deadLoadFactor, 3)}. Искомая суммарная масса на вершине прикладывается вертикально вниз поровну к трём верхним узлам с коэффициентом γpayload = ${number(p.equipmentLoadFactor, 3)}. Ветер, лёд, горизонтальные силы и прочие дополнительные нагрузки из этого специального сценария исключены.</p>
<div class="formula">
  <div class="formula-symbolic">Pdesign(m) = m·g·γpayload</div>
  <div>g = ${number(STANDARD_GRAVITY_M_S2, 5)} м/с²</div>
  <div class="formula-result">mmax = ${number(staticPayload.maximumTotalTopMassKg, 2)} кг; Pnom = ${number(staticPayload.maximumNominalTopForceN / 1000, 3)} кН; Pdesign = ${number(staticPayload.maximumDesignTopForceN / 1000, 3)} кН</div>
</div>
<p>Предел ищется по фактическому состоянию <em>с собственным весом</em>. Для каждого пробного значения массы решается статическая frame-задача и проверяются одновременно:</p>
<div class="formula">
  <div class="formula-symbolic">Umember(m) ≤ 1</div>
  <div class="formula-symbolic">λcr(m) ≥ 1</div>
  <div class="formula-result">на найденном пределе: U = ${number(staticPayload.utilizationAtLimit, 5)}, λcr = ${number(staticPayload.bucklingFactorAtLimit, 5)}; механизм — ${escapeHtml(modeLabel(staticPayload.governingMode))}</div>
</div>
<p>Чистый случай без собственного веса при массе 1 кг используется только для получения безопасной верхней границы поиска. Затем выполняется двоичное уточнение уже с собственным весом. Это не простое масштабирование результата 1 кг.</p>
<div class="formula">
  <div class="formula-symbolic">mreserve = mmax − meq,existing</div>
  <div>эквивалент уже заданных оборудования и вертикальной силы = ${number(staticPayload.configuredEquivalentTopMassKg, 2)} кг</div>
  <div class="formula-result">дополнительный резерв = ${number(staticPayload.remainingAdditionalMassKg, 2)} кг</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Vwater = mreserve / ρwater</div>
  <div>ρwater = ${number(staticPayload.waterDensityKgM3, 0)} кг/м³</div>
  <div class="formula-result">Vwater ≈ ${number(staticPayload.equivalentWaterVolumeM3, 4)} м³ = ${number(staticPayload.equivalentWaterVolumeLiters, 1)} л</div>
</div>
<p>Осадка верхней грани при найденном пределе: ${number(staticPayload.topSettlementAtLimitM * 1000, 3)} мм. Собственный вес в специальном сценарии: ${number(staticPayload.baseSelfWeightN / 1000, 3)} кН.</p>

<p class="notice"><strong>Область применимости.</strong> Значение <em>mmax</em> — расчётный гравитационный предел идеализированной frame-модели. Это не готовая паспортная грузоподъёмность водонапорной башни: реальная ёмкость дополнительно создаёт ветровую площадь и эксцентриситет, а конструкция имеет начальную кривизну, конечную жёсткость соединений и фундамент. Для рабочего проекта требуется сочетать вертикальную массу с ветром, снегом/льдом и нормативными коэффициентами.</p>
</section>`
}

export function createCalculationProjectHtml(
  result,
  parameters = result?.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo = {},
) {
  const base = createBaseCalculationNoteHtml(result, parameters, generatedAt, buildInfo)
  const appendix = createV08Appendix(result)
  if (!base.includes('</body>')) throw new Error('Базовый расчётный проект имеет некорректную HTML-структуру')
  return base.replace('</body>', `${appendix}\n</body>`)
}
