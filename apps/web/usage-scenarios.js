import {
  createEngineeringSummary,
  previewRibFabrication,
} from '../../packages/application/index.js'
import { readProjectInputFromForm } from './project-form-dom.js'
import { renderReferenceCatalogs } from './reference-catalog.js'

const $ = (selector) => document.querySelector(selector)
const form = $('#parameters-form')
const calculateButton = $('#calculate-button')
const optimizeButton = $('#optimize-button')
const scenarioAnswer = $('#scenario-answer')
const scenarioTitle = $('#scenario-answer-title')
const scenarioStatus = $('#scenario-answer-status')
const scenarioText = $('#scenario-answer-text')
const scenarioMetrics = $('#scenario-key-metrics')
const algorithmDetails = $('#algorithm-details')
const allMetricsDetails = $('#all-metrics-details')
const governingDetails = $('#governing-details')
const verificationDetails = $('#verification-details')
const referenceDetails = $('#reference-details')
const jointInputDetails = $('#joint-input-details')
let lastUsageSnapshot = null

const SCENARIOS = Object.freeze({
  check: {
    label: 'Проверить мачту',
    description: 'Проверяется выбранная конструкция при заданной погоде и массе оборудования.',
  },
  design: {
    label: 'Подобрать конструкцию',
    description: 'Главная операция — подбор минимального проходящего диаметра арматуры и согласованного узла.',
  },
  limits: {
    label: 'Рассчитать пределы',
    description: 'В фокусе максимальная высота, масса на вершине и грузоподъёмность горизонтальной стрелы.',
  },
  verify: {
    label: 'Рассчитать и проверить',
    description: 'В фокусе цепочка алгоритма, внутренние cross-checks и возможность ручной перепроверки.',
  },
})

const CRITERION_LABELS = Object.freeze({
  'bare-member-utilization': 'ребро голой мачты',
  'bare-global-buckling': 'общая устойчивость голой мачты',
  'bare-top-displacement': 'прогиб голой мачты',
  'bare-connection': 'физический межмодульный узел',
  'internal-verification': 'внутренняя верификация',
  'guyed-member-utilization': 'ребро с растяжками',
  'guyed-global-buckling': 'общая устойчивость с растяжками',
  'guyed-top-displacement': 'прогиб с растяжками',
  'guy-cable-utilization': 'рабочая нагрузка троса',
  'guy-nonlinear-convergence': 'сходимость нелинейного расчёта растяжек',
  'guyed-connection-envelope': 'болты и сварка по усилиям мачты с растяжками',
})

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
  : '—'

function closestMetricArticle(id) {
  return document.querySelector(id)?.closest('article') ?? null
}

function setMetricLabel(id, text) {
  const article = closestMetricArticle(id)
  const caption = article?.querySelector('span')
  if (caption) caption.textContent = text
}

