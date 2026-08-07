import { createCalculationNoteHtml as createBaseCalculationNoteHtml } from './calculation-note.js'
import { STANDARD_GRAVITY_M_S2 } from './lateral-capacity.js'

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const number = (value, digits = 3) => Number.isFinite(value)
  ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)
  : '∞'

const modeLabel = (mode) => {
  if (mode === 'global-buckling') return 'общая потеря устойчивости'
  if (mode === 'local-member-buckling') return 'локальная потеря устойчивости ребра'
  if (mode === 'tensile-rupture') return 'растягивающий разрыв ребра'
  if (mode === 'material-strength') return 'прочность материала'
  if (mode === 'bolt-connection') return 'межмодульный болт'
  if (mode === 'serviceability-displacement') return 'эксплуатационный прогиб'
  if (mode === 'self-weight-overlimit') return 'собственный вес уже превышает предел'
  return 'не определён'
}

const statusLabel = (status) => status === 'pass' ? 'ПРОЙДЕНО' : status === 'fail' ? 'ОШИБКА' : 'НЕ ПРОВЕРЕНО'
const statusMark = (status) => status === 'pass' ? '✓' : status === 'fail' ? '✗' : '○'

function createLoadAppendix(result) {
  const p = result.parameters
  const lateral = result.lateralCapacity
  const staticPayload = result.staticPayloadCapacity
  if (!lateral || !staticPayload) throw new Error('Для бумажного проекта отсутствуют специальные предельные расчёты')
  return `
<section class="page-break">
<h2>10. Погода, боковая и статическая нагрузки вершины</h2>
<h3>10.1. Погодный сценарий</h3>
<p>Выбран сценарий: <strong>${escapeHtml(p.windPresetLabel)}</strong>. Для сценариев Бофорта скорость переводится в динамическое давление:</p>
<div class="formula">
  <div class="formula-symbolic">q = ρv²/2</div>
  <div>q = 0,5·1,225·${number(p.windSpeedMs, 3)}² = ${number(p.windPressurePa, 3)} Па</div>
  <div class="formula-result">γw = ${number(p.windLoadFactor, 3)}</div>
</div>
<p class="equation-note">Бофорт здесь является сравнительным сценарием, а не заменой нормативному ветровому району и сочетаниям СП 20.</p>

<h3>10.2. Чистая боковая сила вершины</h3>
<p>Специальный unit-load case прикладывает к верхней треугольной грани горизонтальную результирующую 1 Н, отключая собственный вес, лёд, ветер и оборудование.</p>
<div class="formula">
  <div class="formula-symbolic">Fmember = 1/Umember(1 Н)</div>
  <div class="formula-result">${number(lateral.memberLimitForceN, 3)} Н = ${number(lateral.memberLimitForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Fglobal = λcr(1 Н)·1 Н</div>
  <div class="formula-result">${number(lateral.globalBucklingForceN, 3)} Н = ${number(lateral.globalBucklingForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Fbolt = 1/Ubolt(1 Н)</div>
  <div class="formula-result">${number(lateral.boltLimitForceN, 3)} Н = ${number(lateral.boltLimitForceKgf, 1)} кгс</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Flim = min(Fmember, Fglobal, Fbolt)</div>
  <div class="formula-result">Flim = ${number(lateral.criticalForceN, 3)} Н = ${number(lateral.criticalForceKgf, 1)} кгс; ${escapeHtml(modeLabel(lateral.governingMode))}; направление ${number(lateral.directionDeg, 0)}°</div>
</div>
<p>1 кгс = ${number(STANDARD_GRAVITY_M_S2, 5)} Н.</p>

<h3>10.3. Максимальная статическая масса на вершине</h3>
<p>Gravity-only search сохраняет собственный вес и прикладывает пробную массу к трём верхним узлам. Ветер и лёд выключены.</p>
<div class="formula">
  <div class="formula-symbolic">Pdesign(m) = m·g·γpayload</div>
  <div class="formula-result">mmax = ${number(staticPayload.maximumTotalTopMassKg, 2)} кг; Pdesign = ${number(staticPayload.maximumDesignTopForceN / 1000, 3)} кН</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Umember(m) ≤ 1; Ubolt(m) ≤ 1; λcr(m) ≥ 1</div>
  <div class="formula-result">Umember=${number(staticPayload.utilizationAtLimit, 5)}, Ubolt=${number(staticPayload.boltUtilizationAtLimit, 5)}, λcr=${number(staticPayload.bucklingFactorAtLimit, 5)}; ${escapeHtml(modeLabel(staticPayload.governingMode))}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Vwater = mreserve / ρwater</div>
  <div class="formula-result">${number(staticPayload.equivalentWaterVolumeM3, 4)} м³ = ${number(staticPayload.equivalentWaterVolumeLiters, 1)} л при ρwater=${number(staticPayload.waterDensityKgM3, 0)} кг/м³</div>
</div>
</section>`
}

