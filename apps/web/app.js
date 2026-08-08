import { getBoltSize } from '../../packages/domain/index.js'
import {
  buildMaterialSummary,
  buildMemberEnvelope,
  createCalculationCsv,
  createCalculationProjectHtml,
} from '../../packages/reporting/index.js'
import { createCalculationController } from './calculation-controller.js'
import { createMainProjectFormController } from './main-project-form.js'
import { ModuleViewer } from './module-viewer.js'
import { MastViewer } from './viewer.js'
import { createWebApplicationState } from './web-state.js'

const $ = (selector) => document.querySelector(selector)
const form = $('#parameters-form')
const calculateButton = $('#calculate-button')
const optimizeButton = $('#optimize-button')
const exportNoteButton = $('#export-note-button')
const exportCsvButton = $('#export-csv-button')
const cancelCalculationButton = $('#cancel-calculation-button')
const errorBox = $('#error')
const resultsSection = $('#results')
const warningsList = $('#warnings')
const optimizationBox = $('#optimization-result')
const showBucklingMode = $('#show-buckling-mode')
const moduleSelector = $('#module-selector')
const memberGroupMode = $('#member-group-mode')
const memberSortField = $('#member-sort-field')
const memberSortDirection = $('#member-sort-direction')
const memberResultsBody = $('#member-results-body')
const materialSummaryBox = $('#material-summary')
const materialInfoBox = $('#material-info')
const boltRecommendationsBody = $('#bolt-recommendations-body')
const weldResultsBody = $('#weld-results-body')
const weldRecommendationBox = $('#weld-recommendation')
const connectionSummaryBox = $('#connection-summary')
const connectionSummaryCard = $('#connection-summary-card')
const verificationSummaryBox = $('#verification-summary')
const verificationSummaryCard = $('#verification-summary-card')
const verificationLevelsBox = $('#verification-levels')
const verificationChecksBox = $('#verification-checks')
const moduleInterfaceBody = $('#module-interface-body')
const moduleMemberBody = $('#module-member-body')
const moduleDetailSummary = $('#module-detail-summary')
const moduleDetailTitle = $('#module-detail-title')
const progressPanel = $('#calculation-progress')
const progressBar = $('#progress-bar')
const progressStage = $('#progress-stage')
const progressPercent = $('#progress-percent')
const progressDetail = $('#progress-detail')
const progressElapsed = $('#progress-elapsed')
const progressEta = $('#progress-eta')

const state = createWebApplicationState()
let progressTimer = null
let buildInfo = {
  repository: 'netkeep80/mast-calculator', ref: 'local', sha: 'development', runId: 'local',
}

const moduleViewer = new ModuleViewer($('#module-canvas'))
const mastViewer = new MastViewer($('#mast-canvas'), {
  onModuleSelect: (moduleIndex) => selectModule(moduleIndex),
})
const projectForm = createMainProjectFormController(form, { materialInfoBox })

