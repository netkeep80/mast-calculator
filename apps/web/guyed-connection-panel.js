const $ = (selector, root = document) => root.querySelector(selector)

const format = (value, digits = 2) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(value))
  : '—'

function make(tag, className = '', text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function metric(label, value, note = '') {
  const card = make('article')
  const caption = make('span', '', label)
  const strong = make('strong', '', value)
  const small = make('small', '', note)
  card.append(caption, strong, small)
  return card
}

function connectionPanel() {
  let panel = $('#guyed-connection-projection')
  if (panel) return panel
  const target = $('#result-panel-connections')
  if (!target) return null
  panel = make('section', 'critical-card connection-card')
  panel.id = 'guyed-connection-projection'
  panel.hidden = true
  target.prepend(panel)
  return panel
}

function provenancePanel() {
  let panel = $('#guyed-connection-provenance')
  if (panel) return panel
  const target = $('#result-panel-verification')
  if (!target) return null
  panel = make('details', 'verification-check')
  panel.id = 'guyed-connection-provenance'
  panel.hidden = true
  const summary = make('summary', '', 'Растяжки → межмодульный узел: источник усилий и границы проверки')
  const body = make('div', 'guyed-connection-provenance-body')
  panel.append(summary, body)
  target.prepend(panel)
  return panel
}

function demandSummary(envelope) {
  const demand = envelope?.governingBoltDemand
  if (!demand) return 'Определяющий болтовой demand отсутствует.'
  return [
    `ветер ${format(demand.windDirectionDeg, 0)}°`,
    `case ${Number.isInteger(demand.caseIndex) ? demand.caseIndex + 1 : '—'}`,
    `уровень ${demand.level ?? '—'}`,
    `узел ${demand.nodeId ?? '—'}`,
    `Nраст=${format((demand.tensionN ?? 0) / 1000, 2)} кН`,
    `V=${format((demand.shearN ?? 0) / 1000, 2)} кН`,
    `M=${format(demand.bendingMomentNm, 1)} Н·м`,
    `T=${format(demand.torsionNm, 1)} Н·м`,
  ].join(' · ')
}

function weldSummary(envelope) {
  const weld = envelope?.criticalWeld
  if (!weld) return 'Критический сварной конец не определён.'
  const check = weld.check ?? {}
  return [
    `ребро ${weld.memberId ?? '—'} / конец ${weld.end ?? '—'}`,
    `узел ${weld.nodeId ?? '—'}`,
    `ветер ${format(weld.windDirectionDeg, 0)}°`,
    `N=${format((weld.axialForceN ?? 0) / 1000, 2)} кН`,
    `V=${format((weld.shearForceN ?? 0) / 1000, 2)} кН`,
    `M=${format(weld.bendingNm, 1)} Н·м`,
    `T=${format(weld.torsionNm, 1)} Н·м`,
    `требуемая физическая длина шва ${format(check.requiredPhysicalLengthMm, 1)} мм`,
  ].join(' · ')
}

function selectedJointText(envelope) {
  const joint = envelope?.selectedJoint
  if (!joint) return '—'
  return `M${joint.boltDiameterMm} ${joint.boltClass} · ${joint.boltLengthMm} мм · гайка M${joint.clearanceNutThreadMm}`
}

export function renderGuyedConnectionProjection(snapshot) {
  const connection = connectionPanel()
  const provenance = provenancePanel()
  if (!connection || !provenance) return

  const envelope = snapshot?.guyResult?.connectionEnvelope ?? null
  connection.hidden = !envelope
  provenance.hidden = !envelope
  if (!envelope) return

  connection.classList.toggle('connection-failed', !envelope.passes)
  const title = make('h3', '', envelope.passes
    ? 'Соединение по нелинейной guyed-огибающей проходит'
    : 'Соединение по нелинейной guyed-огибающей НЕ ПРОХОДИТ')
  const explanation = make('p', '', 'Проверяется тот же физический межмодульный узел, который выбран основным расчётом. Автоподбор внутри ветровых случаев запрещён: все nonlinear N/V/T/M прогоняются через один fixed joint.')
  const metrics = make('div', 'key-metric-grid')
  metrics.append(
    metric('Физический узел', selectedJointText(envelope), `исходный режим: ${envelope.requestedMode}; проверка: ${envelope.checkMode}`),
    metric('Болт по guyed actions', `U = ${format(envelope.maximumBoltUtilization, 3)}`, envelope.passes ? 'лимит ≤ 1' : `причина: ${envelope.statusReason ?? 'connection-failed'}`),
    metric('Расчётных случаев', String(envelope.caseCount ?? '—'), envelope.method ?? '—'),
  )
  const reason = make('p', 'material-summary', `Статус: ${envelope.statusReason ?? (envelope.passes ? 'pass' : 'fail')}${envelope.failureReasons?.length ? ` · ${envelope.failureReasons.join(', ')}` : ''}`)
  const demand = make('p', 'material-summary', `Определяющий болт: ${demandSummary(envelope)}`)
  const weld = make('p', 'material-summary', `Критический сварной конец: ${weldSummary(envelope)}`)
  connection.replaceChildren(title, explanation, metrics, reason, demand, weld)

  const body = $('.guyed-connection-provenance-body', provenance)
  if (body) {
    const checked = make('p', '', `Проверено: ${envelope.scope?.checked ?? 'межмодульный узел по nonlinear frame actions'}.`)
    const excluded = make('p', '', `Не входит в этот критерий: ${envelope.scope?.excluded ?? 'local guy hardware, anchors and soil'}.`)
    const source = make('p', '', `Provenance: ${envelope.method}; physicalJointSource=${envelope.physicalJointSource}; caseCount=${envelope.caseCount}; statusReason=${envelope.statusReason}. Определяющий demand: ${demandSummary(envelope)}`)
    body.replaceChildren(checked, excluded, source)
  }
}
