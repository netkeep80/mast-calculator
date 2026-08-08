import { calculateAssemblyMass } from '../../design/index.js'
import type { ReportingCalculationResult } from './contracts.js'
import { buildReferenceData } from './reference-data.js'

type ReferenceData = ReturnType<typeof buildReferenceData>

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const number = (value: unknown, digits = 3): string => {
  const numeric = Number(value)
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(numeric)
    : '—'
}

function reinforcementRows(data: ReferenceData): string {
  return data.reinforcement.classes.map((item) => `
<tr><td>${escapeHtml(item.label)}</td><td>${number(item.yieldStrengthMPa, 0)}</td><td>${number(item.tensileStrengthMPa, 0)}</td><td>${number(item.youngModulusGPa, 0)}</td><td>${number(item.poissonRatio, 2)}</td><td>${number(item.densityKgM3, 0)}</td><td>${escapeHtml(item.standard)}</td></tr>`).join('')
}

function boltClassRows(data: ReferenceData): string {
  return data.fasteners.classes.map((item) => `
<tr><td>${escapeHtml(item.label)}</td><td>${number(item.rbunMPa, 0)}</td><td>${number(item.rbsMPa, 0)}</td><td>${item.rbtMPa == null ? '—' : number(item.rbtMPa, 0)}</td><td>${escapeHtml(item.standard)}</td></tr>`).join('')
}

function weldRows(data: ReferenceData): string {
  return data.welding.consumables.map((item) => `
<tr><td>${escapeHtml(item.label)}</td><td>${item.process === 'wire' ? 'проволока' : 'электрод'}</td><td>${number(item.rwunMPa, 0)}</td><td>${number(item.rwfMPa, 0)}</td><td>${escapeHtml(item.standard)}</td></tr>`).join('')
}

function jointStrengthAppendix(result: ReportingCalculationResult, data: ReferenceData): string {
  const connections = result.connections
  const sections = connections?.nutSections
  const selected = connections?.bolt?.selected
  const demand = selected?.governingDemand
  const check = selected?.governingCheck
  const weld = connections?.weld?.critical?.check
  if (!sections) return '<p>Усиленная проверка соединительного узла неприменима.</p>'
  return `
<h3>14.6. Усиленная проверка соединительного узла</h3>
<p>Дополнительные критерии issue #33 не заменяют силовые проверки СП 16. Они контролируют геометрический запас материала гайки, эффективную площадь шва и расход растягивающего резерва болта при затяжке.</p>
<div class="formula">
  <div class="formula-symbolic">Ahex = √3/2·s²; Anut = Ahex − πD1²/4; Arib = πd²/4</div>
  <div class="formula-result">длинная гайка: Anut/Arib=${number(sections.couplingNut.ratioToSingleRib, 3)}; проходная: ${number(sections.clearanceNut.ratioToSingleRib, 3)}; требуется ≥${number(sections.requiredRatio, 2)}×</div>
</div>
<div class="formula">
  <div class="formula-symbolic">F0,nom = T/(K·d); F0,max=(1+Γ)·F0,nom</div>
  <div class="formula-result">${check?.preload ? `T=${number(check.preload.tighteningTorqueNm, 1)} Н·м; K=${number(check.preload.nutFactor, 3)}; Γ=${number(check.preload.preloadVariation, 3)}; F0,max=${number(check.preload.maximumPreloadN / 1000, 3)} кН` : 'для текущей модели внутренний болт не нагружен'}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Nt,strength = F0,max + Nt,external</div>
  <div class="formula-symbolic">Ubolt = √[(Ns/Nbs)² + (Nt,strength/Nbt)²]</div>
  <div class="formula-result">${check ? `Nt,external=${number(check.serviceExternalTensionN / 1000, 3)} кН; Nt,strength=${number(check.strengthTensionN / 1000, 3)} кН; Upreload=${number(check.preloadUtilization, 4)}; Ubolt=${number(check.utilization, 4)}` : '—'}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">F⊥ = F − e(e·F); Ns,direct=|F⊥|</div>
  <div class="formula-result">${demand ? `прямой срез от наклонной силы=${number(demand.shearFromInclinedForceN / 1000, 3)} кН; угол результирующей к оси болта=${number(demand.acuteAngleToBoltAxisDeg, 2)}°` : '—'}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Aeff,weld = βf·kf·lweff ≥ kweld·Arib</div>
  <div class="formula-result">${weld?.minimumAreaRatio != null ? `kweld=${number(weld.minimumAreaRatio, 2)}; Aeff/Arib=${number(weld.requiredAreaRatio, 3)}; требование по площади даёт lweff≥${number(weld.requiredByAreaRatioMm, 1)} мм` : '—'}</div>
</div>
<p class="equation-note">Torque-preload relation: ${escapeHtml(data.jointDesign.boltPreload.source)}. Коэффициент площади шва 2–3× и минимум 2× для нетто-сечения гайки являются дополнительными консервативными критериями этого проекта, а не цитатой нормы.</p>`
}