fetch('./build-info.json', { cache: 'no-store' })
  .then((response) => response.ok ? response.json() : null)
  .then((value) => { if (value) buildInfo = { ...buildInfo, ...value } })
  .catch(() => {})

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  : '∞'
const formatFactor = (value) => Number.isFinite(value) ? format(value, 3) : '∞'
const formatForce = (value, digits = 1) => Number.isFinite(value) ? format(value, digits) : '∞'
const angle = (value) => Number.isFinite(value) ? `${format(value, 0)}°` : '—'
const norm3 = (value) => Math.hypot(...(value ?? [0, 0, 0]))

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} с`
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function exportFilename(extension) {
  const parameters = state.snapshot.result?.parameters
  const modules = parameters?.moduleCount ?? 'mast'
  const cutLength = parameters?.ribCutLengthMm ? Math.round(parameters.ribCutLengthMm) : ''
  return `mast-project-${modules}x-${cutLength}mm.${extension}`
}

function limitModeLabel(mode) {
  if (mode === 'global-buckling') return 'общая потеря устойчивости'
  if (mode === 'local-member-buckling') return 'потеря устойчивости ребра'
  if (mode === 'tensile-rupture') return 'растягивающий разрыв ребра'
  if (mode === 'material-strength') return 'прочность материала'
  if (mode === 'bolt-connection') return 'межмодульный болт'
  if (mode === 'serviceability-displacement') return 'предельный прогиб'
  if (mode === 'self-weight-overlimit') return 'собственный вес уже превышает предел'
  return 'не определён'
}

function verificationStatusLabel(status) {
  if (status === 'pass') return 'пройдено'
  if (status === 'fail') return 'ошибка'
  return 'не проверено'
}

function memberSortValue(member, field) {
  const value = member[field]
  if (field === 'axialForceN') return Math.abs(value ?? 0)
  return Number(value) || 0
}

function memberComparator(left, right) {
  const field = memberSortField.value
  const direction = memberSortDirection.value === 'asc' ? 1 : -1
  const delta = memberSortValue(left, field) - memberSortValue(right, field)
  if (Math.abs(delta) > Number.EPSILON) return direction * delta
  return left.memberId - right.memberId
}

function createMemberRow(member) {
  const row = document.createElement('tr')
  if (member.utilization > 1) row.classList.add('danger-row')
  const values = [
    member.moduleNumber ?? '—', member.memberId, member.familyName,
    `${member.nodeA}–${member.nodeB}`, format(member.lengthM * 1000, 1),
    format(member.axialForceN / 1000, 3), format(member.maxShearN / 1000, 3),
    format(member.maxBendingNm, 2), format(member.equivalentStressPa / 1e6, 2),
    angle(member.windDirectionDeg), format(member.utilization, 4),
  ]
  row.replaceChildren(...values.map((value) => {
    const cell = document.createElement('td')
    cell.textContent = value
    return cell
  }))
  return row
}

function renderMemberReport(result) {
  const members = buildMemberEnvelope(result)
  const rows = []
  if (memberGroupMode.value === 'module') {
    const groups = new Map()
    for (const member of members) {
      const number = member.moduleNumber ?? 0
      if (!groups.has(number)) groups.set(number, [])
      groups.get(number).push(member)
    }
    for (const number of [...groups.keys()].sort((a, b) => a - b)) {
      const group = groups.get(number).sort(memberComparator)
      const header = document.createElement('tr')
      header.className = 'member-group-row'
      const cell = document.createElement('td')
      cell.colSpan = 11
      const maxU = Math.max(...group.map((member) => member.utilization))
      cell.textContent = `Модуль ${number} · 9 рёбер · максимальное использование ${format(maxU, 4)}`
      header.append(cell)
      rows.push(header, ...group.map(createMemberRow))
    }
  } else {
    rows.push(...members.sort(memberComparator).map(createMemberRow))
  }
  memberResultsBody.replaceChildren(...rows)

  const material = buildMaterialSummary(result)
  const groupDescription = material.groups.map((group) => (
    `${group.familyName.toLowerCase()} Ø${format(group.diameterMm, 0)} × ${format(group.lengthMm, 0)} мм — ${group.count} шт.`
  )).join('; ')
  materialSummaryBox.textContent = `Всего ${material.totalCount} рёбер = ${result.model.moduleCount}×9, ${format(material.totalLengthM, 2)} м и ${format(material.totalMassKg, 1)} кг стали. ${groupDescription}`
}

function actionRows(actions, side) {
  return actions.map((action) => {
    const row = document.createElement('tr')
    const values = [
      action.nodeId, side,
      format(action.forceN[0] / 1000, 3), format(action.forceN[1] / 1000, 3), format(action.forceN[2] / 1000, 3),
      format(action.momentNm[0], 2), format(action.momentNm[1], 2), format(action.momentNm[2], 2),
    ]
    row.replaceChildren(...values.map((value) => {
      const cell = document.createElement('td')
      cell.textContent = value
      return cell
    }))
    return row
  })
}

function renderSelectedModule() {
  const { result, selectedModuleIndex } = state.snapshot
  if (!result?.model?.modules?.length) return
  const module = result.model.modules[selectedModuleIndex]
  const loadCase = result.envelope.governing
  const moduleState = loadCase.analysis.moduleResults?.[selectedModuleIndex]
  if (!module || !moduleState) return

  moduleDetailTitle.textContent = `Подробно: модуль ${module.number} из ${result.model.moduleCount}`
  moduleViewer.setModule(selectedModuleIndex)
  mastViewer.setSelectedModule(selectedModuleIndex)
  moduleSelector.value = String(selectedModuleIndex)

  moduleInterfaceBody.replaceChildren(
    ...actionRows(moduleState.topAppliedFromAbove, 'сверху'),
    ...actionRows(moduleState.bottomReactionFromBelow, 'снизу'),
  )

  const memberRows = module.memberIds.map((memberId) => {
    const memberResult = loadCase.analysis.memberResults[memberId]
    const row = document.createElement('tr')
    if (memberResult.utilization > 1) row.classList.add('danger-row')
    const values = [
      memberId,
      result.model.members[memberId].role === 'top-ring' ? 'верхний треугольник' : 'ножка',
      format(memberResult.axialForceN / 1000, 3), format(memberResult.maxShearN / 1000, 3),
      format(memberResult.maxTorsionNm, 2), format(memberResult.maxBendingNm, 2), format(memberResult.utilization, 4),
    ]
    row.replaceChildren(...values.map((value) => {
      const cell = document.createElement('td')
      cell.textContent = value
      return cell
    }))
    return row
  })
  moduleMemberBody.replaceChildren(...memberRows)

  const topF = moduleState.topResultantFromAbove.forceN
  const bottomF = moduleState.bottomResultantFromBelow.forceN
  const topM = moduleState.topResultantFromAbove.momentNm
  moduleDetailSummary.textContent = `Определяющий эксплуатационный случай: ветер ${angle(loadCase.windDirectionDeg)}. От всего стека выше на верхнюю грань приходит |F|=${format(norm3(topF) / 1000, 3)} кН и |M|=${format(norm3(topM), 2)} Н·м; снизу модуль уравновешивается реакцией |F|=${format(norm3(bottomF) / 1000, 3)} кН. Критическое ребро #${moduleState.criticalMemberId}, U=${format(moduleState.maxUtilization, 4)}. Для вертикальной перегрузки этого модуля сравниваются потеря устойчивости ножки U=${format(moduleState.maxBucklingUtilization, 4)} и растягивающий разрыв U=${format(moduleState.maxRuptureUtilization, 4)}; раньше наступает ${limitModeLabel(moduleState.verticalFailureMode)}.`
}