function installIssue36Ui() {
  const equipment = form?.elements.namedItem('equipmentMassKg')
  if (equipment?.closest('label')) {
    const label = equipment.closest('label')
    for (const node of [...label.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = ''
    }
    label.prepend(document.createTextNode('Уже установленная масса на вершине, кг'))
  }

  setMetricLabel('#metric-lateral-capacity', 'Чистый поперечный предел')
  setMetricLabel('#metric-static-payload', 'Максимальная масса на вершине')
  setMetricLabel('#metric-static-reserve', 'Сколько ещё можно добавить сверху')
  const waterArticle = closestMetricArticle('#metric-water-volume')
  if (waterArticle) waterArticle.hidden = true

  const lateralCardTitle = document.querySelector('.lateral-card h3')
  if (lateralCardTitle) lateralCardTitle.textContent = 'Поперечный unit-load и горизонтальная стрела'
  const staticCardTitle = document.querySelector('.static-payload-card h3')
  if (staticCardTitle) staticCardTitle.textContent = 'Масса груза на вершине вертикальной мачты'

  const eyebrow = document.querySelector('.page-header .eyebrow')
  if (eyebrow) eyebrow.textContent = 'Калькулятор мачты · прототип 1.4'
  document.body.dataset.issue36StaticLoadModel = 'top-mass-only'
}

installIssue36Ui()

function selectedScenario() {
  return document.querySelector('input[name="usageScenario"]:checked')?.value ?? 'check'
}

function metricCard(label, value, note = '') {
  const card = document.createElement('article')
  const caption = document.createElement('span')
  const strong = document.createElement('strong')
  const small = document.createElement('small')
  caption.textContent = label
  strong.textContent = value
  small.textContent = note
  card.append(caption, strong, small)
  return card
}

function criterionById(summary, id) {
  return summary.criteria.find((item) => item.id === id) ?? null
}

function criterionLabel(id) {
  return CRITERION_LABELS[id] ?? id
}

function statusPresentation(summary) {
  if (summary.overallStatus === 'fail') {
    return {
      label: 'НЕ ПРОХОДИТ',
      className: 'answer-fail',
      title: 'Выбранный проект не проходит текущие проверки',
    }
  }
  if (summary.overallStatus === 'incomplete') {
    return {
      label: 'НЕПОЛНАЯ ПРОВЕРКА',
      className: 'answer-warn',
      title: 'Для выбранного проекта ещё не закрыты все обязательные проверки',
    }
  }
  return {
    label: 'ПРОХОДИТ',
    className: 'answer-pass',
    title: 'Выбранный проект проходит текущие проверки',
  }
}

function criterionMetric(summary, id, label) {
  const criterion = criterionById(summary, id)
  if (!criterion) return metricCard(label, '—', 'критерий отсутствует')
  if (criterion.status === 'not-verified') return metricCard(label, 'НЕ ПРОВЕРЕНО', 'обязательная проверка ещё не реализована')
  if (id.includes('displacement')) {
    return metricCard(label, `${format(criterion.value, 1)} мм`, `лимит ${format(criterion.limit, 0)} мм`)
  }
  if (id.includes('buckling')) {
    return metricCard(label, `λcr = ${format(criterion.value, 3)}`, `требуется ≥ ${format(criterion.limit, 2)}`)
  }
  if (id === 'bare-connection') {
    return metricCard(label, criterion.status === 'pass' ? 'проходит' : 'НЕ ПРОХОДИТ', criterion.value == null ? '' : `Uболта ${format(criterion.value, 3)}`)
  }
  if (id === 'guy-nonlinear-convergence') {
    return metricCard(label, criterion.status === 'pass' ? 'сошлось' : 'НЕ СОШЛОСЬ', criterion.value ? `${criterion.value} несошедшихся случаев` : '')
  }
  return metricCard(label, `U = ${format(criterion.value, 3)}`, `лимит ${format(criterion.limit, 2)}`)
}

function renderCheckScenario(result, guyResult) {
  const summary = createEngineeringSummary(result, guyResult)
  const status = statusPresentation(summary)
  const governing = summary.governingCriterionId ? criterionById(summary, summary.governingCriterionId) : null
  const pendingText = summary.pendingCriterionIds.map(criterionLabel).join(', ')

  scenarioTitle.textContent = status.title
  scenarioStatus.textContent = status.label
  scenarioStatus.className = `answer-status ${status.className}`

  if (summary.overallStatus === 'incomplete') {
    scenarioText.textContent = `Реализованные критерии не дали полного запрета, но общий PASS выдавать нельзя. Не закрыто: ${pendingText}. Для мачты с растяжками существующий PASS обычного узла не доказывает болты/сварку по нелинейным guyed усилиям.`
  } else if (summary.overallStatus === 'fail') {
    scenarioText.textContent = `Есть непройденный обязательный критерий. Определяющий сейчас: ${criterionLabel(summary.governingCriterionId)}. Подробности и численные причины можно раскрыть ниже.`
  } else {
    scenarioText.textContent = `Все обязательные текущие критерии проходят. Ближе всего к пределу: ${criterionLabel(governing?.id)}. Подробности и ограничения модели можно раскрыть ниже.`
  }

  if (guyResult) {
    scenarioMetrics.replaceChildren(
      criterionMetric(summary, 'guyed-member-utilization', 'Ребро с растяжками'),
      criterionMetric(summary, 'guy-cable-utilization', 'Трос'),
      criterionMetric(summary, 'guyed-global-buckling', 'Устойчивость'),
      criterionMetric(summary, 'guyed-connection-envelope', 'Соединение guyed'),
    )
  } else {
    scenarioMetrics.replaceChildren(
      criterionMetric(summary, 'bare-member-utilization', 'Ребро'),
      criterionMetric(summary, 'bare-global-buckling', 'Общая устойчивость'),
      criterionMetric(summary, 'bare-top-displacement', 'Прогиб вершины'),
      criterionMetric(summary, 'bare-connection', 'Соединение'),
    )
  }
}

function renderDesignScenario(result, guyResult) {
  const summary = createEngineeringSummary(result, guyResult)
  const status = statusPresentation(summary)
  const geometry = result.connections?.configurator?.geometry
  const bolt = geometry?.bolt
  const bottom = geometry?.bottomClearanceNut
  scenarioTitle.textContent = 'Текущий рассчитанный комплект конструкции'
  scenarioStatus.textContent = summary.overallStatus === 'pass'
    ? 'КОМПЛЕКТ ПРОХОДИТ'
    : summary.overallStatus === 'fail' ? 'НЕ ПРОХОДИТ' : 'ТРЕБУЕТ ДОП. ПРОВЕРКИ'
  scenarioStatus.className = `answer-status ${status.className}`
  scenarioText.textContent = guyResult
    ? 'Текущий комплект рассчитан вместе с растяжками. Подбор единого диаметра при включённых растяжках намеренно заблокирован; кроме того, пока не реализована отдельная проверка болтов/сварки по guyed усилиям.'
    : 'Для автоматического поиска минимального проходящего варианта используйте кнопку «Подобрать конструкцию». После подбора здесь показывается уже фактически рассчитанный комплект, а не исходные значения формы.'
  scenarioMetrics.replaceChildren(
    metricCard('Арматура', `Ø${format(result.parameters.barDiameterMm, 0)} ${result.parameters.reinforcementClass}`, `ребро ${format(result.parameters.ribCutLengthMm, 1)} мм`),
    metricCard('Болт', bolt ? `M${bolt.diameterMm}×${format(bolt.lengthMm, 0)} ${result.parameters.jointBoltClass}` : '—', bottom ? `проходная гайка M${bottom.threadDiameterMm}` : ''),
    metricCard('Высота текущей мачты', `${format(result.parameters.moduleCount * result.parameters.moduleHeightMm / 1000, 2)} м`, `${result.parameters.moduleCount} модулей`),
    metricCard('Общий статус', status.label, summary.governingCriterionId ? `определяет: ${criterionLabel(summary.governingCriterionId)}` : ''),
  )
}

function boomMetric(boom) {
  if (!boom) return { value: '—', note: 'расчёт стрелы отсутствует' }
  if (boom.governingMode !== 'boom-self-weight-overlimit') {
    return {
      value: `${format(boom.maximumEndPayloadMassKg, 1)} кг`,
      note: `собственный вес арматурной стрелы ≈ ${format(boom.boomSelfMassEquivalentKg, 1)} кг; без динамики подъёма`,
    }
  }
  return {
    value: '0 кг — сам вес не проходит',
    note: `при горизонтальном положении Uболта=${format(boom.governing?.boltUtilizationAtLimit, 2)} > 1; масса арматурной стрелы ≈ ${format(boom.boomSelfMassEquivalentKg, 1)} кг`,
  }
}

function renderLimitsScenario(result, guyResult) {
  const summary = createEngineeringSummary(result, guyResult)
  const status = statusPresentation(summary)
  const lateral = result.lateralCapacity
  const boom = result.craneBoomCapacity
  const payload = result.staticPayloadCapacity
  const height = result.heightCapacity
  const boomAnswer = boomMetric(boom)
  scenarioTitle.textContent = 'Пределы выбранного типа мачты'
  scenarioStatus.textContent = status.label
  scenarioStatus.className = `answer-status ${status.className}`
  scenarioText.textContent = guyResult
    ? 'Показанные ниже height/lateral/static/boom limits принадлежат обычному bare-frame CalculationResult и не являются пределами мачты с растяжками. Для guyed проекта пока доступны эксплуатационная nonlinear envelope и отдельный статус её критериев.'
    : 'Для вертикальной мачты показывается максимальная масса на вершине. Для горизонтальной стрелы выполняется отдельный расчёт: собственный вес арматурных рёбер действует поперёк стрелы и вместе с концевым грузом расходует её несущую способность. Чистый unit-load предел остаётся отдельной верификационной величиной.'
  scenarioMetrics.replaceChildren(
    metricCard('Проектная высота', `${height.design.bounded ? '' : '≥ '}${format(height.design.maximumHeightM, 2)} м`, `${height.design.maximumModules} модулей${guyResult ? '; bare-frame' : ''}`),
    metricCard('Горизонтальная стрела', boomAnswer.value, `${boomAnswer.note}${guyResult ? '; bare-frame' : ''}`),
    metricCard('Максимум на вершине', `${format(payload.maximumTopEquipmentMassKg ?? payload.maximumTotalTopMassKg, 1)} кг`, `суммарная масса оборудования/груза${guyResult ? '; bare-frame' : ''}`),
    metricCard('Можно добавить', `${format(payload.additionalTopEquipmentMassKg ?? payload.remainingAdditionalMassKg, 1)} кг`, `уже задано ${format(payload.configuredTopEquipmentMassKg ?? result.parameters.equipmentMassKg, 1)} кг; pure lateral ${format(lateral.criticalForceKgf, 1)} кгс`),
  )
}

function renderVerifyScenario(result, guyResult) {
  const summary = createEngineeringSummary(result, guyResult)
  const status = statusPresentation(summary)
  const verification = result.verification
  const modular = result.analysis.modular
  scenarioTitle.textContent = 'Верификация и полнота текущей проверки'
  scenarioStatus.textContent = status.label
  scenarioStatus.className = `answer-status ${status.className}`
  scenarioText.textContent = summary.overallStatus === 'incomplete'
    ? `Внутренние cross-checks расчёта могут быть зелёными, но проект ещё нельзя объявить полностью проверенным: ${summary.pendingCriterionIds.map(criterionLabel).join(', ')}. Внешний FEM, инженерная рецензия и натурные испытания также остаются отдельными уровнями validation.`
    : 'Зелёная внутренняя проверка означает согласованность принятой математической модели, но не внешнюю сертификацию реальной мачты. Независимый сторонний FEM, инженерная рецензия и натурные испытания остаются отдельными уровнями.'
  scenarioMetrics.replaceChildren(
    metricCard('Паспорт', `${verification?.counts?.passed ?? 0} пройдено`, `${verification?.counts?.notVerified ?? 0} внешних/ручных пунктов ожидают подтверждения`),
    metricCard('Global ↔ Schur', modular?.relativeDisplacementDifference?.toExponential(2) ?? '—', 'relative DOF difference'),
    metricCard('Interface residual', modular?.interfaceEquilibriumResidual?.toExponential(2) ?? '—', 'силы и моменты между модулями'),
    metricCard('Общий статус', status.label, summary.pendingCriterionIds.length ? `не закрыто: ${summary.pendingCriterionIds.map(criterionLabel).join(', ')}` : 'обязательные текущие критерии закрыты'),
  )
}

function renderScenarioResult(result, guyResult = null) {
  scenarioAnswer.hidden = false
  const scenario = selectedScenario()
  if (scenario === 'design') renderDesignScenario(result, guyResult)
  else if (scenario === 'limits') renderLimitsScenario(result, guyResult)
  else if (scenario === 'verify') renderVerifyScenario(result, guyResult)
  else renderCheckScenario(result, guyResult)

  algorithmDetails.open = scenario === 'verify'
  verificationDetails.open = scenario === 'verify'
  referenceDetails.open = scenario === 'verify'
  allMetricsDetails.open = false
  governingDetails.open = scenario === 'limits'
}

function renderIssue36DetailedResult(result) {
  const lateral = result?.lateralCapacity
  const boom = result?.craneBoomCapacity
  const payload = result?.staticPayloadCapacity
  if (!lateral || !payload) return
  const maximum = payload.maximumTopEquipmentMassKg ?? payload.maximumTotalTopMassKg
  const remaining = payload.additionalTopEquipmentMassKg ?? payload.remainingAdditionalMassKg
  const configured = payload.configuredTopEquipmentMassKg ?? result.parameters?.equipmentMassKg ?? 0

  const staticDescription = $('#static-payload-description')
  if (staticDescription) {
    staticDescription.textContent = `Gravity-only расчёт вертикальной мачты: максимальная суммарная масса оборудования/груза на вершине ${format(maximum, 1)} кг. Уже задано ${format(configured, 1)} кг, поэтому до первого расчётного предела можно добавить ещё ${format(remaining, 1)} кг. Ветер и лёд в этой специальной предельной задаче отключены.`
  }
  const lateralDescription = $('#lateral-capacity-description')
  if (lateralDescription) {
    const boomText = boom
      ? ` Отдельная модель горизонтальной стрелы включает поперечный собственный вес арматурных рёбер ≈ ${format(boom.boomSelfMassEquivalentKg, 1)} кг и даёт максимальный концевой груз ${format(boom.maximumEndPayloadMassKg, 1)} кг в определяющем направлении ${format(boom.governingDirectionDeg, 0)}°.`
      : ''
    lateralDescription.textContent = `Чистый поперечный unit-load предел вершины ${format(lateral.criticalForceKgf, 1)} кгс рассчитан без собственного веса, погоды и оборудования и служит reference upper bound.${boomText} Для реального подъёмного механизма дополнительно нужны динамика, узел поворота/опирания, трос и нормативные коэффициенты.`
  }
  const waterArticle = closestMetricArticle('#metric-water-volume')
  if (waterArticle) waterArticle.hidden = true
}

function renderAssemblyMass(result) {
  const mass = result.assemblyMass
  if (!mass) {
    $('#assembly-mass-explanation').textContent = 'В полном результате отсутствует оценка сборочной массы.'
    return
  }
  $('#metric-rib-mass').textContent = `${format(mass.rib.massKg, 3)} кг`
  $('#metric-rib-weight').textContent = `${format(mass.rib.weightN, 1)} Н; ${format(mass.rib.massPerMeterKg, 3)} кг/м`
  $('#metric-joint-mass').textContent = `${format(mass.intermoduleJoint.totalMassKg, 3)} кг`
  $('#metric-module-mass').textContent = `${format(mass.module.totalMassKg, 2)} кг`
  $('#metric-fabricated-mass').textContent = `${format(mass.mastFabricationEstimate.uniformModulesMassKg, 1)} кг`
  $('#assembly-mass-explanation').textContent = `Для унифицированного модуля принята критическая требуемая длина шва ${format(mass.weld.designPhysicalLengthPerEndMm, 1)} мм на каждый из 18 концов, катет ${format(mass.weld.legMm, 1)} мм. Метизы оценены по справочной геометрии. ${mass.reasonNotInFem}`
}

function syncRibMassPreview() {
  try {
    const preview = previewRibFabrication(readProjectInputFromForm(form))
    $('#preview-rib-mass').textContent = `${format(preview.ribMassKg, 3)} кг`
  } catch {
    $('#preview-rib-mass').textContent = '—'
  }
}

function syncScenarioControls() {
  const scenario = selectedScenario()
  document.body.dataset.usageScenario = scenario
  calculateButton.textContent = SCENARIOS[scenario].label
  calculateButton.title = SCENARIOS[scenario].description
  const design = scenario === 'design'
  calculateButton.classList.toggle('primary', !design)
  calculateButton.classList.toggle('secondary', design)
  optimizeButton.classList.toggle('primary', design)
  optimizeButton.classList.toggle('secondary', !design)
  optimizeButton.textContent = design ? 'Подобрать конструкцию' : 'Подобрать арматуру и узел'
  if (scenario === 'verify') referenceDetails.open = true
  if (scenario === 'design') jointInputDetails.open = false
  if (scenarioAnswer.hidden === false && lastUsageSnapshot) {
    renderScenarioResult(lastUsageSnapshot.result, lastUsageSnapshot.guyResult)
  }
}

export function initializeUsageExperience() {
  renderReferenceCatalogs(document)
  for (const radio of document.querySelectorAll('input[name="usageScenario"]')) {
    radio.addEventListener('change', syncScenarioControls)
  }
  for (const name of ['stockBarLengthMm', 'stockBarPieces', 'barDiameterMm', 'reinforcementClass']) {
    form.elements.namedItem(name)?.addEventListener('change', syncRibMassPreview)
  }
  syncScenarioControls()
  syncRibMassPreview()
}

export function enrichAndRenderUsageResult(result, guyResult = null) {
  if (!result) return result
  renderAssemblyMass(result)
  lastUsageSnapshot = { result, guyResult }
  renderScenarioResult(result, guyResult)
  queueMicrotask(() => renderIssue36DetailedResult(result))
  return result
}
