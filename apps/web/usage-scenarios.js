import {
  calculateAssemblyMass,
  reinforcementMassPerMeterKg,
} from '../../packages/design/index.js'
import {
  getReinforcementClass,
  theoreticalCutLengthMm,
} from '../../packages/domain/index.js'
import { saveDesignResult } from '../../packages/design/index.js'
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
let designWorkspaceButton = null
let designWorkspaceNote = null

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

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
  : '—'

function closestMetricArticle(id) {
  return document.querySelector(id)?.closest('article') ?? null
}

function removeLegacyForceControl(name) {
  const element = form?.elements.namedItem(name)
  element?.closest('label')?.remove()
}

function setMetricLabel(id, text) {
  const article = closestMetricArticle(id)
  const caption = article?.querySelector('span')
  if (caption) caption.textContent = text
}

function installIssue36Ui() {
  removeLegacyForceControl('extraHorizontalLoadN')
  removeLegacyForceControl('extraVerticalLoadN')

  const equipment = form?.elements.namedItem('equipmentMassKg')
  if (equipment?.closest('label')) {
    const label = equipment.closest('label')
    for (const node of [...label.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = ''
    }
    label.prepend(document.createTextNode('Уже установленная масса на вершине, кг'))
  }

  for (const details of document.querySelectorAll('details.input-details')) {
    const summary = details.querySelector(':scope > summary')
    if (summary?.textContent.includes('Уточнить ветер и дополнительные нагрузки')) {
      summary.textContent = 'Уточнить ветер и параметры среды'
      for (const note of details.querySelectorAll('.practical-note')) {
        if (/не задавайте одну и ту же нагрузку дважды/i.test(note.textContent)) note.remove()
      }
    }
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

function installDesignWorkspaceUi() {
  const exportRow = document.querySelector('.export-row')
  if (!exportRow) return
  document.querySelector('#export-obj-button')?.remove()
  const noteButton = document.querySelector('#export-note-button')
  if (noteButton) {
    noteButton.textContent = 'Скачать расчётный проект'
    noteButton.title = 'Расчёт и верификация без конструкторской документации'
  }
  designWorkspaceButton = document.querySelector('#open-design-workspace-button')
  if (!designWorkspaceButton) {
    designWorkspaceButton = document.createElement('button')
    designWorkspaceButton.id = 'open-design-workspace-button'
    designWorkspaceButton.className = 'secondary'
    designWorkspaceButton.type = 'button'
    designWorkspaceButton.disabled = true
    designWorkspaceButton.textContent = 'Открыть 3D и КД'
    designWorkspaceButton.title = 'Подробная 3D-модель, OBJ и отдельный комплект конструкторской документации'
    designWorkspaceButton.addEventListener('click', () => {
      globalThis.location.href = './design.html'
    })
    exportRow.append(designWorkspaceButton)
  }
  designWorkspaceNote = document.querySelector('#design-workspace-note')
  if (!designWorkspaceNote) {
    designWorkspaceNote = document.createElement('p')
    designWorkspaceNote.id = 'design-workspace-note'
    designWorkspaceNote.className = 'hint practical-note'
    designWorkspaceNote.textContent = 'Расчётный проект содержит только расчёты. Подробная 3D-модель, OBJ и КД по ЕСКД вынесены в отдельный модуль и становятся доступны после расчёта.'
    exportRow.after(designWorkspaceNote)
  }
  document.body.dataset.issue47DesignWorkspace = 'separate'
}

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

function currentCriteria(result) {
  const parameters = result.parameters
  const utilization = result.envelope.maxUtilization
  const buckling = result.envelope.minimumBucklingFactor
  const displacementMm = result.envelope.maxTopDisplacementM * 1000
  const connectionPasses = result.connections?.passes !== false
  const criteria = [
    { id: 'member', passes: utilization <= 1, ratio: utilization, label: `ребро U=${format(utilization, 3)}` },
    { id: 'buckling', passes: buckling >= parameters.minimumBucklingFactor, ratio: parameters.minimumBucklingFactor / Math.max(buckling, Number.EPSILON), label: `λcr=${format(buckling, 3)}` },
    { id: 'displacement', passes: displacementMm <= parameters.displacementLimitMm, ratio: displacementMm / Math.max(parameters.displacementLimitMm, Number.EPSILON), label: `прогиб ${format(displacementMm, 1)} мм` },
    { id: 'connection', passes: connectionPasses, ratio: result.connections?.bolt?.selected?.utilization ?? 0, label: connectionPasses ? 'узел проходит' : 'узел не проходит' },
  ]
  return { criteria, passes: criteria.every((item) => item.passes) }
}

function governingCriterion(result) {
  const { criteria } = currentCriteria(result)
  return [...criteria].sort((left, right) => right.ratio - left.ratio)[0]
}

function renderCheckScenario(result) {
  const check = currentCriteria(result)
  const governing = governingCriterion(result)
  scenarioTitle.textContent = check.passes ? 'Выбранная мачта проходит текущие проверки' : 'Выбранная мачта не проходит текущие проверки'
  scenarioStatus.textContent = check.passes ? 'ПРОХОДИТ' : 'НЕ ПРОХОДИТ'
  scenarioStatus.className = `answer-status ${check.passes ? 'answer-pass' : 'answer-fail'}`
  scenarioText.textContent = check.passes
    ? `Все четыре главных критерия проходят. Ближе всего к пределу: ${governing.label}. Подробности и ограничения модели можно раскрыть ниже.`
    : `Есть хотя бы один непройденный критерий. Определяющий сейчас: ${governing.label}. Раскройте «Почему получился именно такой предел?» для численной причины.`
  scenarioMetrics.replaceChildren(
    metricCard('Ребро', `U = ${format(result.envelope.maxUtilization, 3)}`, '≤ 1'),
    metricCard('Общая устойчивость', `λcr = ${format(result.envelope.minimumBucklingFactor, 3)}`, `требуется ≥ ${format(result.parameters.minimumBucklingFactor, 2)}`),
    metricCard('Прогиб вершины', `${format(result.envelope.maxTopDisplacementM * 1000, 1)} мм`, `лимит ${format(result.parameters.displacementLimitMm, 0)} мм`),
    metricCard('Соединение', result.connections?.passes === false ? 'НЕ ПРОХОДИТ' : 'проходит', `Uболта ${format(result.connections?.bolt?.selected?.utilization ?? 0, 3)}`),
  )
}

function renderDesignScenario(result) {
  const geometry = result.connections?.configurator?.geometry
  const bolt = geometry?.bolt
  const bottom = geometry?.bottomClearanceNut
  scenarioTitle.textContent = 'Текущий подобранный комплект конструкции'
  scenarioStatus.textContent = currentCriteria(result).passes ? 'КОМПЛЕКТ ПРОХОДИТ' : 'НУЖЕН ПОДБОР'
  scenarioStatus.className = `answer-status ${currentCriteria(result).passes ? 'answer-pass' : 'answer-warn'}`
  scenarioText.textContent = 'Для автоматического поиска минимального проходящего варианта используйте кнопку «Подобрать конструкцию». После подбора здесь показывается уже фактически рассчитанный комплект, а не исходные значения формы.'
  scenarioMetrics.replaceChildren(
    metricCard('Арматура', `Ø${format(result.parameters.barDiameterMm, 0)} ${result.parameters.reinforcementClass}`, `ребро ${format(result.parameters.ribCutLengthMm, 1)} мм`),
    metricCard('Болт', bolt ? `M${bolt.diameterMm}×${format(bolt.lengthMm, 0)} ${result.parameters.jointBoltClass}` : '—', bottom ? `проходная гайка M${bottom.threadDiameterMm}` : ''),
    metricCard('Высота текущей мачты', `${format(result.parameters.moduleCount * result.parameters.moduleHeightMm / 1000, 2)} м`, `${result.parameters.moduleCount} модулей`),
    metricCard('Запас текущего ребра', `${format(1 / Math.max(result.envelope.maxUtilization, Number.EPSILON), 2)}×`, `U=${format(result.envelope.maxUtilization, 3)}`),
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

function renderLimitsScenario(result) {
  const lateral = result.lateralCapacity
  const boom = result.craneBoomCapacity
  const payload = result.staticPayloadCapacity
  const height = result.heightCapacity
  const boomAnswer = boomMetric(boom)
  scenarioTitle.textContent = 'Пределы выбранного типа мачты'
  scenarioStatus.textContent = 'ПРЕДЕЛЫ РАССЧИТАНЫ'
  scenarioStatus.className = 'answer-status answer-info'
  scenarioText.textContent = 'Для вертикальной мачты показывается максимальная масса на вершине. Для горизонтальной стрелы выполняется отдельный расчёт: собственный вес арматурных рёбер действует поперёк стрелы и вместе с концевым грузом расходует её несущую способность. Чистый unit-load предел остаётся отдельной верификационной величиной.'
  scenarioMetrics.replaceChildren(
    metricCard('Проектная высота', `${height.design.bounded ? '' : '≥ '}${format(height.design.maximumHeightM, 2)} м`, `${height.design.maximumModules} модулей`),
    metricCard('Горизонтальная стрела', boomAnswer.value, boomAnswer.note),
    metricCard('Максимум на вершине', `${format(payload.maximumTopEquipmentMassKg ?? payload.maximumTotalTopMassKg, 1)} кг`, 'суммарная масса оборудования/груза'),
    metricCard('Можно добавить', `${format(payload.additionalTopEquipmentMassKg ?? payload.remainingAdditionalMassKg, 1)} кг`, `уже задано ${format(payload.configuredTopEquipmentMassKg ?? result.parameters.equipmentMassKg, 1)} кг; чистый lateral upper bound ${format(lateral.criticalForceKgf, 1)} кгс`),
  )
}

function renderVerifyScenario(result) {
  const verification = result.verification
  const modular = result.analysis.modular
  scenarioTitle.textContent = verification?.counts?.failed > 0
    ? 'Внутренняя проверка обнаружила ошибку'
    : 'Внутренняя проверка расчёта пройдена'
  scenarioStatus.textContent = verification?.counts?.failed > 0 ? 'ЕСТЬ ОШИБКИ' : 'ВНУТРЕННЕ ПРОВЕРЕНО'
  scenarioStatus.className = `answer-status ${verification?.counts?.failed > 0 ? 'answer-fail' : 'answer-pass'}`
  scenarioText.textContent = 'Зелёная внутренняя проверка означает согласованность принятой математической модели, но не внешнюю сертификацию реальной мачты. Независимый сторонний FEM, инженерная рецензия и натурные испытания остаются отдельными уровнями.'
  scenarioMetrics.replaceChildren(
    metricCard('Паспорт', `${verification?.counts?.passed ?? 0} пройдено`, `${verification?.counts?.notVerified ?? 0} внешних/ручных пунктов ожидают подтверждения`),
    metricCard('Global ↔ Schur', modular?.relativeDisplacementDifference?.toExponential(2) ?? '—', 'relative DOF difference'),
    metricCard('Interface residual', modular?.interfaceEquilibriumResidual?.toExponential(2) ?? '—', 'силы и моменты между модулями'),
    metricCard('Global residual', result.analysis.diagnostics.relativeResidual.toExponential(2), 'K·u − F'),
  )
}

function renderScenarioResult(result) {
  scenarioAnswer.hidden = false
  const scenario = selectedScenario()
  if (scenario === 'design') renderDesignScenario(result)
  else if (scenario === 'limits') renderLimitsScenario(result)
  else if (scenario === 'verify') renderVerifyScenario(result)
  else renderCheckScenario(result)

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
  const mass = result.assemblyMass ?? calculateAssemblyMass(result)
  result.assemblyMass = mass
  $('#metric-rib-mass').textContent = `${format(mass.rib.massKg, 3)} кг`
  $('#metric-rib-weight').textContent = `${format(mass.rib.weightN, 1)} Н; ${format(mass.rib.massPerMeterKg, 3)} кг/м`
  $('#metric-joint-mass').textContent = `${format(mass.intermoduleJoint.totalMassKg, 3)} кг`
  $('#metric-module-mass').textContent = `${format(mass.module.totalMassKg, 2)} кг`
  $('#metric-fabricated-mass').textContent = `${format(mass.mastFabricationEstimate.uniformModulesMassKg, 1)} кг`
  $('#assembly-mass-explanation').textContent = `Для унифицированного модуля принята критическая требуемая длина шва ${format(mass.weld.designPhysicalLengthPerEndMm, 1)} мм на каждый из 18 концов, катет ${format(mass.weld.legMm, 1)} мм. Метизы оценены по справочной геометрии. ${mass.reasonNotInFem}`
}

function syncRibMassPreview() {
  try {
    const stockLength = Number(form.elements.namedItem('stockBarLengthMm')?.value)
    const pieces = Number(form.elements.namedItem('stockBarPieces')?.value)
    const diameter = Number(form.elements.namedItem('barDiameterMm')?.value)
    const material = getReinforcementClass(form.elements.namedItem('reinforcementClass')?.value)
    const lengthM = theoreticalCutLengthMm(stockLength, pieces) / 1000
    const mass = reinforcementMassPerMeterKg(diameter, material.densityKgM3) * lengthM
    $('#preview-rib-mass').textContent = `${format(mass, 3)} кг`
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
  if (scenarioAnswer.hidden === false && globalThis.__mastLastUsageResult) {
    renderScenarioResult(globalThis.__mastLastUsageResult)
  }
}

function publishDesignWorkspace(result) {
  if (!designWorkspaceButton) return
  try {
    const saved = saveDesignResult(result)
    designWorkspaceButton.disabled = false
    designWorkspaceButton.title = `Открыть подробную 3D-модель, OBJ и КД; пакет ${(saved.bytes / 1024).toFixed(0)} КиБ`
    if (designWorkspaceNote) designWorkspaceNote.textContent = 'Расчётный проект отделён от КД. Последняя рассчитанная конструкция сохранена для модуля «3D и КД»; там доступны просмотр, OBJ, пакет JSON и отдельный комплект ЕСКД.'
  } catch (error) {
    designWorkspaceButton.disabled = true
    designWorkspaceButton.title = error instanceof Error ? error.message : String(error)
    if (designWorkspaceNote) designWorkspaceNote.textContent = `Не удалось передать конструкцию в модуль 3D/КД: ${designWorkspaceButton.title}`
  }
}

export function initializeUsageExperience() {
  installDesignWorkspaceUi()
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

export function enrichAndRenderUsageResult(result) {
  if (!result) return result
  try {
    result.assemblyMass = calculateAssemblyMass(result)
    renderAssemblyMass(result)
  } catch (error) {
    $('#assembly-mass-explanation').textContent = `Не удалось оценить сборочную массу: ${error instanceof Error ? error.message : String(error)}`
  }
  publishDesignWorkspace(result)
  globalThis.__mastLastUsageResult = result
  renderScenarioResult(result)
  queueMicrotask(() => renderIssue36DetailedResult(result))
  return result
}