function selectModule(moduleIndex) {
  if (!state.snapshot.result) return
  state.selectModule(moduleIndex)
  renderSelectedModule()
}

function populateModuleSelector(result) {
  moduleSelector.replaceChildren(...result.model.modules.map((module) => {
    const option = document.createElement('option')
    option.value = module.index
    option.textContent = `Модуль ${module.number}${module.index === 0 ? ' · нижний' : module.index === result.model.moduleCount - 1 ? ' · верхний' : ''}`
    return option
  }))
  const strengthCase = result.envelope.strength
  const criticalMember = result.model.members[strengthCase.analysis.criticalMemberId]
  state.selectModule(Number.isInteger(criticalMember?.moduleIndex)
    ? criticalMember.moduleIndex
    : state.snapshot.selectedModuleIndex)
}

function renderConnections(result) {
  const connections = result.connections
  const selected = connections?.bolt?.selected
  const weld = connections?.weld
  const boltMetric = $('#metric-bolt-utilization')
  const jointMetric = $('#metric-bolt-joint')
  const weldMetric = $('#metric-weld-length')

  connectionSummaryCard.classList.remove('connection-failed')
  if (!connections || !selected?.applicable) {
    boltMetric.textContent = 'нет межмодульных стыков'
    jointMetric.textContent = '—'
    weldMetric.textContent = weld?.critical ? `${format(weld.critical.check.requiredPhysicalLengthMm, 1)} мм` : '—'
    connectionSummaryBox.textContent = 'При одном модуле внутренних межмодульных болтов нет. Сварные концы рёбер проверяются отдельно.'
    boltRecommendationsBody.replaceChildren()
  } else {
    const demand = selected.governingDemand
    const check = selected.governingCheck
    const size = getBoltSize(result.parameters.jointBoltDiameterMm)
    boltMetric.textContent = format(selected.utilization, 3)
    jointMetric.textContent = `ур. ${demand.level}, узел ${demand.nodeId}`
    boltMetric.classList.toggle('danger', selected.utilization > 1)
    connectionSummaryCard.classList.toggle('connection-failed', !connections.passesConfiguredBolt)
    connectionSummaryBox.textContent = `Выбран M${size.diameterMm}×${size.pitchMm}, класс ${result.parameters.jointBoltClass}: определяющий узел ${demand.nodeId}, уровень ${demand.level}, ветер ${angle(demand.windDirectionDeg)}. Nt=${format(check.tensionN / 1000, 3)} кН, Ns=${format(check.shearN / 1000, 3)} кН, Ubolt=${format(check.interactionUtilization, 4)}.`

    boltRecommendationsBody.replaceChildren(...connections.bolt.recommendationsByClass.map((recommendation) => {
      const row = document.createElement('tr')
      const candidate = recommendation.recommended
      const governing = candidate?.evaluation?.governingDemand
      const values = [
        recommendation.boltClass,
        candidate ? `M${candidate.diameterMm}` : 'не найден',
        candidate ? `${candidate.pitchMm} мм` : '—',
        candidate ? format(candidate.evaluation.utilization, 4) : '—',
        governing ? `ур. ${governing.level}, узел ${governing.nodeId}` : '—',
        governing ? angle(governing.windDirectionDeg) : '—',
      ]
      if (!candidate) row.classList.add('danger-row')
      row.replaceChildren(...values.map((value) => {
        const cell = document.createElement('td')
        cell.textContent = value
        return cell
      }))
      return row
    }))
  }

  if (!weld?.critical) {
    weldMetric.textContent = '—'
    weldRecommendationBox.textContent = 'Нет данных сварной проверки.'
    weldResultsBody.replaceChildren()
    return
  }
  const critical = weld.critical
  weldMetric.textContent = `${format(critical.check.requiredPhysicalLengthMm, 1)} мм`
  const electrode = weld.electrodeRecommendation.recommended
  const wire = weld.wireRecommendation.recommended
  weldRecommendationBox.textContent = `Выбран ${critical.check.consumableLabel}, катет ${format(weld.configuredLegMm, 1)} мм. Критический конец: ребро ${critical.memberId}${critical.end}, узел ${critical.nodeId}, ветер ${angle(critical.windDirectionDeg)}; требуется ${format(critical.check.requiredPhysicalLengthMm, 1)} мм физической длины. Минимальный совместимый электрод: ${electrode?.label ?? 'не найден'}; проволока: ${wire?.label ?? 'не найдена'}.`
  weldResultsBody.replaceChildren(...weld.envelope.map((item) => {
    const row = document.createElement('tr')
    const values = [
      item.memberId, item.end, item.nodeId, angle(item.windDirectionDeg),
      format(item.axialForceN / 1000, 3), format(item.shearForceN / 1000, 3),
      format(item.torsionNm, 2), format(item.bendingNm, 2),
      format(item.check.requiredEffectiveLengthMm, 1), format(item.check.requiredPhysicalLengthMm, 1),
    ]
    row.replaceChildren(...values.map((value) => {
      const cell = document.createElement('td')
      cell.textContent = value
      return cell
    }))
    return row
  }))
}