function craneBoomAppendix(result: ReportingCalculationResult): string {
  const boom = result.craneBoomCapacity
  const pure = result.lateralCapacity
  if (!boom) return '<p>Расчёт горизонтальной стрелы в данном результате отсутствует.</p>'
  return `
<h3>14.7. Горизонтальная стрела: собственный вес и концевой груз</h3>
<p>Issue #36 добавляет отдельную задачу, отличную от чистого unit-load теста. Та же пространственная frame-модель мысленно поворачивается горизонтально: гравитация арматурных рёбер становится поперечной распределённой нагрузкой, а груз прикладывается к трём узлам конца стрелы.</p>
<div class="formula">
  <div class="formula-symbolic">qg = ρ·A·g·γg</div>
  <div class="formula-result">собственный вес арматурной стрелы = ${number(boom.boomSelfWeightN / 1000, 3)} кН ≈ ${number(boom.boomSelfMassEquivalentKg, 2)} кг массы при g₀</div>
</div>
<div class="formula">
  <div class="formula-symbolic">Pend(m) = m·g·γpayload</div>
  <div class="formula-symbolic">Utotal = max(Umember, Ubolt, 1/λcr) ≤ 1</div>
  <div class="formula-result">максимальный концевой груз = ${number(boom.maximumEndPayloadMassKg, 2)} кг; направление ${number(boom.governingDirectionDeg, 0)}°; механизм ${escapeHtml(boom.governingMode)}</div>
</div>
<div class="formula">
  <div class="formula-symbolic">reference upper bound: Flateral/g₀</div>
  <div class="formula-result">чистый unit-load без собственного веса = ${number(pure?.idealizedCraneBoomPayloadKg ?? pure?.criticalForceKgf, 2)} кг; расчёт стрелы с собственным весом = ${number(boom.maximumEndPayloadMassKg, 2)} кг</div>
</div>
<p class="notice"><strong>Граница модели.</strong> В горизонтальной стреле учтён поперечный собственный вес арматурных members, но пока не добавлена отдельная fabrication mass метизов/сварки, не моделируются динамика подъёма, рывок, трос, барабан, шарнир/поворотный узел, ветер/лёд и специальные нормативные коэффициенты грузоподъёмного механизма. Результат не является паспортной SWL крана.</p>`
}

