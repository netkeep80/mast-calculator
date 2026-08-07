import { buildMaterialSummary, buildMemberEnvelope } from './report.js'

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

const scientific = (value, digits = 4) => Number.isFinite(value)
  ? value.toExponential(digits).replace('.', ',')
  : '∞'

const tableRows = (rows) => rows.map((cells) => (
  `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
)).join('')

const formula = (symbolic, substitution, resultText) => `
  <div class="formula">
    <div class="formula-symbolic">${escapeHtml(symbolic)}</div>
    <div>${escapeHtml(substitution)}</div>
    <div class="formula-result">= ${escapeHtml(resultText)}</div>
  </div>`

export function createCalculationNoteHtml(
  result,
  parameters = result?.parameters,
  generatedAt = new Date().toISOString(),
  buildInfo = {},
) {
  if (!result?.model?.members?.length || !result?.cases?.length) {
    throw new Error('Невозможно сформировать расчётный проект без выполненного расчёта')
  }

  const p = result.parameters ?? parameters
  const material = buildMaterialSummary(result)
  const members = buildMemberEnvelope(result)
    .sort((left, right) => right.utilization - left.utilization)
  const strengthCase = result.envelope.strength
  const critical = strengthCase.analysis.memberResults[strengthCase.analysis.criticalMemberId]
  const criticalMember = result.model.members[critical.memberId]

  const edgeM = p.ribCutLengthMm / 1000
  const radiusM = edgeM / Math.sqrt(3)
  const moduleHeightM = p.moduleHeightMm / 1000
  const mastHeightM = p.moduleCount * moduleHeightM
  const diameterM = p.barDiameterMm / 1000
  const areaM2 = Math.PI * diameterM ** 2 / 4
  const inertiaM4 = Math.PI * diameterM ** 4 / 64
  const torsionConstantM4 = Math.PI * diameterM ** 4 / 32
  const sectionModulusM3 = inertiaM4 / (diameterM / 2)
  const youngPa = p.youngModulusGPa * 1e9
  const shearPa = youngPa / (2 * (1 + p.poissonRatio))
  const designYieldPa = p.yieldStrengthMPa * 1e6 / p.materialSafetyFactor
  const criticalLengthM = critical.lengthM
  const effectiveLengthM = p.effectiveLengthFactor * criticalLengthM

  const materialRows = material.groups.map((group) => [
    group.familyName,
    `Ø${number(group.diameterMm, 1)}`,
    `${number(group.lengthMm, 2)} мм`,
    group.count,
    `${number(group.totalLengthM, 3)} м`,
    `${number(group.totalMassKg, 3)} кг`,
  ])

  const loadRows = result.cases.map((loadCase) => [
    `${number(loadCase.windDirectionDeg, 0)}°`,
    `${number(loadCase.loads.selfWeightN / 1000, 3)} кН`,
    `${number(loadCase.loads.iceWeightN / 1000, 3)} кН`,
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
    `${number(member.axialForceN / 1000, 4)} кН`,
    `${number(member.maxShearN / 1000, 4)} кН`,
    `${number(member.maxTorsionNm, 3)} Н·м`,
    `${number(member.maxBendingNm, 3)} Н·м`,
    `${number(member.equivalentStressPa / 1e6, 3)} МПа`,
    `${number(member.windDirectionDeg, 0)}°`,
    number(member.utilization, 4),
  ])

  const warningItems = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
  const sha = buildInfo.sha ?? 'не указан'
  const repository = buildInfo.repository ?? 'netkeep80/mast-calculator'
  const ref = buildInfo.ref ?? 'не указан'
  const method = result.method ?? {}

  const criticalAxialStressPa = critical.axialStressPa
  const criticalBendingStressPa = critical.bendingStressPa
  const criticalNormalStressPa = critical.normalStressPa
  const criticalShearPa = critical.shearStressPa
  const criticalEquivalentPa = critical.equivalentStressPa
  const criticalStressUtilization = critical.stressUtilization
  const criticalEulerN = critical.eulerCapacityN
  const criticalCompressionN = Math.max(0, -(critical.maxCompressionN ?? 0))
  const criticalBucklingUtilization = critical.bucklingUtilization

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Расчётный проект Mast Calculator</title>
<style>
  :root { font-family: "Times New Roman", Georgia, serif; color: #111; }
  * { box-sizing: border-box; }
  body { max-width: 1180px; margin: 0 auto; padding: 28px 34px; line-height: 1.4; background: white; }
  h1 { margin: 0 0 4px; font-size: 26px; text-align: center; }
  .subtitle { text-align: center; margin: 0 0 24px; }
  h2 { margin: 28px 0 12px; font-size: 19px; border-bottom: 1px solid #777; padding-bottom: 4px; }
  h3 { margin: 20px 0 8px; font-size: 16px; }
  .meta, .notice { padding: 10px 12px; border: 1px solid #aaa; margin: 12px 0; }
  .notice { border-left: 4px solid #8a6415; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 22px; }
  .grid div { padding: 4px 0; border-bottom: 1px dotted #bbb; }
  .formula { margin: 8px 0; padding: 7px 10px; border-left: 3px solid #777; font-family: "Cambria Math", "Times New Roman", serif; background: #fafafa; }
  .formula-symbolic { font-style: italic; }
  .formula-result { font-weight: 700; }
  .equation-note { color: #333; font-size: 0.94em; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 10px 0 16px; }
  th, td { border: 1px solid #888; padding: 4px 6px; text-align: right; }
  th { background: #eee; }
  th:nth-child(2), td:nth-child(2) { text-align: left; }
  .bad { color: #a00000; font-weight: bold; }
  .pass { font-weight: bold; }
  .page-break { break-before: page; }
  @media print {
    @page { size: A4; margin: 14mm 12mm 16mm; }
    body { max-width: none; padding: 0; font-size: 10.5pt; }
    h1 { font-size: 18pt; }
    h2 { font-size: 14pt; break-after: avoid; }
    h3 { break-after: avoid; }
    tr, .formula, .meta, .notice { break-inside: avoid; }
    table { font-size: 8pt; }
  }
</style>
</head>
<body>
<h1>Расчётный проект арматурного каркаса модульной мачты</h1>
<p class="subtitle">Mast Calculator — автоматизированный расчёт по пространственной frame-модели</p>

<div class="meta">
  <strong>Дата формирования:</strong> ${escapeHtml(generatedAt)}<br>
  <strong>Метод:</strong> ${escapeHtml(method.id ?? 'не указан')} — ${escapeHtml(method.description ?? '')}<br>
  <strong>Версия расчётного кода:</strong> Git commit ${escapeHtml(sha)}<br>
  <strong>Источник:</strong> ${escapeHtml(repository)} / ${escapeHtml(ref)}
</div>

<p class="notice"><strong>Назначение документа.</strong> Документ предназначен для передачи инженеру-конструктору для независимой проверки расчётной схемы, формул, исходных данных и полученных результатов. Он формируется из того же объекта результата, который отображает приложение; повторный КЭ-расчёт при создании документа не выполняется. Документ не является экспертным заключением и сам по себе не подтверждает нормативное соответствие конструкции.</p>

<h2>1. Исходные данные</h2>
<div class="grid">
  <div><strong>Количество модулей:</strong> ${escapeHtml(p.moduleCount)}</div>
  <div><strong>Закупочная длина прутка:</strong> ${number(p.stockBarLengthMm, 0)} мм</div>
  <div><strong>Разделение прутка:</strong> ${escapeHtml(p.stockBarPieces)} равных частей</div>
  <div><strong>Диаметр:</strong> ${number(p.barDiameterMm, 1)} мм</div>
  <div><strong>Класс арматуры:</strong> ${escapeHtml(p.reinforcementClass)}</div>
  <div><strong>Стандарт:</strong> ${escapeHtml(p.reinforcementStandard)}</div>
  <div><strong>R<sub>y</sub>:</strong> ${number(p.yieldStrengthMPa, 0)} МПа</div>
  <div><strong>R<sub>m</sub>:</strong> ${number(p.tensileStrengthMPa, 0)} МПа</div>
  <div><strong>E:</strong> ${number(p.youngModulusGPa, 0)} ГПа</div>
  <div><strong>ν:</strong> ${number(p.poissonRatio, 3)}</div>
  <div><strong>ρ:</strong> ${number(p.densityKgM3, 0)} кг/м³</div>
  <div><strong>γ<sub>M</sub>:</strong> ${number(p.materialSafetyFactor, 3)}</div>
  <div><strong>Ветровое давление p:</strong> ${number(p.windPressurePa, 1)} Па</div>
  <div><strong>c<sub>d</sub> стержня:</strong> ${number(p.dragCoefficient, 3)}</div>
  <div><strong>Толщина льда:</strong> ${number(p.iceThicknessMm, 1)} мм</div>
  <div><strong>Масса оборудования:</strong> ${number(p.equipmentMassKg, 2)} кг</div>
  <div><strong>Парусная площадь оборудования:</strong> ${number(p.equipmentWindAreaM2, 3)} м²</div>
  <div><strong>Шаг ветровой огибающей:</strong> ${number(p.windEnvelopeStepDeg, 0)}°</div>
</div>

<h2>2. Геометрия правильного октаэдра</h2>
<p>До учёта реального соединительного узла каждый модуль принимается правильным октаэдром: девять его рёбер имеют одинаковую расчётную длину <em>a</em>. Верхняя треугольная грань повёрнута относительно нижней на 60°.</p>
${formula(
    'a = L₀ / n',
    `a = ${number(p.stockBarLengthMm, 0)} / ${number(p.stockBarPieces, 0)} мм`,
    `${number(p.ribCutLengthMm, 3)} мм`,
  )}
${formula(
    'R = a / √3',
    `R = ${number(edgeM * 1000, 3)} / √3 мм`,
    `${number(radiusM * 1000, 3)} мм`,
  )}
${formula(
    'h = √(a² − R²) = a·√(2/3)',
    `h = ${number(edgeM * 1000, 3)}·√(2/3) мм`,
    `${number(moduleHeightM * 1000, 3)} мм`,
  )}
${formula(
    'H = nₘ·h',
    `H = ${number(p.moduleCount, 0)}·${number(moduleHeightM, 6)} м`,
    `${number(mastHeightM, 4)} м`,
  )}
<p class="equation-note">Высота соединительной гайки/болта и фактический нахлёст арматуры на узел в этой версии не добавляются к <em>h</em>.</p>

<h2>3. Геометрические характеристики арматуры</h2>
${formula(
    'A = πd²/4',
    `A = π·(${number(diameterM, 6)})²/4 м²`,
    `${scientific(areaM2)} м²`,
  )}
${formula(
    'Iᵧ = I𝓏 = πd⁴/64',
    `I = π·(${number(diameterM, 6)})⁴/64 м⁴`,
    `${scientific(inertiaM4)} м⁴`,
  )}
${formula(
    'J = πd⁴/32',
    `J = π·(${number(diameterM, 6)})⁴/32 м⁴`,
    `${scientific(torsionConstantM4)} м⁴`,
  )}
${formula(
    'W = I/(d/2)',
    `W = ${scientific(inertiaM4)}/(${number(diameterM, 6)}/2) м³`,
    `${scientific(sectionModulusM3)} м³`,
  )}
${formula(
    'G = E/[2(1+ν)]',
    `G = ${number(p.youngModulusGPa, 3)}/[2·(1+${number(p.poissonRatio, 3)})] ГПа`,
    `${number(shearPa / 1e9, 3)} ГПа`,
  )}
${formula(
    'Ryd = Ry/γM',
    `Ryd = ${number(p.yieldStrengthMPa, 0)}/${number(p.materialSafetyFactor, 3)} МПа`,
    `${number(designYieldPa / 1e6, 3)} МПа`,
  )}

<h2>4. Нагрузки</h2>
<h3>4.1. Собственный вес ребра</h3>
${formula(
    'qg = ρ·A·g·γg',
    `qg = ${number(p.densityKgM3, 0)}·${scientific(areaM2)}·9,80665·${number(p.deadLoadFactor, 3)} Н/м`,
    `${number(p.densityKgM3 * areaM2 * 9.80665 * p.deadLoadFactor, 5)} Н/м`,
  )}
<h3>4.2. Обледенение</h3>
${formula(
    'Aice = π[(d+2t)²−d²]/4',
    `Aice = π[( ${number((diameterM + 2 * p.iceThicknessMm / 1000) * 1000, 3)} )²−${number(diameterM * 1000, 3)}²]/4 мм²`,
    `${number(Math.PI * Math.max(0, (diameterM + 2 * p.iceThicknessMm / 1000) ** 2 - diameterM ** 2) / 4 * 1e6, 3)} мм²`,
  )}
<p>Линейный вес льда далее вычисляется как <em>q<sub>ice</sub> = ρ<sub>ice</sub>·A<sub>ice</sub>·g·γ<sub>g</sub></em>.</p>
<h3>4.3. Ветер на пространственно ориентированное ребро</h3>
<div class="formula">
  <div class="formula-symbolic">q⃗w = p·cd·dout·γw·[e⃗w − e⃗x(e⃗x·e⃗w)]</div>
  <div>где e⃗x — единичный вектор оси ребра, e⃗w — направление ветра, dout = d + 2t.</div>
  <div>Таким образом учитывается только составляющая ветра, перпендикулярная оси цилиндрического ребра.</div>
</div>
<h3>4.4. Оборудование</h3>
${formula(
    'Fw,equip = p·cd,equip·Aequip·γw',
    `F = ${number(p.windPressurePa, 1)}·${number(p.equipmentDragCoefficient, 3)}·${number(p.equipmentWindAreaM2, 3)}·${number(p.windLoadFactor, 3)} Н`,
    `${number(p.windPressurePa * p.equipmentDragCoefficient * p.equipmentWindAreaM2 * p.windLoadFactor, 3)} Н`,
  )}
${formula(
    'G equip = m·g·γequip',
    `G = ${number(p.equipmentMassKg, 3)}·9,80665·${number(p.equipmentLoadFactor, 3)} Н`,
    `${number(p.equipmentMassKg * 9.80665 * p.equipmentLoadFactor, 3)} Н`,
  )}

<h3>4.5. Расчётные направления ветра</h3>
<table>
<thead><tr><th>Ветер</th><th>Вес стали</th><th>Вес льда</th><th>Ветер на рёбра</th><th>Прогиб вершины</th><th>ηmax</th><th>λcr</th></tr></thead>
<tbody>${tableRows(loadRows)}</tbody>
</table>

<h2>5. Конечно-элементная frame-модель</h2>
<p>Каждый узел имеет шесть степеней свободы: <em>q = [u<sub>x</sub>,u<sub>y</sub>,u<sub>z</sub>,r<sub>x</sub>,r<sub>y</sub>,r<sub>z</sub>]</em>. Все рёбра, сходящиеся в узле, соединены идеально жёстко. Три узла основания имеют нулевые поступательные и вращательные перемещения.</p>
<p>Каждое ребро моделируется пространственным элементом Euler–Bernoulli. В локальной матрице жёсткости используются коэффициенты:</p>
<ul>
  <li>осевая жёсткость: <em>EA/L</em>;</li>
  <li>крутильная жёсткость: <em>GJ/L</em>;</li>
  <li>изгиб: <em>12EI/L³</em>, <em>6EI/L²</em>, <em>4EI/L</em>, <em>2EI/L</em>.</li>
</ul>
<div class="formula">
  <div class="formula-symbolic">Kₑ = Tᵀ·kₑ·T</div>
  <div>Локальная 12×12 матрица преобразуется в глобальную систему координат.</div>
</div>
<div class="formula">
  <div class="formula-symbolic">K·u = F</div>
  <div>После сборки всех элементов и наложения закреплений решается глобальная линейная система. Распределённые нагрузки вводятся согласованными эквивалентными узловыми силами и моментами.</div>
</div>
<p>Число узлов: <strong>${result.model.nodes.length}</strong>; число рёбер: <strong>${result.model.members.length}</strong>; свободных степеней свободы в определяющем случае: <strong>${strengthCase.analysis.diagnostics.freeDofCount}</strong>.</p>

<h2>6. Проверка прочности ребра</h2>
<p>Определяющее ребро № <strong>${critical.memberId}</strong> (${criticalMember.nodeA}–${criticalMember.nodeB}), расчётный случай ветра <strong>${number(strengthCase.windDirectionDeg, 0)}°</strong>.</p>
${formula(
    'σN = |N|/A',
    `σN = |${number(critical.axialForceN, 3)}|/${scientific(areaM2)} Па`,
    `${number(criticalAxialStressPa / 1e6, 3)} МПа`,
  )}
${formula(
    'σM = Mmax/W',
    `σM = ${number(critical.maxBendingNm, 5)}/${scientific(sectionModulusM3)} Па`,
    `${number(criticalBendingStressPa / 1e6, 3)} МПа`,
  )}
${formula(
    'σ = σN + σM',
    `σ = ${number(criticalAxialStressPa / 1e6, 3)} + ${number(criticalBendingStressPa / 1e6, 3)} МПа`,
    `${number(criticalNormalStressPa / 1e6, 3)} МПа`,
  )}
${formula(
    'τT = T·(d/2)/J',
    `τT = ${number(critical.maxTorsionNm, 5)}·(${number(diameterM, 6)}/2)/${scientific(torsionConstantM4)} Па`,
    `${number(critical.torsionShearPa / 1e6, 3)} МПа`,
  )}
${formula(
    'τV = 4V/(3A)',
    `τV = 4·${number(critical.maxShearN, 3)}/(3·${scientific(areaM2)}) Па`,
    `${number(critical.transverseShearPa / 1e6, 3)} МПа`,
  )}
${formula(
    'τ = √(τT² + τV²)',
    `τ = √(${number(critical.torsionShearPa / 1e6, 3)}² + ${number(critical.transverseShearPa / 1e6, 3)}²) МПа`,
    `${number(criticalShearPa / 1e6, 3)} МПа`,
  )}
${formula(
    'σeq = √(σ² + 3τ²)',
    `σeq = √(${number(criticalNormalStressPa / 1e6, 3)}² + 3·${number(criticalShearPa / 1e6, 3)}²) МПа`,
    `${number(criticalEquivalentPa / 1e6, 3)} МПа`,
  )}
${formula(
    'ησ = σeq/Ryd',
    `ησ = ${number(criticalEquivalentPa / 1e6, 3)}/${number(designYieldPa / 1e6, 3)}`,
    number(criticalStressUtilization, 5),
  )}
<p class="equation-note">При равномерной поперечной нагрузке максимум изгиба может находиться между узлами. Текущая реализация консервативно добавляет к максимуму конечных моментов величину <em>q⊥L²/8</em>; для определяющего ребра эта добавка составляет ${number(critical.distributedBendingAllowanceNm, 5)} Н·м.</p>

<h2>7. Локальная устойчивость ребра</h2>
<p>Для дополнительной проверки отдельного сжатого ребра его концы принимаются идеально жёсткими: μ = ${number(p.effectiveLengthFactor, 3)}.</p>
${formula(
    'Leff = μ·L',
    `Leff = ${number(p.effectiveLengthFactor, 3)}·${number(criticalLengthM, 6)} м`,
    `${number(effectiveLengthM, 6)} м`,
  )}
${formula(
    'NE = π²EI/Leff²/γM',
    `NE = π²·${number(youngPa / 1e9, 3)}·10⁹·${scientific(inertiaM4)}/${number(effectiveLengthM, 6)}²/${number(p.materialSafetyFactor, 3)} Н`,
    `${number(criticalEulerN / 1000, 4)} кН`,
  )}
${formula(
    'ηE = Ncompression/NE',
    `ηE = ${number(criticalCompressionN / 1000, 5)}/${number(criticalEulerN / 1000, 5)}`,
    number(criticalBucklingUtilization, 5),
  )}
${formula(
    'η = max(ησ, ηE)',
    `η = max(${number(criticalStressUtilization, 5)}, ${number(criticalBucklingUtilization, 5)})`,
    number(critical.utilization, 5),
  )}

<h2>8. Общая устойчивость мачты</h2>
<div class="formula">
  <div class="formula-symbolic">(K + λ·KG)·φ = 0</div>
  <div>После линейного статического расчёта формируется геометрическая матрица жёсткости frame-элементов по их продольным усилиям. Минимальный положительный множитель определяет первую линейную форму потери устойчивости.</div>
</div>
<div class="grid">
  <div><strong>Минимальный λcr:</strong> ${number(result.envelope.minimumBucklingFactor, 5)}</div>
  <div><strong>Направление ветра:</strong> ${number(result.envelope.buckling.windDirectionDeg, 0)}°</div>
  <div><strong>Невязка собственной задачи:</strong> ${scientific(result.envelope.buckling.analysis.buckling.residual, 3)}</div>
  <div><strong>Итераций eigensolver:</strong> ${escapeHtml(result.envelope.buckling.analysis.buckling.iterations)}</div>
</div>

<h2>9. Сводные результаты</h2>
<div class="grid">
  <div><strong>Расчётная высота мачты:</strong> ${number(mastHeightM, 4)} м</div>
  <div><strong>Масса рёбер:</strong> ${number(result.analysis.totalMassKg, 3)} кг</div>
  <div><strong>Максимальный прогиб вершины:</strong> ${number(result.envelope.maxTopDisplacementM * 1000, 3)} мм</div>
  <div><strong>Допустимый прогиб:</strong> ${number(p.displacementLimitMm, 3)} мм</div>
  <div><strong>Максимальное использование:</strong> <span class="${result.envelope.maxUtilization > 1 ? 'bad' : 'pass'}">${number(result.envelope.maxUtilization, 5)}</span></div>
  <div><strong>Минимальный λcr:</strong> <span class="${result.envelope.minimumBucklingFactor < p.minimumBucklingFactor ? 'bad' : 'pass'}">${number(result.envelope.minimumBucklingFactor, 5)}</span></div>
</div>

<h2>10. Материальная ведомость</h2>
<table>
<thead><tr><th>Тип</th><th>Диаметр</th><th>Расчётная длина</th><th>Количество</th><th>Суммарная длина</th><th>Масса</th></tr></thead>
<tbody>${tableRows(materialRows)}</tbody>
</table>

<h2 class="page-break">11. Огибающая усилий и проверок по рёбрам</h2>
<table>
<thead><tr><th>№</th><th>Тип</th><th>Узлы</th><th>L</th><th>N</th><th>Vmax</th><th>Tmax</th><th>Mmax</th><th>σeq</th><th>Ветер</th><th>η</th></tr></thead>
<tbody>${tableRows(memberRows)}</tbody>
</table>

<h2>12. Численная диагностика</h2>
<div class="grid">
  <div><strong>Относительная невязка K·u−F:</strong> ${scientific(result.analysis.diagnostics.relativeResidual, 3)}</div>
  <div><strong>Минимальное отношение pivot:</strong> ${scientific(result.analysis.diagnostics.minPivotRatio, 3)}</div>
  <div><strong>Макс. невязка свободной DOF:</strong> ${scientific(result.analysis.diagnostics.maximumNodeEquilibriumResidual, 3)}</div>
  <div><strong>Глобальная невязка моментов:</strong> ${scientific(result.analysis.diagnostics.globalMomentResidual, 3)}</div>
</div>

<h2>13. Ограничения текущей версии</h2>
<ul>${warningItems}</ul>
<p><strong>Отдельно не проверены:</strong> реальные сварочные швы арматуры к гайкам/болтам, резьбовое соединение, болты/шпильки, прочность гаек, фундамент, усталость, геометрическая нелинейность и начальные несовершенства. Эти проверки должны быть добавлены отдельным модулем узлов после получения из frame-модели усилий N, Vy, Vz, T, My, Mz.</p>
</body>
</html>`
}