function renderVerification(result) {
  const verification = result.verification
  if (!verification) return
  const metric = $('#metric-verification')
  metric.textContent = verification.counts.failed > 0
    ? `${verification.counts.failed} ошибок`
    : `${verification.counts.passed}/${verification.counts.total - verification.counts.notVerified} внутренних ✓`
  metric.classList.toggle('danger', verification.counts.failed > 0)
  verificationSummaryBox.textContent = `${verification.headline} Автоматически пройдено ${verification.counts.passed}, ошибок ${verification.counts.failed}; ${verification.counts.notVerified} пункта требуют независимого подтверждения.`
  verificationSummaryCard.classList.toggle('verification-failed', verification.counts.failed > 0)

  verificationLevelsBox.replaceChildren(...verification.levels.map((level) => {
    const card = document.createElement('article')
    card.className = `verification-level verification-${level.status}`
    const heading = document.createElement('strong')
    heading.textContent = `Уровень ${level.number}. ${level.title}`
    const status = document.createElement('span')
    status.className = 'verification-status'
    status.textContent = verificationStatusLabel(level.status)
    const description = document.createElement('p')
    description.textContent = level.description
    card.append(heading, status, description)
    return card
  }))

  verificationChecksBox.replaceChildren(...verification.checks.map((check) => {
    const details = document.createElement('details')
    details.className = `verification-check verification-${check.status}`
    if (check.status === 'fail') details.open = true
    const summary = document.createElement('summary')
    summary.textContent = `${check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '○'} ${check.title} — ${verificationStatusLabel(check.status)}`
    const explanation = document.createElement('p')
    explanation.textContent = check.explanation
    details.append(summary, explanation)
    if (check.formula) {
      const formula = document.createElement('code')
      formula.className = 'verification-formula'
      formula.textContent = check.formula
      details.append(formula)
    }
    if (check.substitution) {
      const substitution = document.createElement('p')
      substitution.textContent = `Подстановка: ${check.substitution}`
      details.append(substitution)
    }
    if (check.evidence) {
      const evidence = document.createElement('p')
      evidence.textContent = `Контроль: ${check.evidence}`
      details.append(evidence)
    }
    const manual = document.createElement('p')
    manual.className = 'verification-howto'
    manual.textContent = `Как проверить самому: ${check.howToCheck}`
    details.append(manual)
    return details
  }))
}

