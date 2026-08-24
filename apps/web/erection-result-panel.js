import { subscribeCalculationResult } from './result-channel.js'

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  : '—'

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('link[data-erection-result-styles]')) return
  const stylesheet = document.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = './erection-result-panel.css'
  stylesheet.dataset.erectionResultStyles = 'true'
  document.head.append(stylesheet)
}

function cell(value) {
  const td = document.createElement('td')
  td.textContent = String(value)
  return td
}

function governingText(item, scale = 1, unit = '') {
  if (!item || !Number.isFinite(item.value)) return '—'
  return `${format(item.value * scale, 2)}${unit} @ ${format(item.angleDeg, 2)}°`
}

function ensurePanel() {
  if (typeof document === 'undefined') return null
  let panel = document.querySelector('#erection-result-panel')
  if (panel) return panel
  const summaryPane = document.querySelector('.workspace-summary-pane')
  if (!summaryPane) return null
  ensureStyles()
  panel = document.createElement('section')
  panel.id = 'erection-result-panel'
  panel.className = 'erection-result-panel'
  panel.hidden = true
  panel.innerHTML = `
    <div class="erection-result-heading">
      <div><span class="erection-result-eyebrow">МОНТАЖНАЯ СТАДИЯ</span><h3>Подъём вокруг опоры</h3></div>
      <strong id="erection-result-status" class="erection-result-status">—</strong>
    </div>
    <div class="erection-result-metrics">
      <article><span>Тяга троса</span><strong id="erection-max-tension">—</strong><small>максимум и угол</small></article>
      <article><span>Перемещение</span><strong id="erection-max-displacement">—</strong><small>максимум и угол</small></article>
      <article><span>Состояния</span><strong id="erection-sample-count">—</strong><small>feasible / infeasible</small></article>
      <article><span>Шаг</span><strong id="erection-min-step">—</strong><small>мин. разрешённый угол</small></article>
    </div>
    <p id="erection-result-summary" class="erection-result-summary"></p>
    <details class="erection-result-details" open>
      <summary>Реакции шарнира и границы допустимости</summary>
      <div class="table-wrap"><table><thead><tr><th>Узел</th><th>Fmax</th><th>Mmax</th></tr></thead><tbody id="erection-hinge-body"></tbody></table></div>
      <ul id="erection-transition-list" class="erection-result-list"></ul>
    </details>
    <details class="erection-result-details">
      <summary>Огибающая усилий стержней N/V/T/M</summary>
      <div class="table-wrap"><table><thead><tr><th>Стержень</th><th>|N|max</th><th>Vmax</th><th>|T|max</th><th>Mmax</th></tr></thead><tbody id="erection-member-body"></tbody></table></div>
    </details>`
  const guyPanel = summaryPane.querySelector('#guy-result-panel')
  const scenario = summaryPane.querySelector('#scenario-answer')
  if (guyPanel?.nextSibling) summaryPane.insertBefore(panel, guyPanel.nextSibling)
  else if (scenario) summaryPane.insertBefore(panel, scenario)
  else summaryPane.append(panel)
  return panel
}

function renderErectionResult(stage) {
  const panel = ensurePanel()
  if (!panel) return
  if (!stage?.envelope) {
    panel.hidden = true
    return
  }

  panel.hidden = false
  const envelope = stage.envelope
  const diagnostics = envelope.diagnostics
  const status = panel.querySelector('#erection-result-status')
  status.textContent = diagnostics.converged ? 'СХОДИМОСТЬ OK' : `НЕ СХОДИТСЯ: ${diagnostics.reason}`
  status.className = `erection-result-status ${diagnostics.converged ? 'pass' : 'pending'}`

  panel.querySelector('#erection-max-tension').textContent = governingText(envelope.maximumCableTensionN, 0.001, ' кН')
  panel.querySelector('#erection-max-displacement').textContent = governingText(envelope.maximumDisplacementM, 1000, ' мм')
  panel.querySelector('#erection-sample-count').textContent = `${envelope.feasibleSampleCount} / ${envelope.infeasibleSampleCount}`
  panel.querySelector('#erection-min-step').textContent = `${format(diagnostics.minimumResolvedAngleStepDeg, 3)}°`
  panel.querySelector('#erection-result-summary').textContent = `Проверено ${diagnostics.evaluationCount} уникальных углов в диапазоне ${format(envelope.startAngleDeg, 1)}…${format(envelope.endAngleDeg, 1)}°. Показаны физические demand-огибающие. Нормативный критерий допустимости монтажа и единый scalar utilization пока не утверждены, поэтому эта панель намеренно не объявляет ERECTION PASS/FAIL.`

  panel.querySelector('#erection-hinge-body').replaceChildren(...envelope.hingeReactions.map((item) => {
    const row = document.createElement('tr')
    row.append(
      cell(item.nodeId),
      cell(governingText(item.forceN, 0.001, ' кН')),
      cell(governingText(item.momentNm, 0.001, ' кН·м')),
    )
    return row
  }))

  const transitions = envelope.feasibilityTransitions ?? []
  panel.querySelector('#erection-transition-list').replaceChildren(...(
    transitions.length
      ? transitions.map((item) => {
          const li = document.createElement('li')
          li.textContent = `${format(item.leftAngleDeg, 3)}…${format(item.rightAngleDeg, 3)}°: ${item.leftStatus} → ${item.rightStatus}`
          return li
        })
      : [(() => {
          const li = document.createElement('li')
          li.textContent = 'Переходов между feasible/infeasible состояниями в вычисленной сетке нет.'
          return li
        })()]
  ))

  panel.querySelector('#erection-member-body').replaceChildren(...envelope.memberActions.map((item) => {
    const row = document.createElement('tr')
    row.append(
      cell(item.memberId),
      cell(governingText(item.axialN, 0.001, ' кН')),
      cell(governingText(item.shearN, 0.001, ' кН')),
      cell(governingText(item.torsionNm, 0.001, ' кН·м')),
      cell(governingText(item.bendingNm, 0.001, ' кН·м')),
    )
    return row
  }))
}

subscribeCalculationResult((snapshot) => {
  if (typeof document === 'undefined') return
  renderErectionResult(snapshot.erectionResult)
}, { replay: true })
