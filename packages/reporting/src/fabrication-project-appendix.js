import { calculateAssemblyMass } from '../../design/index.js'
import { buildReferenceData } from './reference-data.js'

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const number = (value, digits = 3) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
  : '—'

function reinforcementRows(data) {
  return data.reinforcement.classes.map((item) => `
<tr><td>${escapeHtml(item.label)}</td><td>${number(item.yieldStrengthMPa, 0)}</td><td>${number(item.tensileStrengthMPa, 0)}</td><td>${number(item.youngModulusGPa, 0)}</td><td>${number(item.poissonRatio, 2)}</td><td>${number(item.densityKgM3, 0)}</td><td>${escapeHtml(item.standard)}</td></tr>`).join('')
}

function boltClassRows(data) {
  return data.fasteners.classes.map((item) => `
<tr><td>${escapeHtml(item.label)}</td><td>${number(item.rbunMPa, 0)}</td><td>${number(item.rbsMPa, 0)}</td><td>${item.rbtMPa == null ? '—' : number(item.rbtMPa, 0)}</td><td>${escapeHtml(item.standard)}</td></tr>`).join('')
}

function weldRows(data) {
  return data.welding.consumables.map((item) => `
<tr><td>${escapeHtml(item.label)}</td><td>${item.process === 'wire' ? 'проволока' : 'электрод'}</td><td>${number(item.rwunMPa, 0)}</td><td>${number(item.rwfMPa, 0)}</td><td>${escapeHtml(item.standard)}</td></tr>`).join('')
}

function jointStrengthAppendix(result, data) {
  const connections = result.connections
  const sections = connections?.nutSections
  const clearance = sections?.clearanceNut
  const coupling = sections?.couplingNut
  const selected = connections?.bolt?.selected
  const demand = selected?.governingDemand
  const check = selected?.governingCheck
  const weld = connections?.weld
  const degradation = weld?.serviceDegradation
  const preload = selected?.governingCheck?.preload
  const joint = data.jointDesign
  return `
<h3>8.4. Усиленные критерии межмодульного узла</h3>
<p>Для issue #33 поверх прочности болта и шва выполняются дополнительные проверки нетто-сечения гаек, эффективной площади сварки и влияния преднатяга. Эти коэффициенты являются проектными запасами и не подменяют нормативные проверки резьбы, смятия, усталости и коррозии.</p>
<table>
<thead><tr><th>Проверка</th><th>Фактическое значение</th><th>Критерий / источник</th></tr></thead>
<tbody>
<tr><td>Нетто-сечение проходной гайки</td><td>${clearance ? `${number(clearance.netAreaMm2, 1)} мм²; k=${number(clearance.ratioToSingleRib, 3)}` : '—'}</td><td>Anut,net / Arib ≥ ${number(joint.nutNetSection.minimumAreaRatioToSingleRib, 2)}; дополнительный критерий проекта</td></tr>
<tr><td>Нетто-сечение длинной гайки</td><td>${coupling ? `${number(coupling.netAreaMm2, 1)} мм²; k=${number(coupling.ratioToSingleRib, 3)}` : '—'}</td><td>тот же критерий относительно одного ребра максимального диаметра</td></tr>
<tr><td>Эффективная площадь шва</td><td>${weld?.critical ? `${number(weld.critical.check.effectiveThroatAreaMm2, 1)} мм²; k=${number(weld.critical.check.requiredAreaRatio, 3)}` : '—'}</td><td>Aweld,service / Arib ≥ ${number(joint.weldEffectiveArea.minimumAreaRatioToRib, 2)}; выбранный проектный запас ${number(weld?.minimumAreaRatio ?? joint.weldEffectiveArea.defaultAreaRatioToRib, 2)}</td></tr>
<tr><td>Service retention шва</td><td>${degradation ? `${number(degradation.stiffnessRetentionFactor, 4)} после ${number(degradation.serviceYears, 1)} лет` : '—'}</td><td>${escapeHtml(joint.weldServiceDegradation.model)}; параметрический reserve model</td></tr>
<tr><td>Преднатяг болта</td><td>${preload ? `${number(preload.nominalPreloadN / 1000, 3)} кН; worst=${number(preload.maximumPreloadN / 1000, 3)} кН` : '—'}</td><td>${escapeHtml(joint.boltPreload.relation)}; K=${number(preload?.nutFactor ?? joint.boltPreload.defaultNutFactor, 3)}</td></tr>
<tr><td>Определяющее внешнее усилие болта</td><td>${demand && check ? `Nt=${number(check.tensionN / 1000, 3)} кН; Ns=${number(check.shearN / 1000, 3)} кН; U=${number(check.utilization, 4)}` : '—'}</td><td>преднатяг учитывается отдельно от внешнего спроса; в auto ограничивается долей расчётной растягивающей способности</td></tr>
</tbody>
</table>`
}

export function createFabricationAndReferenceAppendix(result, parameters = result?.parameters) {
  if (!result?.model?.members?.length) throw new Error('Для производственного приложения требуется расчётная модель')
  const data = buildReferenceData()
  const mass = result.assemblyMass ?? calculateAssemblyMass(result)
  return `
<section class="page-break">
<h2>8. Производственная справка и исходные каталоги</h2>
<p>Раздел собирается из тех же программных каталогов, которые использует расчёт. Он не является сертификатом конкретной партии материала и не заменяет проверку фактически приобретённых изделий.</p>
<h3>8.1. Арматура</h3>
<table><thead><tr><th>Класс</th><th>Ry, МПа</th><th>Rm, МПа</th><th>E, ГПа</th><th>ν</th><th>ρ, кг/м³</th><th>Стандарт</th></tr></thead><tbody>${reinforcementRows(data)}</tbody></table>
<h3>8.2. Болты и сварочные материалы</h3>
<table><thead><tr><th>Класс</th><th>Rbun, МПа</th><th>Rbs, МПа</th><th>Rbt, МПа</th><th>Стандарт</th></tr></thead><tbody>${boltClassRows(data)}</tbody></table>
<table><thead><tr><th>Материал</th><th>Процесс</th><th>Rwun, МПа</th><th>Rwf, МПа</th><th>Стандарт</th></tr></thead><tbody>${weldRows(data)}</tbody></table>
<h3>8.3. Масса физической сборки</h3>
<p>Оценка учитывает фактический профиль диаметров модулей, 9 рёбер на модуль, физические болты/гайки межмодульных соединений и наплавленный металл угловых швов. Для первого модуля нижние три комплекта метизов не добавляются: они не являются межмодульным соединением.</p>
<table><tbody>
<tr><th>Масса арматуры мачты</th><td>${number(mass.mastFabricationEstimate.reinforcementMassKg, 2)} кг</td></tr>
<tr><th>Масса межмодульных метизов</th><td>${number(mass.mastFabricationEstimate.jointHardwareMassKg, 2)} кг</td></tr>
<tr><th>Масса сварного металла</th><td>${number(mass.mastFabricationEstimate.weldMassKg, 2)} кг</td></tr>
<tr><th>Всего физическая мачта</th><td>${number(mass.mastFabricationEstimate.totalMassKg, 2)} кг</td></tr>
</tbody></table>
${jointStrengthAppendix(result, data)}
<p class="equation-note">Выбранный материал: ${escapeHtml(parameters.reinforcementClass)}; расчётная геометрия ребра ${number(parameters.ribCutLengthMm, 1)} мм. Для закупки и изготовления используйте отдельную КД и фактические сертификаты материалов.</p>
</section>`
}