function heightBoundText(boundary) {
  if (!boundary) return 'нет данных'
  return boundary.bounded
    ? `${format(boundary.maximumHeightM, 2)} м`
    : `≥ ${format(boundary.maximumHeightM, 2)} м`
}

function renderHeightCapacity(result) {
  const capacity = result.heightCapacity
  if (!capacity) return
  $('#metric-height-design').textContent = heightBoundText(capacity.design)
  $('#metric-height-modules').textContent = capacity.design.bounded
    ? `${capacity.design.maximumModules}`
    : `≥ ${capacity.design.maximumModules}`
  $('#metric-height-ultimate').textContent = heightBoundText(capacity.ultimateResistance)
  const bottom = capacity.bottomModuleAtFirstDesignOverload ?? capacity.bottomModuleAtDesignLimit
  $('#metric-bottom-failure').textContent = bottom ? limitModeLabel(bottom.mode) : '—'

  const firstFail = capacity.design.firstFailCase
  const designMechanism = firstFail?.designMode ?? capacity.design.limitCase?.designMode ?? 'не определён'
  const ultimateMechanism = capacity.ultimateResistance.firstFailCase?.ultimateMode
    ?? capacity.ultimateResistance.limitCase?.ultimateMode
    ?? 'не определён'
  const bottomText = bottom
    ? `Нижний модуль: ${bottom.explanation} Определяющее ребро #${bottom.memberId}, ветер ${angle(bottom.windDirectionDeg)}, Uуст=${format(bottom.maxBucklingUtilization, 4)}, Uразрыв=${format(bottom.maxRuptureUtilization, 4)}.`
    : 'Для нижнего модуля нет отдельного вертикального определяющего случая.'
  $('#height-capacity-description').textContent = `Для выбранного типа одинаковых модулей выполнен дискретный поиск до ${capacity.searchLimitModules} модулей. Проектный предел (${capacity.design.criteria}) — ${heightBoundText(capacity.design)}, ${capacity.design.maximumModules} модулей; следующий критерий — ${limitModeLabel(designMechanism)}. Отдельный предел по сопротивлению без ограничения эксплуатационного прогиба (${capacity.ultimateResistance.criteria}) — ${heightBoundText(capacity.ultimateResistance)}; механизм — ${limitModeLabel(ultimateMechanism)}. ${bottomText}`
}

