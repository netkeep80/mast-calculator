import {
  calculateAssemblyMass,
  reinforcementMassPerMeterKg,
} from './engine/assembly-mass.js'
import {
  getReinforcementClass,
  theoreticalCutLengthMm,
} from './engine/catalog.js'
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

const SCENARIOS = Object.freeze({
  check: {
    label: 'Проверить мачту',
    description: 'Проверяется выбранная конструкция при заданной погоде и оборудовании.',
  },
  design: {
    label: 'Подобрать конструкцию',
    description: 'Главная операция — подбор минимального проходящего диаметра арматуры и согласованного узла.',
  },
  limits: {
    label: 'Рассчитать пределы',
    description: 'В фокусе максимальная высота, боковая сила и масса на вершине.',
  },
  verify: {
    label: 'Рассчитать и проверить',
    description: 'В фокусе цепочка алгоритма, внутренние cross-checks и возможность ручной перепроверки.',
  },
})

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)
  : '—'

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
  scenarioText.textContent = `Для автоматического поиска минимального проходящего варианта используйте кнопку «Подобрать конструкцию». После подбора здесь показывается уже фактически рассчитанный комплект, а не исходные значения формы.`
  scenarioMetrics.replaceChildren(
    metricCard('Арматура', `Ø${format(result.parameters.barDiameterMm, 0)} ${result.parameters.reinforcementClass}`, `ребро ${format(result.parameters.ribCutLengthMm, 1)} мм`),
    metricCard('Болт', bolt ? `M${bolt.diameterMm}×${format(bolt.lengthMm, 0)} ${result.parameters.jointBoltClass}` : '—', bottom ? `проходная гайка M${bottom.threadDiameterMm}` : ''),
    metricCard('Высота текущей мачты', `${format(result.parameters.moduleCount * result.parameters.moduleHeightMm / 1000, 2)} м`, `${result.parameters.moduleCount} модулей`),
    metricCard('Запас текущего ребра', `${format(1 / Math.max(result.envelope.maxUtilization, Number.EPSILON), 2)}×`, `U=${format(result.envelope.maxUtilization, 3)}`),
  )
}

function renderLimitsScenario(result) {
  const lateral = result.lateralCapacity
  const payload = result.staticPayloadCapacity
  const height = result.heightCapacity
  scenarioTitle.textContent = 'Пределы выбранного типа мачты'
  scenarioStatus.textContent = 'ПРЕДЕЛЫ РАССЧИТАНЫ'
  scenarioStatus.className = 'answer-status answer-info'
  scenarioText.textContent = 'Это специальные предельные сценарии. Они отвечают не на вопрос «пройдёт ли текущая эксплуатация», а на вопрос «что наступит первым при увеличении высоты или нагрузки». '
  scenarioMetrics.replaceChildren(
    metricCard('Проектная высота', `${height.design.bounded ? '' : '≥ '}${format(height.design.maximumHeightM, 2)} м`, `${height.design.maximumModules} модулей`),
    metricCard('Боковая сила', `${format(lateral.criticalForceKgf, 1)} кгс`, `механизм: ${lateral.governingMode}`),
    metricCard('Масса на вершине', `${format(payload.maximumTotalTopMassKg, 1)} кг`, `дополнительно ${format(payload.remainingAdditionalMassKg, 1)} кг`),
    metricCard('Вода', `${format(payload.equivalentWaterVolumeM3, 3)} м³`, `${format(payload.equivalentWaterVolumeLiters, 0)} л`),
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
  scenarioText.textContent = `Зелёная внутренняя проверка означает согласованность принятой математической модели, но не внешнюю сертификацию реальной мачты. Независимый сторонний FEM, инженерная рецензия и натурные испытания остаются отдельными уровнями.`
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

export function enrichAndRenderUsageResult(result) {
  if (!result) return result
  try {
    result.assemblyMass = calculateAssemblyMass(result)
    renderAssemblyMass(result)
  } catch (error) {
    $('#assembly-mass-explanation').textContent = `Не удалось оценить сборочную массу: ${error instanceof Error ? error.message : String(error)}`
  }
  globalThis.__mastLastUsageResult = result
  renderScenarioResult(result)
  return result
}
