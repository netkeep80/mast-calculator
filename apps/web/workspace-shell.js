const $ = (selector, root = document) => root.querySelector(selector)

const VIEW_LABELS = Object.freeze({
  check: 'Проверка',
  design: 'Подбор',
  limits: 'Пределы',
  verify: 'Верификация',
})

function makeElement(tag, className, text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function makePaneHeading(title, subtitle = '') {
  const heading = makeElement('div', 'workspace-pane-heading')
  const titleElement = makeElement('h2', '', title)
  heading.append(titleElement)
  if (subtitle) heading.append(makeElement('p', 'workspace-pane-subtitle', subtitle))
  return heading
}

function compactScenarioSwitch(scenarioGrid) {
  if (!scenarioGrid) return null
  scenarioGrid.className = 'view-switch'
  scenarioGrid.setAttribute('aria-label', 'Представление результата')
  for (const card of scenarioGrid.querySelectorAll('.scenario-card')) {
    const radio = card.querySelector('input[name="usageScenario"]')
    const title = card.querySelector('.scenario-card-title')
    if (radio && title && VIEW_LABELS[radio.value]) title.textContent = VIEW_LABELS[radio.value]
  }
  return scenarioGrid
}

function createAppBar(legacyHeader, scenarioGrid, primaryActions) {
  const appBar = makeElement('header', 'app-bar')
  appBar.dataset.webUi = '2.0'

  const brand = makeElement('div', 'app-brand')
  const logo = $('.brand-logo', legacyHeader)
  if (logo) {
    logo.className = 'app-logo'
    brand.append(logo)
  }
  const identity = makeElement('div', 'app-identity')
  identity.append(
    makeElement('strong', 'app-title', 'Калькулятор мачты'),
    makeElement('span', 'app-version', 'версия определяется сборкой'),
  )
  const runtimeSlot = makeElement('div', 'runtime-info-slot')
  runtimeSlot.id = 'runtime-info-slot'
  identity.append(runtimeSlot)
  brand.append(identity)

  const projectActions = makeElement('div', 'project-file-actions')
  projectActions.id = 'project-file-actions'
  projectActions.setAttribute('aria-label', 'Файл проекта')

  const viewGroup = makeElement('div', 'app-view-group')
  viewGroup.append(makeElement('span', 'app-toolbar-label', 'Результат'))
  if (compactScenarioSwitch(scenarioGrid)) viewGroup.append(scenarioGrid)

  if (primaryActions) {
    primaryActions.className = 'app-primary-actions'
    primaryActions.setAttribute('aria-label', 'Расчёт')
  }

  const toolbar = makeElement('div', 'app-toolbar')
  toolbar.append(projectActions, viewGroup)
  if (primaryActions) toolbar.append(primaryActions)

  appBar.append(brand, toolbar)
  return appBar
}

function createProjectPane(parameters) {
  const pane = makeElement('aside', 'workspace-pane workspace-project-pane')
  pane.setAttribute('aria-label', 'Исходные данные проекта')
  pane.append(makePaneHeading('Проект', 'Геометрия, материал, нагрузки и соединение'))

  const quickLinks = makeElement('nav', 'project-quick-links')
  const guys = makeElement('a', 'workspace-link', 'Растяжки')
  guys.href = './guys.html'
  guys.title = 'До интеграции в единый project editor открывается существующее представление растяжек'
  const docs = makeElement('a', 'workspace-link', '3D и КД')
  docs.href = './design.html'
  docs.title = 'Открывает последний рассчитанный design package'
  quickLinks.append(guys, docs)
  pane.append(quickLinks)

  parameters.classList.add('workspace-project-card')
  pane.append(parameters)
  return pane
}

function createViewPane(visual) {
  const pane = makeElement('section', 'workspace-pane workspace-view-pane')
  pane.setAttribute('aria-label', 'Трёхмерная модель')
  visual.classList.add('workspace-visual-card')
  pane.append(visual)
  return pane
}

function createSummaryPane(scenarioAnswer) {
  const pane = makeElement('aside', 'workspace-pane workspace-summary-pane')
  pane.setAttribute('aria-label', 'Инженерный результат')
  pane.append(makePaneHeading('Инженерный результат', 'Главные критерии и определяющее состояние'))

  const placeholder = makeElement('div', 'result-placeholder')
  placeholder.id = 'result-placeholder'
  const state = makeElement('span', 'result-placeholder-status', 'НЕ РАССЧИТАНО')
  placeholder.append(
    state,
    makeElement('h3', '', 'Введите параметры и запустите расчёт'),
    makeElement('p', '', 'После расчёта здесь появятся PASS/FAIL, определяющий критерий, использование ребра и соединения, прогиб и λcr.'),
  )
  const scope = makeElement('p', 'model-scope-note', 'Текущая эксплуатационная модель не включает нормативную динамику ветра и монтажный подъём мачты; эти проверки развиваются отдельными физическими этапами.')
  placeholder.append(scope)

  scenarioAnswer.classList.add('workspace-summary-card')
  pane.append(placeholder, scenarioAnswer)

  const syncPlaceholder = () => {
    placeholder.hidden = !scenarioAnswer.hidden
  }
  syncPlaceholder()
  new MutationObserver(syncPlaceholder).observe(scenarioAnswer, { attributes: true, attributeFilter: ['hidden'] })
  return pane
}

function createDetailsArea(nodes) {
  const area = makeElement('section', 'workspace-details')
  area.setAttribute('aria-label', 'Подробные результаты')
  for (const node of nodes) {
    if (!node) continue
    node.classList.add('workspace-detail-card')
    area.append(node)
  }
  return area
}

function installWorkspaceShell() {
  if (document.body.dataset.webUi === '2.0') return

  const legacyHeader = $('.page-header')
  const legacyMain = $('main.layout')
  const scenarioPanel = $('.scenario-panel')
  const scenarioGrid = $('#usage-scenarios', scenarioPanel ?? document)
  const parameters = $('.parameters')
  const visual = $('.visual')
  const scenarioAnswer = $('#scenario-answer')
  const results = $('#results')
  const jointVisual = $('.joint-visual')
  const moduleVisual = $('.module-visual')
  const referencePanel = $('.reference-panel')
  const primaryActions = $('.scenario-actions')

  if (!legacyHeader || !legacyMain || !parameters || !visual || !scenarioAnswer) return

  const stylesheet = document.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = './workspace.css'
  stylesheet.dataset.webUiStyles = '2.0'
  document.head.append(stylesheet)

  const appBar = createAppBar(legacyHeader, scenarioGrid, primaryActions)
  const workspace = makeElement('main', 'workspace-layout')
  workspace.dataset.webUi = '2.0'
  workspace.append(
    createProjectPane(parameters),
    createViewPane(visual),
    createSummaryPane(scenarioAnswer),
    createDetailsArea([results, jointVisual, moduleVisual, referencePanel]),
  )

  document.body.insertBefore(appBar, legacyHeader)
  legacyMain.replaceWith(workspace)
  legacyHeader.remove()
  scenarioPanel?.remove()
  document.body.dataset.webUi = '2.0'
}

installWorkspaceShell()