function renderResult(result) {
  const parameters = result.parameters
  const lateral = result.lateralCapacity
  const staticPayload = result.staticPayloadCapacity
  exportNoteButton.disabled = false
  exportCsvButton.disabled = false
  mastViewer.setResult(result)
  moduleViewer.setResult(result)
  populateModuleSelector(result)
  resultsSection.hidden = false

  const strengthCase = result.envelope.strength
  const displacementCase = result.envelope.displacement
  const bucklingCase = result.envelope.buckling
  const critical = strengthCase.analysis.memberResults[strengthCase.analysis.criticalMemberId]
  const criticalModelMember = result.model.members[strengthCase.analysis.criticalMemberId]
  const topDisplacementMm = result.envelope.maxTopDisplacementM * 1000
  const bucklingFactor = result.envelope.minimumBucklingFactor

  $('#metric-height').textContent = `${format(parameters.moduleCount * parameters.moduleHeightMm / 1000)} м`
  $('#metric-mass').textContent = `${format(result.analysis.totalMassKg, 1)} кг`
  $('#metric-displacement').textContent = `${format(topDisplacementMm, 2)} мм`
  $('#metric-utilization').textContent = format(result.envelope.maxUtilization, 3)
  $('#metric-buckling').textContent = formatFactor(bucklingFactor)
  $('#metric-wind-direction').textContent = angle(result.envelope.governing.windDirectionDeg)
  $('#metric-critical').textContent = `мод. ${(criticalModelMember?.moduleIndex ?? 0) + 1}, № ${strengthCase.analysis.criticalMemberId}`
  $('#metric-residual').textContent = result.analysis.diagnostics.maximumNodeEquilibriumResidual.toExponential(2)
  $('#metric-lateral-capacity').textContent = `${formatForce(lateral.criticalForceKgf, 1)} кгс`
  $('#metric-lateral-buckling').textContent = `${formatForce(lateral.globalBucklingForceKgf, 1)} кгс`
  $('#metric-lateral-bolt').textContent = `${formatForce(lateral.boltLimitForceKgf, 1)} кгс`
  $('#metric-lateral-mode').textContent = limitModeLabel(lateral.governingMode)
  $('#metric-static-payload').textContent = `${formatForce(staticPayload.maximumTotalTopMassKg, 1)} кг`
  $('#metric-static-reserve').textContent = `${formatForce(staticPayload.remainingAdditionalMassKg, 1)} кг`
  $('#metric-water-volume').textContent = `${formatForce(staticPayload.equivalentWaterVolumeM3, 3)} м³ (${formatForce(staticPayload.equivalentWaterVolumeLiters, 0)} л)`
  $('#metric-static-mode').textContent = limitModeLabel(staticPayload.governingMode)

  $('#metric-displacement').classList.toggle('danger', topDisplacementMm > parameters.displacementLimitMm)
  $('#metric-utilization').classList.toggle('danger', result.envelope.maxUtilization > 1)
  $('#metric-buckling').classList.toggle('danger', bucklingFactor < parameters.minimumBucklingFactor)
  $('#metric-static-reserve').classList.toggle('danger', staticPayload.remainingAdditionalMassKg <= 0)

  $('#critical-description').textContent = critical
    ? `Ребро №${critical.memberId} модуля ${(criticalModelMember?.moduleIndex ?? 0) + 1}: N=${format(critical.axialForceN / 1000, 3)} кН, Vmax=${format(critical.maxShearN / 1000, 3)} кН, Mmax=${format(critical.maxBendingNm, 2)} Н·м, σэкв=${format(critical.equivalentStressPa / 1e6, 2)} МПа, U=${format(critical.utilization, 4)} при ветре ${angle(strengthCase.windDirectionDeg)}. Максимальный прогиб при ${angle(displacementCase.windDirectionDeg)}, минимальный λcr при ${angle(bucklingCase.windDirectionDeg)}.`
    : 'Критическое ребро не определено.'

  $('#lateral-capacity-description').textContent = `Чистая горизонтальная сила прикладывается к верхней грани. Худшее направление ${angle(lateral.directionDeg)}: первый предел ${formatForce(lateral.criticalForceKgf, 1)} кгс; механизм — ${limitModeLabel(lateral.governingMode)}. По ребру ${formatForce(lateral.memberLimitForceKgf, 1)} кгс, global buckling ${formatForce(lateral.globalBucklingForceKgf, 1)} кгс, болт ${formatForce(lateral.boltLimitForceKgf, 1)} кгс.`
  $('#static-payload-description').textContent = `Gravity-only расчёт: максимальная суммарная масса на вершине ${formatForce(staticPayload.maximumTotalTopMassKg, 1)} кг; после уже заданной вертикальной нагрузки остаётся ${formatForce(staticPayload.remainingAdditionalMassKg, 1)} кг ≈ ${formatForce(staticPayload.equivalentWaterVolumeM3, 3)} м³ воды. Механизм — ${limitModeLabel(staticPayload.governingMode)}; Uребра=${format(staticPayload.utilizationAtLimit, 4)}, Uболта=${format(staticPayload.boltUtilizationAtLimit, 4)}, λcr=${formatFactor(staticPayload.bucklingFactorAtLimit)}.`

  const performance = result.performance
  const modular = result.analysis.modular
  const performanceText = performance
    ? ` Global solver: ${performance.linearSystemSolver}, ${performance.freeDofCount} свободных DOF, полуширина ${performance.stiffnessBandwidth}, K факторизована ${performance.stiffnessFactorizationCount} раз. Modular solver: ${performance.modularStaticSolver}, ${performance.modularInterfaceFactorizationCount} интерфейсных факторизаций; расхождение с global=${modular?.relativeDisplacementDifference?.toExponential(2) ?? '—'}, interface residual=${modular?.interfaceEquilibriumResidual?.toExponential(2) ?? '—'}; height evaluations=${performance.heightSearchEvaluationCount}.`
    : ''
  $('#load-summary').textContent = `Погода: ${parameters.windPresetLabel}; v=${format(parameters.windSpeedMs, 1)} м/с; q=${format(parameters.windPressurePa, 1)} Па. Вес стали ${format(result.loads.selfWeightN / 1000)} кН; лёд ${format(result.loads.iceWeightN / 1000)} кН; ветер на рёбра ${format(result.loads.memberWindN / 1000)} кН.${performanceText}`

  warningsList.replaceChildren(...result.warnings.map((warning) => {
    const item = document.createElement('li')
    item.textContent = warning
    return item
  }))
  renderHeightCapacity(result)
  renderConnections(result)
  renderVerification(result)
  renderMemberReport(result)
  renderSelectedModule()
}

