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
  if (mode === 'bolt-connection') return 'межмодульный болт'
  if (mode === 'self-weight-overlimit') return 'собственный вес уже превышает расчётный предел'
  return 'не определён'
}

const verificationStatusLabel = (status) => {
  if (status === 'pass') return 'ПРОЙДЕНО'
  if (status === 'fail') return 'ОШИБКА'
  return 'НЕ ПРОВЕРЕНО'
}

const verificationStatusMark = (status) => {
  if (status === 'pass') return '✓'
  if (status === 'fail') return '✗'
  return '○'
}

function lateralRows(lateral) {
  return lateral.cases.map((item) => `
    <tr>
      <td>${number(item.directionDeg, 0)}°</td>
      <td>${number(item.memberLimitForceKgf, 1)}</td>
      <td>${number(item.globalBucklingForceKgf, 1)}</td>
      <td>${number(item.boltLimitForceKgf, 1)}</td>
      <td>${number(item.criticalForceKgf, 1)}</td>
      <td>${escapeHtml(modeLabel(item.governingMode))}</td>
    </tr>`).join('')
}

function createLoadAppendix(result) {
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
<p>Горизонтальная сила <strong>1 Н</strong> прикладывается к геометрической вершине и поровну распределяется между тремя верхними узлами. В специальном случае отключены ветер, лёд, собственный вес, оборудование и дополнительные нагрузки. В версии 1.0 первый предел учитывает не только ребро и global buckling, но и выбранный межмодульный болт.</p>
<div class="formula">
  <div class="formula-symbolic">Fmember = 1/Umember(1 Н)</div>
  <div>U(1 Н) = ${number(memberUnitUtilization, 8)}; худшее направление = ${number(lateral.memberLimitDirectionDeg, 0)}°</div>
  <div class="formula-result">Fmember = ${number(lateral.memberLimitForceN, 3)} Н = ${number(lateral.memberLimitForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Fglobal = λcr(1 Н)·1 Н</div>
  <div>худшее направление = ${number(lateral.globalBucklingDirectionDeg, 0)}°</div>
  <div class="formula-result">Fglobal = ${number(lateral.globalBucklingForceN, 3)} Н = ${number(lateral.globalBucklingForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Fbolt = 1/Ubolt(1 Н)</div>
  <div>худшее направление = ${number(lateral.boltLimitDirectionDeg, 0)}°</div>
  <div class="formula-result">Fbolt = ${number(lateral.boltLimitForceN, 3)} Н = ${number(lateral.boltLimitForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Flim = min(Fmember, Fglobal, Fbolt)</div>
  <div>худшее направление первого предела = ${number(lateral.directionDeg, 0)}°</div>
  <div class="formula-result">Flim = ${number(lateral.criticalForceN, 3)} Н = ${number(lateral.criticalForceKgf, 1)} кгс; ${escapeHtml(modeLabel(lateral.governingMode))}</div>
</div>
<p>Пересчёт Н → кгс выполняется через стандартное ускорение свободного падения: <em>1 кгс = ${number(STANDARD_GRAVITY_M_S2, 5)} Н</em>.</p>

<table>
<thead><tr><th>Направление</th><th>Ребро, кгс</th><th>Global buckling, кгс</th><th>Болт, кгс</th><th>Первый предел, кгс</th><th>Механизм</th></tr></thead>
<tbody>${lateralRows(lateral)}</tbody>
</table>

<h3>10.3. Максимальная статическая масса на вершине</h3>
<p>Для gravity-only задачи собственный вес каркаса остаётся включённым с γg = ${number(p.deadLoadFactor, 3)}. Искомая суммарная масса на вершине прикладывается вертикально вниз поровну к трём верхним узлам с γpayload = ${number(p.equipmentLoadFactor, 3)}. Ветер, лёд и горизонтальные нагрузки исключены, но выбранный межмодульный болт проверяется при каждой итерации.</p>
<div class="formula">
  <div class="formula-symbolic">Pdesign(m) = m·g·γpayload</div>
  <div>g = ${number(STANDARD_GRAVITY_M_S2, 5)} м/с²</div>
  <div class="formula-result">mmax = ${number(staticPayload.maximumTotalTopMassKg, 2)} кг; Pnom = ${number(staticPayload.maximumNominalTopForceN / 1000, 3)} кН; Pdesign = ${number(staticPayload.maximumDesignTopForceN / 1000, 3)} кН</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Umember(m) ≤ 1; Ubolt(m) ≤ 1; λcr(m) ≥ 1</div>
  <div class="formula-result">на пределе: Umember = ${number(staticPayload.utilizationAtLimit, 5)}, Ubolt = ${number(staticPayload.boltUtilizationAtLimit, 5)}, λcr = ${number(staticPayload.bucklingFactorAtLimit, 5)}; механизм — ${escapeHtml(modeLabel(staticPayload.governingMode))}</div>
</div>
<p>Чистый случай без собственного веса при массе 1 кг используется только для верхней границы поиска. Затем выполняется двоичное уточнение уже с собственным весом.</p>
<div class="formula">
  <div class="formula-symbolic">mreserve = mmax − meq,existing</div>
  <div>эквивалент заданных оборудования и вертикальной силы = ${number(staticPayload.configuredEquivalentTopMassKg, 2)} кг</div>
  <div class="formula-result">дополнительный резерв = ${number(staticPayload.remainingAdditionalMassKg, 2)} кг</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Vwater = mreserve / ρwater</div>
  <div>ρwater = ${number(staticPayload.waterDensityKgM3, 0)} кг/м³</div>
  <div class="formula-result">Vwater ≈ ${number(staticPayload.equivalentWaterVolumeM3, 4)} м³ = ${number(staticPayload.equivalentWaterVolumeLiters, 1)} л</div>
</div>
<p>Осадка верхней грани при найденном пределе: ${number(staticPayload.topSettlementAtLimitM * 1000, 3)} мм.</p>
<p class="notice"><strong>Область применимости.</strong> Значение <em>mmax</em> остаётся пределом идеализированной frame-модели. Реальная ёмкость создаёт ветровую площадь и эксцентриситет; реальные узлы имеют конечную жёсткость; основание и фундамент рассчитываются отдельно.</p>
</section>`
}

function boltRecommendationRows(connections) {
  return connections.bolt.recommendationsByClass.map((item) => {
    const recommended = item.recommended
    const governing = recommended?.evaluation?.governingDemand
    return `
<tr>
<td>${escapeHtml(item.boltClass)}</td>
<td>${recommended ? `M${recommended.diameterMm}×${recommended.pitchMm}` : 'не найден'}</td>
<td>${recommended ? number(recommended.evaluation.utilization, 4) : '—'}</td>
<td>${governing ? `${governing.level} / ${governing.nodeId}` : '—'}</td>
<td>${governing ? `${number(governing.windDirectionDeg, 0)}°` : '—'}</td>
</tr>`
  }).join('')
}

function weldRows(connections, limit = 20) {
  return connections.weld.envelope.slice(0, limit).map((item) => `
<tr>
<td>${item.memberId}${escapeHtml(item.end)}</td>
<td>${item.nodeId}</td>
<td>${number(item.windDirectionDeg, 0)}°</td>
<td>${number(item.axialForceN / 1000, 3)}</td>
<td>${number(item.shearForceN / 1000, 3)}</td>
<td>${number(item.torsionNm, 2)}</td>
<td>${number(item.bendingNm, 2)}</td>
<td>${number(item.check.requiredEffectiveLengthMm, 1)}</td>
<td>${number(item.check.requiredPhysicalLengthMm, 1)}</td>
</tr>`).join('')
}

function createConnectionAppendix(result) {
  const p = result.parameters
  const connections = result.connections
  if (!connections) throw new Error('Для бумажного проекта не выполнен расчёт соединительных узлов')
  const selected = connections.bolt.selected
  const demand = selected?.governingDemand
  const bolt = selected?.governingCheck
  const criticalWeld = connections.weld.critical
  const electrode = connections.weld.electrodeRecommendation.recommended
  const wire = connections.weld.wireRecommendation.recommended
  const selectedBoltText = demand && bolt
    ? `Определяющий узел ${demand.nodeId} на уровне ${demand.level}, ветер ${number(demand.windDirectionDeg, 0)}°. Nt=${number(bolt.tensionN / 1000, 3)} кН, Ns=${number(bolt.shearN / 1000, 3)} кН.`
    : 'При одном модуле внутренних межмодульных стыков нет.'

  return `
<section class="page-break">
<h2>11. Межмодульный болт и сварные концы рёбер</h2>
<p>Источник расчётных сопротивлений и площадей болтов: <strong>СП 16.13330.2017, ред. 09.12.2024</strong>, таблицы Г.5 и Г.9, формулы 186, 188 и проверка совместного среза/растяжения по 14.2.13. Для угловых швов используются требования 14.1.16–14.1.19 и таблица Г.2. Каталог резьбы использует обычный крупный шаг метрической резьбы.</p>

<h3>11.1. Физическое разделение межмодульного узла</h3>
<p>${escapeHtml(connections.physicalSplit)} В расчётном узле выделяются два ребра, уходящие на следующий уровень. Их совпадающие конечные силы и моменты суммируются и передаются одному вертикальному болту. Для мачты из ${p.moduleCount} модулей внутренних стыков: ${connections.jointCount}.</p>
<div class="formula">
  <div class="formula-symbolic">Nt = max(0, −Faxis) + |Mb|/reff</div>
  <div class="formula-symbolic">Ns = |F⊥| + |T|/reff</div>
  <div>reff = ${number(p.jointEffectiveRadiusMm, 1)} мм</div>
  <div class="formula-result">${escapeHtml(selectedBoltText)}</div>
</div>
<p class="equation-note">Знак Faxis соответствует end-force верхней отсечённой части: положительный Faxis сжимает контакт и не превращается в фиктивное растяжение болта; отрицательный разрывает стык. Чтобы не завышать выгоду неизвестного распределения контактных давлений, сжатие пока не вычитается из prying-составляющей |Mb|/reff. Перевод M/T через <em>reff</em> остаётся консервативной surrogate-моделью одного болта с контактной зоной. Значение reff должно быть подтверждено реальными размерами шайбы, гайки, торца и упора.</p>

<h3>11.2. Расчёт выбранного болта</h3>
${bolt ? `
<p>Выбран болт <strong>M${bolt.diameterMm}×${bolt.pitchMm}, класс ${escapeHtml(bolt.boltClass)}</strong>. Для одного болта принято ns=${number(bolt.shearPlanes, 0)}, γb=1,0 и γc=${number(bolt.connectionConditionFactor, 3)}.</p>
<div class="formula">
  <div class="formula-symbolic">Nbs = Rbs·Ab·ns·γb·γc</div>
  <div>${number(bolt.rbsMPa, 0)}·${number(bolt.grossAreaMm2, 0)}·${number(bolt.shearPlanes, 0)}·1·${number(bolt.connectionConditionFactor, 3)}</div>
  <div class="formula-result">Nbs = ${number(bolt.shearCapacityN / 1000, 3)} кН</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Nbt = Rbt·Abn·γc</div>
  <div>${number(bolt.rbtMPa, 0)}·${number(bolt.netAreaMm2, 0)}·${number(bolt.connectionConditionFactor, 3)}</div>
  <div class="formula-result">Nbt = ${number(bolt.tensionCapacityN / 1000, 3)} кН</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Ubolt = √[(Ns/Nbs)² + (Nt/Nbt)²]</div>
  <div>Ns=${number(bolt.shearN / 1000, 3)} кН; Nt=${number(bolt.tensionN / 1000, 3)} кН</div>
  <div class="formula-result">Ubolt = ${number(bolt.interactionUtilization, 5)} — ${bolt.passes ? 'ПРОХОДИТ' : 'НЕ ПРОХОДИТ'}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Nu,characteristic = Rbun·Abn</div>
  <div>${number(bolt.rbunMPa, 0)}·${number(bolt.netAreaMm2, 0)}</div>
  <div class="formula-result">${number(bolt.characteristicRuptureN / 1000, 3)} кН</div>
</div>
<p><strong>Важно:</strong> Rbun·Abn показано именно как нормативная характеристическая оценка разрыва резьбового сечения, а не как разрешённая рабочая нагрузка. Расчётная проверка выполняется через Rbt/Rbs и коэффициенты.</p>` : '<p>Внутренний межмодульный болт не применяется, поскольку модель состоит из одного модуля.</p>'}

<h3>11.3. Минимальный диаметр при разных классах прочности</h3>
<table>
<thead><tr><th>Класс болта</th><th>Минимальный размер</th><th>Использование</th><th>Уровень / узел</th><th>Ветер</th></tr></thead>
<tbody>${boltRecommendationRows(connections)}</tbody>
</table>
<p>Размеры 18, 22 и 27 мм не включены в общий автоматический подбор: в таблице Г.9 СП 16 они даны в скобках для конструкций опор ВЛ и ОРУ. Класс 5.8 не подбирается при наличии растяжения, поскольку таблица Г.5 не задаёт для него Rbt.</p>

<h3>11.4. Минимальная длина угловых швов на каждом конце ребра</h3>
${criticalWeld ? `
<p>Выбран материал <strong>${escapeHtml(criticalWeld.check.consumableLabel)}</strong>, катет kf=${number(p.weldLegMm, 1)} мм, число непрерывных участков на конец ${p.weldSegmentsPerEnd}. Более слабое Rm основных металлов принято ${number(connections.weld.weakerBaseMetalRunMPa, 0)} МПа; Rwz=0,45Run=${number(criticalWeld.check.rwzMPa, 2)} МПа.</p>
<p>Поскольку фактическая пространственная форма трёх швов на гайке пока задаётся только суммарной длиной, моменты приводятся к консервативной круговой сварной группе с радиусом ${number(criticalWeld.check.weldGroupRadiusMm, 2)} мм:</p>
<div class="formula">
  <div class="formula-symbolic">Qw = √[(|N|+2|M|/rw)² + (|V|+|T|/rw)²]</div>
  <div class="formula-result">критический конец ${criticalWeld.memberId}${escapeHtml(criticalWeld.end)}: Qw = ${number(criticalWeld.check.equivalentConditionalForceN / 1000, 3)} кН</div>
</div>
<div class="formula">
  <div class="formula-symbolic">lw,f = Qw/(βf·kf·Rwf·γc)</div>
  <div class="formula-symbolic">lw,z = Qw/(βz·kf·Rwz·γc)</div>
  <div class="formula-symbolic">lw = max(lw,f, lw,z, 4kf, 40 мм)</div>
  <div class="formula-result">lw = ${number(criticalWeld.check.requiredEffectiveLengthMm, 1)} мм; физическая сумма = lw + 10·nsegments = ${number(criticalWeld.check.requiredPhysicalLengthMm, 1)} мм</div>
</div>
<p>При равном делении требуется ориентировочно ${number(criticalWeld.check.requiredPhysicalLengthPerSegmentMm, 1)} мм физической длины на каждый из ${p.weldSegmentsPerEnd} непрерывных участков.</p>
<p>Минимальный сварочный материал по принятому условию Rwun ≥ Run более слабого основного металла: электрод — <strong>${escapeHtml(electrode?.label ?? 'не найден')}</strong>; проволока — <strong>${escapeHtml(wire?.label ?? 'не найдена')}</strong>.</p>` : '<p>Сварная проверка не сформирована.</p>'}

<table>
<thead><tr><th>Конец</th><th>Узел</th><th>Ветер</th><th>N, кН</th><th>V, кН</th><th>T, Н·м</th><th>M, Н·м</th><th>Расч. lw, мм</th><th>Физ. длина, мм</th></tr></thead>
<tbody>${weldRows(connections)}</tbody>
</table>
<p class="equation-note">В таблице показаны 20 наиболее требовательных концов. Полная ведомость длин сварки присутствует в расчётном result/snapshot и CSV по рёбрам.</p>

<p class="notice"><strong>Граница модели узла.</strong> Эта версия закрывает требуемые issue #15 проверки разрыва/среза болта и требуемой длины угловых швов, но не выдаёт фиктивную точность там, где не задана геометрия. Смятие деталей, вырыв внутренней резьбы гайки/муфты, prying, затяжка/проскальзывание, усталость, конечная податливость стыка и реальное распределение напряжений в сварной группе требуют размеров конкретного изготовленного узла и отдельной валидации.</p>
</section>`
}

function verificationCheckHtml(check) {
  const formula = check.formula
    ? `<div class="formula"><div class="formula-symbolic">${escapeHtml(check.formula)}</div>${check.substitution ? `<div>${escapeHtml(check.substitution)}</div>` : ''}${Number.isFinite(check.expected) ? `<div class="formula-result">ожидается ${number(check.expected, 10)}${check.unit ? ` ${escapeHtml(check.unit)}` : ''}; программа ${number(check.actual, 10)}${check.unit ? ` ${escapeHtml(check.unit)}` : ''}</div>` : ''}</div>`
    : ''
  const evidence = check.evidence ? `<p><strong>Контрольное значение:</strong> ${escapeHtml(check.evidence)}</p>` : ''
  return `
<article>
<h4>${verificationStatusMark(check.status)} ${escapeHtml(check.title)} — ${verificationStatusLabel(check.status)}</h4>
<p>${escapeHtml(check.explanation)}</p>
${formula}
${evidence}
<p><strong>Как проверить самому:</strong> ${escapeHtml(check.howToCheck)}</p>
</article>`
}

function createVerificationAppendix(result) {
  const verification = result.verification
  if (!verification) throw new Error('Для бумажного проекта не сформирован паспорт верификации')

  const levels = verification.levels.map((level) => `
<tr>
<td>${level.number}</td>
<td>${escapeHtml(level.title)}</td>
<td>${verificationStatusMark(level.status)} ${verificationStatusLabel(level.status)}</td>
<td>${escapeHtml(level.description)}</td>
</tr>`).join('')

  const internalChecks = verification.checks.filter((check) => check.level <= 4)
    .map(verificationCheckHtml).join('')
  const externalChecks = verification.checks.filter((check) => check.level >= 5)
    .map(verificationCheckHtml).join('')

  return `
<section class="page-break">
<h2>12. Паспорт верификации: как неспециалисту проверять расчёт</h2>
<p><strong>${escapeHtml(verification.headline)}</strong></p>
<p>${escapeHtml(verification.explanation)}</p>
<p>Проверки разбиты по уровням. Первые четыре уровня программа воспроизводимо проверяет сама; последние намеренно остаются незелёными до независимого подтверждения.</p>
<table>
<thead><tr><th>Уровень</th><th>Что проверяется</th><th>Статус</th><th>Смысл</th></tr></thead>
<tbody>${levels}</tbody>
</table>
<p>Автоматически пройдено ${verification.counts.passed}, ошибок ${verification.counts.failed}, внешне не подтверждено ${verification.counts.notVerified}. <strong>Внутренняя проверка не означает доказанную безопасность реальной конструкции.</strong></p>
<h3>12.1. Шаги, которые можно повторить самому</h3>
${internalChecks}
<h3>12.2. Что программа принципиально не может подтвердить сама</h3>
${externalChecks}
<h3>12.3. Правило принятия результата</h3>
<ol>
<li>Любой внутренний статус «ОШИБКА» — результат не использовать до устранения причины.</li>
<li>Зелёные уровни 1–4 подтверждают только внутреннюю согласованность реализации.</li>
<li>Для инженерного проекта нужен сторонний FEM и рецензия инженера.</li>
<li>Для ответственной реальной конструкции нужна безопасная программа натурной валидации.</li>
</ol>
</section>`
}

export function createCalculationProjectHtml(
  result,
  parameters = result?.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo = {},
) {
  const base = createBaseCalculationNoteHtml(result, parameters, generatedAt, buildInfo)
  const loadAppendix = createLoadAppendix(result)
  const connectionAppendix = createConnectionAppendix(result)
  const verificationAppendix = createVerificationAppendix(result)
  if (!base.includes('</body>')) throw new Error('Базовый расчётный проект имеет некорректную HTML-структуру')
  return base.replace('</body>', `${loadAppendix}\n${connectionAppendix}\n${verificationAppendix}\n</body>`)
}