function createConnectionAppendix(result) {
  const p = result.parameters
  const connections = result.connections
  if (!connections) throw new Error('Для бумажного проекта отсутствует расчёт соединений')
  const configurator = connections.configurator
  const geometry = configurator?.geometry
  const selected = connections.bolt.selected
  const demand = selected?.governingDemand
  const check = selected?.governingCheck
  const criticalWeld = connections.weld.critical
  const recommendationRows = connections.bolt.recommendationsByClass.map((item) => {
    const candidate = item.recommended
    const governing = candidate?.evaluation?.governingDemand
    return `<tr><td>${escapeHtml(item.boltClass)}</td><td>${candidate ? `M${candidate.diameterMm}×${candidate.pitchMm}` : 'не найден'}</td><td>${candidate ? number(candidate.evaluation.utilization, 4) : '—'}</td><td>${governing ? `ур. ${governing.level}, узел ${governing.nodeId}` : '—'}</td></tr>`
  }).join('')
  const bottom = geometry?.bottomClearanceNut
  const top = geometry?.topCouplingNut
  const bolt = geometry?.bolt

  return `
<section class="page-break">
<h2>11. Межмодульный узел: две гайки, болт и сварные концы</h2>
<h3>11.1. Фактически выбранная физическая компоновка</h3>
<p>Режим конфигуратора: <strong>${escapeHtml(configurator?.modeLabel ?? 'не указан')}</strong>. Внутренних стыков: ${connections.jointCount}. К проходной гайке ножки приварены два ребра; к длинной соединительной гайке верхнего узла — четыре ребра. Болт свободно проходит через первую гайку и ввинчивается только во вторую.</p>
<table>
<thead><tr><th>Деталь/параметр</th><th>Выбранное значение</th><th>Проверяемый смысл</th></tr></thead>
<tbody>
<tr><td>Болт</td><td>${bolt ? `M${bolt.diameterMm} × ${number(bolt.lengthMm, 0)} мм, класс ${escapeHtml(configurator.selected.boltClass)}` : '—'}</td><td>длина болта не меньше требуемой компоновочной длины</td></tr>
<tr><td>Проходная гайка ножки</td><td>${bottom ? `M${bottom.threadDiameterMm}; 2 ребра; D1≈${number(bottom.basicMinorDiameterMm, 2)} мм` : '—'}</td><td>${bottom ? `диаметральный зазор относительно болта ≈ ${number(bottom.diametralClearanceMm, 2)} мм` : '—'}</td></tr>
<tr><td>Длинная соединительная гайка</td><td>${top ? `M${top.threadDiameterMm} × ${number(top.lengthMm, 0)} мм; 4 ребра` : '—'}</td><td>резьба совпадает с болтом</td></tr>
<tr><td>Длина зацепления</td><td>${geometry ? `${number(geometry.threadEngagementMm, 1)} мм = ${number(geometry.threadEngagementFactor, 2)}d` : '—'}</td><td>${geometry ? `≈ ${number(geometry.engagedThreadTurns, 1)} витков` : '—'}</td></tr>
<tr><td>Минимальная длина болта</td><td>${bolt ? `${number(bolt.minimumRequiredLengthMm, 1)} мм` : '—'}</td><td>${bolt ? `принята стандартная длина ${number(bolt.lengthMm, 0)} мм` : '—'}</td></tr>
<tr><td>Эффективный радиус reff</td><td>${number(p.jointEffectiveRadiusMm, 1)} мм</td><td>половина размера под ключ длинной гайки</td></tr>
</tbody>
</table>
<p class="equation-note">Правило зацепления ${geometry ? number(geometry.threadEngagementFactor, 2) : '—'}d является правилом компоновки. Срыв внутренней/наружной резьбы по фактическому материалу гайки пока не рассчитан. Геометрию конкретных купленных гаек следует сверять с каталогом поставщика.</p>

<h3>11.2. Расчёт соединительного болта</h3>
<p>Physical joint layer получает совпадающие frame end-actions одного load case. Ось болта вертикальна; reff выводится из геометрии длинной соединительной гайки, а не задаётся произвольно.</p>
<div class="formula">
  <div class="formula-symbolic">Nt = max(0, −Faxis) + |Mb|/reff</div>
  <div class="formula-symbolic">Ns = |F⊥| + |T|/reff</div>
  <div class="formula-result">${demand && check ? `узел ${demand.nodeId}, уровень ${demand.level}: Nt=${number(check.tensionN / 1000, 3)} кН; Ns=${number(check.shearN / 1000, 3)} кН` : 'внутренних болтов нет'}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Nbs = Rbs·Ab·ns·γb·γc</div>
  <div class="formula-symbolic">Nbt = Rbt·Abn·γc</div>
  <div class="formula-symbolic">Ubolt = √[(Ns/Nbs)² + (Nt/Nbt)²]</div>
  <div class="formula-result">${check ? `Nbs=${number(check.shearCapacityN / 1000, 3)} кН; Nbt=${number(check.tensionCapacityN / 1000, 3)} кН; U=${number(check.utilization, 4)}` : '—'}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Nu,characteristic = Rbun·Abn</div>
  <div class="formula-result">${check ? `${number(check.characteristicRuptureN / 1000, 3)} кН` : '—'} — reference rupture, не допустимая рабочая нагрузка</div>
</div>
<table><thead><tr><th>Класс</th><th>Минимальный размер</th><th>U</th><th>Определяющий узел</th></tr></thead><tbody>${recommendationRows}</tbody></table>

<h3>11.3. Сварной конец ребра</h3>
<p>До задания точных координат валиков используется явно обозначенная circular-group surrogate:</p>
<div class="formula">
  <div class="formula-symbolic">Qaxial = |N| + 2|M|/rw</div>
  <div class="formula-symbolic">Qshear = |V| + |T|/rw</div>
  <div class="formula-symbolic">Qw = √(Qaxial² + Qshear²)</div>
  <div class="formula-symbolic">lw,f = Qw/(βf·kf·Rwf·γc)</div>
  <div class="formula-symbolic">lw,z = Qw/(βz·kf·Rwz·γc)</div>
  <div class="formula-symbolic">lw = max(lw,f, lw,z, 4kf, 40 мм)</div>
  <div class="formula-result">${criticalWeld ? `критическое ребро ${criticalWeld.memberId}${criticalWeld.end}: effective ${number(criticalWeld.check.requiredEffectiveLengthMm, 1)} мм; physical ${number(criticalWeld.check.requiredPhysicalLengthMm, 1)} мм; ${escapeHtml(criticalWeld.check.consumableLabel)}` : '—'}</div>
</div>
</section>`
}