function updateProgressClock() {
  const activeJob = state.snapshot.activeJob
  if (!activeJob) return
  const elapsed = performance.now() - activeJob.startedAt
  const fraction = state.snapshot.progress?.fraction ?? 0
  progressElapsed.textContent = `Прошло: ${formatDuration(elapsed)}`
  if (fraction >= 0.03 && elapsed >= 300) {
    const eta = elapsed * (1 - fraction) / Math.max(fraction, 1e-6)
    progressEta.textContent = `Осталось: ≈ ${formatDuration(eta)}`
  } else progressEta.textContent = 'Осталось: оценивается…'
}

function showProgress(label) {
  progressPanel.hidden = false
  progressBar.value = 0
  progressStage.textContent = 'Вычисление'
  progressPercent.textContent = '0%'
  progressDetail.textContent = label
  progressElapsed.textContent = 'Прошло: 0 с'
  progressEta.textContent = 'Осталось: оценивается…'
  clearInterval(progressTimer)
  progressTimer = setInterval(updateProgressClock, 500)
}

function renderProgress(progress) {
  const fraction = Math.min(1, Math.max(0, progress?.fraction ?? 0))
  const percent = Math.round(fraction * 100)
  progressBar.value = percent
  progressPercent.textContent = `${percent}%`
  if (progress.phase === 'optimize') progressStage.textContent = 'Подбор диаметра'
  else if (progress.phase === 'static-payload') progressStage.textContent = 'Статическая нагрузка вершины'
  else if (progress.phase === 'height-capacity') progressStage.textContent = 'Поиск максимальной высоты'
  else if (progress.phase === 'lateral') progressStage.textContent = 'Боковая несущая способность'
  else if (progress.phase === 'wind') progressStage.textContent = 'Ветровая огибающая'
  else progressStage.textContent = 'Расчёт мачты'
  progressDetail.textContent = progress.label ?? 'Вычисление…'
  updateProgressClock()
}

function setBusy(busy) {
  calculateButton.disabled = busy
  optimizeButton.disabled = busy
  cancelCalculationButton.disabled = !busy
}

