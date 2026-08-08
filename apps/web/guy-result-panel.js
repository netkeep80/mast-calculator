import { subscribeCalculationResult } from './result-channel.js'

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  : '—'

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('link[data-guy-result-styles]')) return
  const stylesheet = document.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = './guy-result-panel.css'
  stylesheet.dataset.guyResultStyles = 'true'
  document.head.append(stylesheet)
}

function cell(value) {
  const td = document.createElement('td')
  td.textContent = String(value)
  return td
}

function ensurePanel() {
  if (typeof document === 'undefined') return null
  let panel = document.querySelector('#guy-result-panel')
  if (panel) return panel
  const summaryPane = document.querySelector('.workspace-summary-pane')
  if (!summaryPane) return null
  ensureStyles()
  panel = document.createElement('section')
  panel.id = 'guy-result-panel'
  panel.className = 'guy-result-panel'
  panel.hidden = true
  panel.innerHTML = `
    <div class="guy-result-heading">
      <div><span class="guy-result-eyebrow">ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА РАСТЯЖЕК</span><h3>Нелинейная cable-envelope</h3></div>
      <strong id="guy-result-status" class="guy-result-status">—</strong>
    </div>
    <div class="guy-result-metrics">
      <article><span>Ребро</span><strong id="guy-member-u">—</strong><small>Umax guyed envelope</small></article>
      <article><span>Трос</span><strong id="guy-cable-u">—</strong><small>Umax</small></article>
      <article><span>Прогиб</span><strong id="guy-displacement">—</strong><small>вершина</small></article>
      <article><span>Устойчивость</span><strong id="guy-buckling">—</strong><small>λcr</small></article>
    </div>
    <p id="guy-result-summary" class="guy-result-summary"></p>
    <details class="guy-result-details">
      <summary>Тросы и огибающая</summary>
      <div class="table-wrap"><table><thead><tr><th>Ярус</th><th>№</th><th>L, м</th><th>Tmax, кН</th><th>Rd, кН</th><th>U</th><th>Провисал</th></tr></thead><tbody id="guy-cable-envelope-body"></tbody></table></div>
      <ul id="guy-result-warnings" class="guy-result-warnings"></ul>
    </details>`
  const scenario = summaryPane.querySelector('#scenario-answer')
  if (scenario) summaryPane.insertBefore(panel, scenario)
  else summaryPane.append(panel)
  return panel
}

function renderGuyResult(guyResult, bareResult) {
  const panel = ensurePanel()
  if (!panel) return
  if (!guyResult) {
    panel.hidden = true
    return
  }
  panel.hidden = false
  const status = panel.querySelector('#guy-result-status')
  status.textContent = guyResult.passes ? 'GUY PASS' : 'GUY FAIL'
  status.className = `guy-result-status ${guyResult.passes ? 'pass' : 'fail'}`
  panel.querySelector('#guy-member-u').textContent = format(guyResult.envelope.maxUtilization, 3)
  panel.querySelector('#guy-cable-u').textContent = format(guyResult.envelope.maximumCableUtilization, 3)
  panel.querySelector('#guy-displacement').textContent = `${format(guyResult.envelope.maxTopDisplacementM * 1000, 1)} мм`
  panel.querySelector('#guy-buckling').textContent = format(guyResult.envelope.minimumBucklingFactor, 2)
  const bareDisplacement = bareResult?.envelope?.maxTopDisplacementM
  const reduction = Number.isFinite(bareDisplacement) && bareDisplacement > 1e-12
    ? (1 - guyResult.envelope.maxTopDisplacementM / bareDisplacement) * 100
    : null
  panel.querySelector('#guy-result-summary').textContent = `${guyResult.cableSystem.cables.length} тросов, ${format(guyResult.cableSystem.totalCableLengthM, 1)} м суммарной длины${reduction == null ? '' : `; изменение прогиба относительно голой мачты ${format(reduction, 1)}%`}. Этот статус относится только к guyed member/cable/displacement/buckling envelope. Обычный CalculationResult отдельно продолжает проверять соединение и bare-frame специальные пределы.`
  panel.querySelector('#guy-cable-envelope-body').replaceChildren(...guyResult.cableEnvelope.map((cable) => {
    const row = document.createElement('tr')
    if (!cable.passes) row.classList.add('danger-row')
    row.append(
      cell(cable.tierNumber),
      cell(cable.cableNumber),
      cell(format(cable.initialLengthM, 2)),
      cell(format(cable.maximumTensionN / 1000, 2)),
      cell(format(cable.capacity.designWorkingLoadN / 1000, 2)),
      cell(format(cable.maximumUtilization, 3)),
      cell(cable.slackInEnvelope ? 'да' : 'нет'),
    )
    return row
  }))
  panel.querySelector('#guy-result-warnings').replaceChildren(...guyResult.warnings.map((warning) => {
    const item = document.createElement('li')
    item.textContent = warning
    return item
  }))
}

subscribeCalculationResult((snapshot) => {
  if (typeof document === 'undefined') return
  renderGuyResult(snapshot.guyResult, snapshot.result)
}, { replay: true })
