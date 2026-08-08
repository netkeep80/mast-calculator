const $ = (selector, root = document) => root.querySelector(selector)

const format = (value, digits = 3) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(Number(value))
  : '—'

function make(tag, className = '', text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function provenancePanel() {
  let panel = $('#wind-action-provenance')
  if (panel) return panel
  const target = $('#result-panel-verification')
  if (!target) return null
  panel = make('details', 'verification-check')
  panel.id = 'wind-action-provenance'
  panel.open = true
  panel.append(
    make('summary', '', 'Ветровая модель: provenance и границы'),
    make('div', 'wind-action-provenance-body'),
  )
  target.prepend(panel)
  return panel
}

function booleanStatus(value) {
  return value ? 'учтено' : 'НЕ УЧТЕНО'
}

export function renderWindActionProvenance(snapshot) {
  const panel = provenancePanel()
  if (!panel) return
  const provenance = snapshot?.result?.verification?.windActionProvenance
    ?? snapshot?.result?.parameters?.windActionProvenance
    ?? null
  panel.hidden = !provenance
  if (!provenance) return

  const body = $('.wind-action-provenance-body', panel)
  if (!body) return
  const normative = provenance.normative
  const headline = make(
    'p',
    'material-summary',
    normative
      ? `Нормативная средняя составляющая: ${provenance.source}.`
      : `Пользовательский/сценарный ветер: ${provenance.source}.`,
  )
  const source = make(
    'p',
    '',
    normative
      ? `Модель ${provenance.model}; район ${provenance.windRegion}; тип местности ${provenance.terrainType}; w₀=${format(provenance.basicWindPressurePa, 1)} Па; опорная высота ${format(provenance.referenceHeightM, 3)} м; k=${format(provenance.referenceHeightCoefficient, 5)}; среднее характеристическое давление ${format(provenance.referenceCharacteristicMeanPressurePa, 2)} Па; γf=${format(provenance.loadReliabilityFactor, 3)}.`
      : `Модель ${provenance.model}; заданное характеристическое давление ${format(provenance.referenceCharacteristicMeanPressurePa, 2)} Па; γf=${format(provenance.loadReliabilityFactor, 3)}.`,
  )
  const scope = make(
    'p',
    '',
    `Средняя составляющая: ${booleanStatus(provenance.meanComponentIncluded)}. Пульсационная составляющая: ${booleanStatus(provenance.pulsationComponentIncluded)}. Динамический/модальный отклик: ${booleanStatus(provenance.dynamicResponseIncluded)}. γf — коэффициент надёжности по нагрузке, не коэффициент динамичности.`,
  )
  body.replaceChildren(headline, source, scope)
}