function finishProgress(label, success = true, startedAt = performance.now()) {
  clearInterval(progressTimer)
  progressTimer = null
  const elapsed = performance.now() - startedAt
  if (success) {
    progressBar.value = 100
    progressPercent.textContent = '100%'
  }
  progressStage.textContent = success ? 'Готово' : 'Остановлено'
  progressDetail.textContent = label
  progressElapsed.textContent = `Прошло: ${formatDuration(elapsed)}`
  progressEta.textContent = success ? 'Осталось: 0 с' : 'Осталось: —'
}

function renderOptimization(summary, result) {
  optimizationBox.hidden = false
  if (!summary?.recommendedDiameter) {
    optimizationBox.textContent = 'В диапазоне стандартных диаметров не найден вариант, проходящий по прочности, прогибу и общей устойчивости.'
    return
  }
  const diameter = summary.recommendedDiameter
  form.elements.namedItem('barDiameterMm').value = diameter
  const heightText = result?.heightCapacity?.design
    ? `, проектная высота ${heightBoundText(result.heightCapacity.design)}`
    : ''
  optimizationBox.textContent = `Минимальный найденный единый диаметр арматуры: ${diameter} мм. U=${format(result.envelope.maxUtilization, 3)}, прогиб ${format(result.envelope.maxTopDisplacementM * 1000, 2)} мм, λcr=${formatFactor(result.envelope.minimumBucklingFactor)}, боковой предел ${formatForce(result.lateralCapacity.criticalForceKgf, 1)} кгс${heightText}. Болт и сварка проверяются итоговым расчётом.`
}

const calculationController = createCalculationController({
  state,
  onStart: (job) => {
    errorBox.hidden = true
    optimizationBox.hidden = true
    setBusy(true)
    showProgress(job.action === 'optimize' ? 'Запуск подбора стандартного диаметра…' : 'Запуск расчёта…')
  },
  onProgress: (progress) => renderProgress(progress),
  onResult: (snapshot, job) => {
    if (snapshot.result) {
      renderResult(snapshot.result)
    } else {
      resultsSection.hidden = true
      exportNoteButton.disabled = true
      exportCsvButton.disabled = true
    }
    if (snapshot.optimization) renderOptimization(snapshot.optimization, snapshot.result)
    setBusy(false)
    finishProgress(snapshot.optimization
      ? 'Подбор, итоговый расчёт и поиск предельной высоты завершены.'
      : 'Расчёт, модульный cross-check, соединения и предельная высота завершены.', true, job?.startedAt)
  },
  onError: (message, job) => {
    setBusy(false)
    finishProgress('Расчёт завершён с ошибкой.', false, job?.startedAt)
    errorBox.textContent = message
    errorBox.hidden = false
  },
  onCancel: (job) => {
    setBusy(false)
    finishProgress('Расчёт отменён пользователем.', false, job?.startedAt)
  },
})

function runCalculation() {
  try {
    calculationController.start('calculate', projectForm.readProjectInput())
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  }
}

function runOptimization() {
  try {
    calculationController.start('optimize', projectForm.readProjectInput())
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
  }
}

calculateButton.addEventListener('click', runCalculation)
optimizeButton.addEventListener('click', runOptimization)
cancelCalculationButton.addEventListener('click', () => calculationController.cancel())
exportNoteButton.addEventListener('click', () => {
  const result = state.snapshot.result
  if (!result) return
  downloadText(
    exportFilename('html'),
    createCalculationProjectHtml(result, result.parameters, new Date().toISOString(), buildInfo),
    'text/html;charset=utf-8',
  )
})
exportCsvButton.addEventListener('click', () => {
  const result = state.snapshot.result
  if (!result) return
  downloadText(exportFilename('csv'), createCalculationCsv(result), 'text/csv;charset=utf-8')
})
showBucklingMode.addEventListener('change', () => mastViewer.setBucklingMode(showBucklingMode.checked))
moduleSelector.addEventListener('change', () => selectModule(Number(moduleSelector.value)))
memberGroupMode.addEventListener('change', () => { if (state.snapshot.result) renderMemberReport(state.snapshot.result) })
memberSortField.addEventListener('change', () => { if (state.snapshot.result) renderMemberReport(state.snapshot.result) })
memberSortDirection.addEventListener('change', () => { if (state.snapshot.result) renderMemberReport(state.snapshot.result) })
form.addEventListener('submit', (event) => {
  event.preventDefault()
  runCalculation()
})

setBusy(false)
runCalculation()