function moduleRows(result) {
  const governing = result.envelope.governing
  return (governing.analysis.moduleResults ?? []).map((module) => `
<tr>
<td>${module.moduleNumber}</td>
<td>${number(Math.hypot(...module.topResultantFromAbove.forceN) / 1000, 3)}</td>
<td>${number(Math.hypot(...module.topResultantFromAbove.momentNm), 2)}</td>
<td>${module.criticalMemberId}</td>
<td>${number(module.maxUtilization, 4)}</td>
<td>${number(module.maxBucklingUtilization, 4)}</td>
<td>${number(module.maxRuptureUtilization, 4)}</td>
<td>${escapeHtml(modeLabel(module.verticalFailureMode))}</td>
</tr>`).join('')
}

function createModularHeightAppendix(result) {
  const modular = result.analysis.modular
  const height = result.heightCapacity
  if (!modular || !height) throw new Error('Для paper project отсутствует module-stack или height capacity')
  const design = height.design
  const ultimate = height.ultimateResistance
  const bottom = height.bottomModuleAtFirstDesignOverload ?? height.bottomModuleAtDesignLimit
  const designText = design.bounded ? number(design.maximumHeightM, 3) : `≥ ${number(design.maximumHeightM, 3)}`
  const ultimateText = ultimate.bounded ? number(ultimate.maximumHeightM, 3) : `≥ ${number(ultimate.maximumHeightM, 3)}`
  return `
<section class="page-break">
<h2>12. Помодульный расчёт и максимальная высота</h2>
<h3>12.1. Физическая ориентация модуля</h3>
<p>Каждый одинаковый октаэдр установлен <strong>ножками вниз</strong>: собственные три горизонтальных ребра образуют его верхнюю треугольную грань, а шесть диагональных рёбер идут к трём нижним опорным точкам. Поэтому каждый модуль содержит ровно 9 рёбер, а специальное замыкание верхней грани отсутствует.</p>

<h3>12.2. Exact top-down substructuring</h3>
<p>Каждый physical module рассматривается как 36-DOF substructure: 18 DOF нижней треугольной грани и 18 DOF верхней. Верхний стек конденсируется к трём верхним узлам следующего нижнего модуля через Schur complement.</p>
<div class="formula">
  <div class="formula-symbolic">A = Ktt + Supper</div>
  <div class="formula-symbolic">S = Kbb − Kbt·A⁻¹·Ktb</div>
  <div class="formula-symbolic">p = fb − Kbt·A⁻¹·(ft + pupper)</div>
  <div class="formula-result">solver: ${escapeHtml(modular.method)}; interface factors=${modular.interfaceFactorizationCount}; modular/global difference=${Number(modular.relativeDisplacementDifference).toExponential(3)}; interface residual=${Number(modular.interfaceEquilibriumResidual).toExponential(3)}</div>
</div>
<p>Это точная линейная конденсация в пределах текущей ideal-rigid-joint frame-модели. Общая eigen-buckling задача остаётся глобальной для всей мачты.</p>

<table>
<thead><tr><th>Модуль</th><th>|F| сверху, кН</th><th>|M| сверху, Н·м</th><th>Крит. ребро</th><th>U max</th><th>U Euler ножек</th><th>U rupture ножек</th><th>Вертикальный механизм</th></tr></thead>
<tbody>${moduleRows(result)}</tbody>
</table>

<h3>12.3. Дискретный поиск максимальной высоты</h3>
<p>Высота изменяется только целым числом одинаковых модулей. Поиск использует exponential bracketing, binary refinement и проверку соседних вариантов около найденной границы.</p>
<div class="formula">
  <div class="formula-symbolic">H(N) = N·h</div>
  <div class="formula-symbolic">design: Umember≤1; Ubolt≤1; λcr≥${number(result.parameters.minimumBucklingFactor, 3)}; δtop≤${number(result.parameters.displacementLimitMm, 1)} мм</div>
  <div class="formula-result">максимум: ${design.maximumModules} модулей; Hdesign = ${designText} м${design.bounded ? '' : ' (отказ до границы поиска не найден)'}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">ultimate resistance: Umember≤1; Ubolt≤1; λcr≥1</div>
  <div class="formula-result">${ultimate.maximumModules} модулей; Hultimate = ${ultimateText} м</div>
</div>
<p>Первый не проходящий design-вариант: ${design.firstFailCase ? `${design.firstFailCase.moduleCount} модулей, H=${number(design.firstFailCase.heightM, 3)} м, механизм — ${escapeHtml(modeLabel(design.firstFailCase.designMode))}` : 'не найден в пределах поиска'}.</p>
<p>${bottom ? `Для нижнего модуля отдельно сравниваются local Euler instability и tensile rupture по Rm/γM. В контрольном состоянии раньше наступает <strong>${escapeHtml(modeLabel(bottom.mode))}</strong>, ребро #${bottom.memberId}, UEuler=${number(bottom.maxBucklingUtilization, 4)}, Urupture=${number(bottom.maxRuptureUtilization, 4)}, ветер ${number(bottom.windDirectionDeg, 0)}°.` : 'Отдельный vertical failure mode нижнего модуля не определён.'}</p>
<p class="notice"><strong>Ограничение.</strong> Найденная высота относится только к текущим выбранным нагрузкам, материалу, болту, льду, оборудованию и коэффициентам. Это не универсальная паспортная максимальная высота данного изделия.</p>
</section>`
}

function verificationCheckHtml(check) {
  return `
<article>
<h4>${statusMark(check.status)} ${escapeHtml(check.title)} — ${statusLabel(check.status)}</h4>
<p>${escapeHtml(check.explanation)}</p>
${check.formula ? `<div class="formula"><div class="formula-symbolic">${escapeHtml(check.formula)}</div>${check.substitution ? `<div>${escapeHtml(check.substitution)}</div>` : ''}${Number.isFinite(check.actual) ? `<div class="formula-result">actual ${number(check.actual, 10)}${Number.isFinite(check.expected) ? `; expected ${number(check.expected, 10)}` : ''}</div>` : ''}</div>` : ''}
${check.evidence ? `<p><strong>Контроль:</strong> ${escapeHtml(check.evidence)}</p>` : ''}
<p><strong>Как проверить самому:</strong> ${escapeHtml(check.howToCheck)}</p>
</article>`
}

function createVerificationAppendix(result) {
  const verification = result.verification
  if (!verification) throw new Error('Для paper project отсутствует verification passport')
  const levels = verification.levels.map((level) => `<tr><td>${level.number}</td><td>${escapeHtml(level.title)}</td><td>${statusMark(level.status)} ${statusLabel(level.status)}</td><td>${escapeHtml(level.description)}</td></tr>`).join('')
  const checks = verification.checks.map(verificationCheckHtml).join('')
  return `
<section class="page-break">
<h2>13. Паспорт верификации: как неспециалисту проверять расчёт</h2>
<p><strong>${escapeHtml(verification.headline)}</strong></p>
<p>${escapeHtml(verification.explanation)}</p>
<table><thead><tr><th>Уровень</th><th>Что проверяется</th><th>Статус</th><th>Смысл</th></tr></thead><tbody>${levels}</tbody></table>
<p>Итого: пройдено ${verification.counts.passed}, ошибок ${verification.counts.failed}, внешне не подтверждено ${verification.counts.notVerified}. Внутренний PASS не означает доказанную безопасность реальной изготовленной конструкции.</p>
${checks}
<h3>13.1. Внешние ступени</h3>
<p><strong>Независимый КЭ-комплекс</strong>, инженерная рецензия и physical validation должны оставаться НЕ ПРОВЕРЕНО, пока соответствующие внешние артефакты действительно не созданы.</p>
</section>`
}

export function createCalculationProjectHtml(
  result,
  parameters = result?.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo = {},
) {
  const base = createBaseCalculationNoteHtml(result, parameters, generatedAt, buildInfo)
  if (!base.includes('</body>')) throw new Error('Базовый расчётный проект имеет некорректную HTML-структуру')
  const appendices = [
    createLoadAppendix(result),
    createConnectionAppendix(result),
    createModularHeightAppendix(result),
    createVerificationAppendix(result),
  ].join('\n')
  return base.replace('</body>', `${appendices}\n</body>`)
}