export function createFabricationAndReferenceAppendix(result: ReportingCalculationResult): string {
  let mass = result.assemblyMass
  if (!mass) {
    const connections = result.connections
    if (!connections) throw new Error('Для расчёта массы физической сборки отсутствуют соединения')
    mass = calculateAssemblyMass({ ...result, connections })
  }
  const data = buildReferenceData()
  return `
<section class="page-break">
<h2>14. Масса физической сборки и аудит справочных данных</h2>
<h3>14.1. Масса одного ребра</h3>
<div class="formula">
  <div class="formula-symbolic">mrib = ρ·πd²/4·a</div>
  <div>ρ=${number(mass.densityKgM3, 0)} кг/м³; d=${number(mass.rib.diameterMm, 1)} мм; a=${number(mass.rib.lengthMm, 2)} мм</div>
  <div class="formula-result">mrib=${number(mass.rib.massKg, 4)} кг; ${number(mass.rib.massPerMeterKg, 4)} кг/м</div>
</div>

<h3>14.2. Геометрическая оценка массы метизов</h3>
<p>Для производственной оценки болт представлен цилиндрическим стержнем номинального диаметра и шестигранной головкой, а гайка — шестигранной призмой за вычетом цилиндрического отверстия по базовому внутреннему диаметру резьбы. Это не паспортная масса конкретного покупного изделия.</p>
<table><thead><tr><th>Деталь</th><th>Геометрия</th><th>Масса, кг</th></tr></thead><tbody>
<tr><td>Болт</td><td>M${mass.hardware.bolt.diameterMm}×${number(mass.hardware.bolt.lengthMm, 0)}; s=${number(mass.hardware.bolt.headAcrossFlatsMm, 1)}; k=${number(mass.hardware.bolt.headHeightMm, 1)}</td><td>${number(mass.hardware.bolt.massKg, 4)}</td></tr>
<tr><td>Проходная гайка</td><td>M${mass.hardware.clearanceNut.threadDiameterMm}; s=${number(mass.hardware.clearanceNut.acrossFlatsMm, 1)}; h=${number(mass.hardware.clearanceNut.heightMm, 1)}</td><td>${number(mass.hardware.clearanceNut.massKg, 4)}</td></tr>
<tr><td>Длинная гайка</td><td>M${mass.hardware.couplingNut.threadDiameterMm}; s=${number(mass.hardware.couplingNut.acrossFlatsMm, 1)}; L=${number(mass.hardware.couplingNut.lengthMm, 1)}</td><td>${number(mass.hardware.couplingNut.massKg, 4)}</td></tr>
</tbody></table>

<h3>14.3. Масса сварки</h3>
<div class="formula">
  <div class="formula-symbolic">Aweld ≈ k²/2; mweld = ρ·Aweld·Lphysical</div>
  <div>k=${number(mass.weld.legMm, 1)} мм; для унифицированного изделия Lphysical=${number(mass.weld.designPhysicalLengthPerEndMm, 1)} мм на каждый конец</div>
  <div class="formula-result">mweld,end=${number(mass.weld.massPerEndKg, 5)} кг</div>
</div>
<p>${escapeHtml(mass.weld.uniformDesignRule)}</p>

<h3>14.4. Законченные физические сборки</h3>
<table><thead><tr><th>Сборка</th><th>Состав</th><th>Масса, кг</th></tr></thead><tbody>
<tr><td>Полный межмодульный узел</td><td>${escapeHtml(mass.intermoduleJoint.composition)}</td><td>${number(mass.intermoduleJoint.totalMassKg, 4)}</td></tr>
<tr><td>Сваренный и закреплённый модуль</td><td>${escapeHtml(mass.module.composition)}</td><td>${number(mass.module.totalMassKg, 3)}</td></tr>
<tr><td>Оценка всей изготовленной мачты</td><td>${mass.mastFabricationEstimate.moduleCount} одинаковых модулей</td><td>${number(mass.mastFabricationEstimate.uniformModulesMassKg, 2)}</td></tr>
</tbody></table>
<p class="notice"><strong>Граница модели.</strong> ${escapeHtml(mass.reasonNotInFem)}</p>

<h3>14.5. Проверяемые справочные величины</h3>
<p>Схема справочника: <code>${escapeHtml(data.schema)}</code>. Таблицы ниже построены из тех же каталогов, которые использует расчёт; генератор документа не содержит отдельной копии этих прочностных значений.</p>
<h4>Арматура</h4>
<table><thead><tr><th>Класс</th><th>Ry</th><th>Rm</th><th>E, ГПа</th><th>ν</th><th>ρ</th><th>Источник</th></tr></thead><tbody>${reinforcementRows(data)}</tbody></table>
<h4>Классы болтов</h4>
<table><thead><tr><th>Класс</th><th>Rbun</th><th>Rbs</th><th>Rbt</th><th>Источник</th></tr></thead><tbody>${boltClassRows(data)}</tbody></table>
<h4>Электроды и проволока</h4>
<table><thead><tr><th>Материал</th><th>Тип</th><th>Rwun</th><th>Rwf</th><th>Источник</th></tr></thead><tbody>${weldRows(data)}</tbody></table>
<p>Полный справочник диаметров, Ab/Abn, обычных и длинных гаек доступен в браузерном интерфейсе и формируется тем же <code>buildReferenceData()</code>.</p>
${jointStrengthAppendix(result, data)}
${craneBoomAppendix(result)}
</section>`
}
