import type { ResolvedProject } from '../../domain/contracts.js'
import { WIND_ACTION_MODE_SP20_MEAN_V1 } from '../../domain/index.js'
import { createCalculationProjectHtml as createBaseCalculationProjectHtml } from './calculation-project.js'
import type { ReportingBuildInfo, ReportingCalculationResult } from './contracts.js'

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const number = (value: unknown, digits = 3): string => (
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)
    : '—'
)

function windActionSection(parameters: ResolvedProject): string {
  const provenance = parameters.windActionProvenance
  if (provenance.model === WIND_ACTION_MODE_SP20_MEAN_V1) {
    return `<h3>10.1. Нормативная модель средней ветровой нагрузки</h3>
<p><strong>Модель:</strong> ${escapeHtml(provenance.model)}. <strong>Источник:</strong> ${escapeHtml(provenance.source)}.</p>
<table>
<thead><tr><th>Параметр</th><th>Resolved value</th><th>Роль</th></tr></thead>
<tbody>
<tr><td>Ветровой район</td><td>${escapeHtml(provenance.windRegion)}</td><td>определяет характеристическое w₀</td></tr>
<tr><td>w₀</td><td>${number(provenance.basicWindPressurePa, 1)} Па</td><td>базовое характеристическое давление</td></tr>
<tr><td>Тип местности</td><td>${escapeHtml(provenance.terrainType)}</td><td>определяет k(ze)</td></tr>
<tr><td>Опорная высота</td><td>${number(provenance.referenceHeightM, 3)} м</td><td>верх мачты; для стержней давление вычисляется по их средней отметке</td></tr>
<tr><td>k(ze) на опорной высоте</td><td>${number(provenance.referenceHeightCoefficient, 5)}</td><td>табл. 11.2 / формула 11.4 в зависимости от высоты</td></tr>
<tr><td>Характеристическое среднее давление на опорной высоте</td><td>${number(provenance.referenceCharacteristicMeanPressurePa, 3)} Па</td><td>w₀·k(ze), до γf и аэродинамического коэффициента</td></tr>
<tr><td>γf ветровой нагрузки</td><td>${number(provenance.loadReliabilityFactor, 3)}</td><td>коэффициент надёжности; не является коэффициентом динамичности</td></tr>
<tr><td>Аэродинамический коэффициент рёбер</td><td>${number(provenance.memberAerodynamicCoefficient, 3)}</td><td>${escapeHtml(provenance.aerodynamicCoefficientSource)}</td></tr>
<tr><td>Аэродинамический коэффициент оборудования</td><td>${number(provenance.equipmentAerodynamicCoefficient, 3)}</td><td>${escapeHtml(provenance.aerodynamicCoefficientSource)}</td></tr>
</tbody>
</table>
<p class="notice"><strong>Граница нормативности:</strong> w₀, k(ze) и γf имеют указанную нормативную provenance; аэродинамические коэффициенты сейчас приходят из ProjectInput и не заявляются как автоматически выбранные по приложению СП 20.</p>
<p class="notice"><strong>Граница модели:</strong> средняя составляющая учтена; пульсационная составляющая — ${provenance.pulsationComponentIncluded ? 'учтена' : 'НЕ УЧТЕНА'}; динамический/модальный отклик — ${provenance.dynamicResponseIncluded ? 'учтён' : 'НЕ УЧТЁН'}. Поэтому этот расчёт нельзя описывать как полный нормативный ветровой расчёт до завершения отдельной dynamic-модели.</p>`
  }

  return `<h3>10.1. Заданная пользователем ветровая нагрузка</h3>
<p><strong>Модель:</strong> ${escapeHtml(provenance.model)} — ненормативный manual/scenario input. Выбран сценарий: <strong>${escapeHtml(parameters.windPresetLabel)}</strong>.</p>
<div class="formula">
  <div class="formula-symbolic">q = ρv²/2</div>
  <div>q = 0,5·1,225·${number(parameters.windSpeedMs, 3)}² = ${number(parameters.windPressurePa, 3)} Па</div>
  <div class="formula-result">γf = ${number(provenance.loadReliabilityFactor, 3)}</div>
</div>
<p class="equation-note">Шкала Бофорта и пользовательское давление являются сравнительными сценариями, а не нормативным ветровым районированием. Аэродинамические коэффициенты берутся из ProjectInput. Пульсационная составляющая и динамический отклик в этом режиме не заявляются.</p>`
}

export function createCalculationProjectHtml(
  result: ReportingCalculationResult,
  parameters: ResolvedProject = result.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo: ReportingBuildInfo = {},
): string {
  const html = createBaseCalculationProjectHtml(result, parameters, generatedAt, buildInfo)
  const start = '<h3>10.1. Погодный сценарий</h3>'
  const end = '<h3>10.2. Поперечный предел вершины / идеализированная консольная стрела</h3>'
  const startIndex = html.indexOf(start)
  const endIndex = html.indexOf(end, startIndex)
  if (startIndex < 0 || endIndex < 0) throw new Error('Не найдена секция ветровой нагрузки в расчётном проекте')
  return `${html.slice(0, startIndex)}${windActionSection(parameters)}\n\n${html.slice(endIndex)}`
}
