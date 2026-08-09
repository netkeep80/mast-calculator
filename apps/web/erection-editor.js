let singleton = null

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

function element(tag, className = '', text = '') {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function labeledControl(labelText, control) {
  const label = document.createElement('label')
  label.append(document.createTextNode(labelText), control)
  return label
}

function numberInput(value, { min = null, max = null, step = null } = {}) {
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value)
  if (min !== null) input.min = String(min)
  if (max !== null) input.max = String(max)
  if (step !== null) input.step = String(step)
  return input
}

function selectInput(options, selected) {
  const select = document.createElement('select')
  select.replaceChildren(...options.map(({ value, label }) => {
    const option = document.createElement('option')
    option.value = String(value)
    option.textContent = label
    option.selected = String(value) === String(selected)
    return option
  }))
  return select
}

function defaultTiltUp() {
  return {
    mode: 'tilt-up',
    hingeBaseEdgeIndex: 0,
    attachmentTopCornerIndex: 0,
    anchorPointM: [8, 0, 0],
    rotationSense: 1,
    startAngleDeg: 0,
    endAngleDeg: 90,
    sampling: {
      initialSegments: 6,
      relativeTolerance: 0.02,
      minimumAngleStepDeg: 0.25,
      maximumEvaluations: 49,
      maximumDepth: 12,
    },
  }
}

export function initializeErectionEditor(form) {
  if (singleton) return singleton
  if (!form) throw new Error('Erection editor requires the canonical project form')

  const defaults = defaultTiltUp()
  const details = element('details', 'input-details erection-editor')
  details.id = 'erection-input-details'
  details.open = globalThis.location?.hash === '#erection'
  const summary = element('summary', '', 'Монтаж — отключён')
  const intro = element(
    'p',
    'hint practical-note',
    'Монтаж хранится в том же project/v1 как пользовательская геометрия подъёма. Узлы FEM, натяжения, реакции и история углов в проект не записываются.',
  )

  const enabled = document.createElement('input')
  enabled.type = 'checkbox'
  enabled.id = 'erection-enabled'
  const enabledLabel = element('label', 'checkbox erection-editor-enabled')
  enabledLabel.append(enabled, document.createTextNode(' Проверять подъём мачты поворотом вокруг опоры'))

  const grid = element('div', 'form-grid erection-editor-grid')
  const hingeEdge = selectInput([
    { value: 0, label: 'Ребро основания 1–2' },
    { value: 1, label: 'Ребро основания 2–3' },
    { value: 2, label: 'Ребро основания 3–1' },
  ], defaults.hingeBaseEdgeIndex)
  hingeEdge.id = 'erection-hinge-edge'
  const attachmentCorner = selectInput([
    { value: 0, label: 'Верхний угол 1' },
    { value: 1, label: 'Верхний угол 2' },
    { value: 2, label: 'Верхний угол 3' },
  ], defaults.attachmentTopCornerIndex)
  attachmentCorner.id = 'erection-attachment-corner'
  const anchorX = numberInput(defaults.anchorPointM[0], { step: 0.1 })
  const anchorY = numberInput(defaults.anchorPointM[1], { step: 0.1 })
  const anchorZ = numberInput(defaults.anchorPointM[2], { step: 0.1 })
  anchorX.id = 'erection-anchor-x'
  anchorY.id = 'erection-anchor-y'
  anchorZ.id = 'erection-anchor-z'
  const rotationSense = selectInput([
    { value: 1, label: '+ вокруг оси шарнира' },
    { value: -1, label: '− вокруг оси шарнира' },
  ], defaults.rotationSense)
  rotationSense.id = 'erection-rotation-sense'
  const startAngle = numberInput(defaults.startAngleDeg, { min: 0, max: 90, step: 1 })
  const endAngle = numberInput(defaults.endAngleDeg, { min: 0, max: 90, step: 1 })
  startAngle.id = 'erection-start-angle'
  endAngle.id = 'erection-end-angle'
  grid.append(
    labeledControl('Шарнир', hingeEdge),
    labeledControl('Крепление троса', attachmentCorner),
    labeledControl('Анкер X, м', anchorX),
    labeledControl('Анкер Y, м', anchorY),
    labeledControl('Анкер Z, м', anchorZ),
    labeledControl('Направление подъёма', rotationSense),
    labeledControl('Начальный угол, °', startAngle),
    labeledControl('Конечный угол, °', endAngle),
  )

  const adaptive = element('div', 'form-grid erection-editor-adaptive')
  const initialSegments = numberInput(defaults.sampling.initialSegments, { min: 1, step: 1 })
  const tolerance = numberInput(defaults.sampling.relativeTolerance, { min: 0.0001, step: 0.005 })
  const minimumStep = numberInput(defaults.sampling.minimumAngleStepDeg, { min: 0.01, step: 0.05 })
  const maximumEvaluations = numberInput(defaults.sampling.maximumEvaluations, { min: 2, step: 1 })
  const maximumDepth = numberInput(defaults.sampling.maximumDepth, { min: 1, step: 1 })
  initialSegments.id = 'erection-initial-segments'
  tolerance.id = 'erection-relative-tolerance'
  minimumStep.id = 'erection-minimum-step'
  maximumEvaluations.id = 'erection-maximum-evaluations'
  maximumDepth.id = 'erection-maximum-depth'
  adaptive.append(
    labeledControl('Начальных интервалов', initialSegments),
    labeledControl('Относительная точность', tolerance),
    labeledControl('Мин. шаг угла, °', minimumStep),
    labeledControl('Макс. вычислений', maximumEvaluations),
    labeledControl('Макс. глубина', maximumDepth),
  )

  const note = element(
    'p',
    'hint practical-note',
    'Координаты анкера заданы в неподвижной мировой системе. Огибающая адаптивно уточняет тягу, перемещения, реакции и N/V/T/M; невозможная геометрия остаётся явным infeasible-состоянием.',
  )
  details.append(summary, intro, enabledLabel, grid, adaptive, note)
  const advancedInputs = form.querySelector('.advanced-inputs')
  if (advancedInputs) form.insertBefore(details, advancedInputs)
  else form.append(details)

  let explicitDisabled = false
  const listeners = new Set()

  function syncVisibility() {
    const active = enabled.checked
    summary.textContent = active ? 'Монтаж — подъём вокруг опоры' : 'Монтаж — отключён'
    grid.hidden = !active
    adaptive.hidden = !active
    note.hidden = !active
  }

  function notify() {
    syncVisibility()
    for (const listener of listeners) listener(api)
  }

  function readTiltUp() {
    const value = {
      mode: 'tilt-up',
      hingeBaseEdgeIndex: Math.round(finite(hingeEdge.value, 0)),
      attachmentTopCornerIndex: Math.round(finite(attachmentCorner.value, 0)),
      anchorPointM: [finite(anchorX.value), finite(anchorY.value), finite(anchorZ.value)],
      rotationSense: finite(rotationSense.value, 1),
      startAngleDeg: finite(startAngle.value, 0),
      endAngleDeg: finite(endAngle.value, 90),
      sampling: {
        initialSegments: Math.round(finite(initialSegments.value, 6)),
        relativeTolerance: finite(tolerance.value, 0.02),
        minimumAngleStepDeg: finite(minimumStep.value, 0.25),
        maximumEvaluations: Math.round(finite(maximumEvaluations.value, 49)),
        maximumDepth: Math.round(finite(maximumDepth.value, 12)),
      },
    }
    if (value.hingeBaseEdgeIndex < 0 || value.hingeBaseEdgeIndex > 2) throw new Error('Монтаж: ребро шарнира должно быть 1…3')
    if (value.attachmentTopCornerIndex < 0 || value.attachmentTopCornerIndex > 2) throw new Error('Монтаж: верхний угол должен быть 1…3')
    if (value.rotationSense !== 1 && value.rotationSense !== -1) throw new Error('Монтаж: направление подъёма должно быть + или −')
    if (value.startAngleDeg < 0 || value.endAngleDeg > 90 || !(value.endAngleDeg > value.startAngleDeg)) {
      throw new Error('Монтаж: требуется 0 ≤ начальный угол < конечный угол ≤ 90°')
    }
    if (!(value.sampling.relativeTolerance > 0) || !(value.sampling.minimumAngleStepDeg > 0)) {
      throw new Error('Монтаж: параметры адаптивной сетки должны быть положительными')
    }
    if (value.sampling.initialSegments < 1 || value.sampling.maximumDepth < 1) {
      throw new Error('Монтаж: размеры адаптивной сетки должны быть положительными целыми')
    }
    if (value.sampling.maximumEvaluations < value.sampling.initialSegments + 1) {
      throw new Error('Монтаж: лимит вычислений не вмещает начальную сетку')
    }
    return Object.freeze({
      ...value,
      anchorPointM: Object.freeze(value.anchorPointM),
      sampling: Object.freeze(value.sampling),
    })
  }

  function read() {
    if (enabled.checked) return readTiltUp()
    return explicitDisabled ? Object.freeze({ mode: 'disabled' }) : undefined
  }

  function apply(value) {
    const tiltUp = value?.mode === 'tilt-up' ? value : defaults
    explicitDisabled = value?.mode === 'disabled'
    enabled.checked = value?.mode === 'tilt-up'
    hingeEdge.value = String(tiltUp.hingeBaseEdgeIndex)
    attachmentCorner.value = String(tiltUp.attachmentTopCornerIndex)
    anchorX.value = String(tiltUp.anchorPointM[0])
    anchorY.value = String(tiltUp.anchorPointM[1])
    anchorZ.value = String(tiltUp.anchorPointM[2])
    rotationSense.value = String(tiltUp.rotationSense)
    startAngle.value = String(tiltUp.startAngleDeg)
    endAngle.value = String(tiltUp.endAngleDeg)
    initialSegments.value = String(tiltUp.sampling.initialSegments)
    tolerance.value = String(tiltUp.sampling.relativeTolerance)
    minimumStep.value = String(tiltUp.sampling.minimumAngleStepDeg)
    maximumEvaluations.value = String(tiltUp.sampling.maximumEvaluations)
    maximumDepth.value = String(tiltUp.sampling.maximumDepth)
    details.open = enabled.checked || globalThis.location?.hash === '#erection'
    syncVisibility()
  }

  const api = Object.freeze({
    element: details,
    get enabled() { return enabled.checked },
    read,
    apply,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  singleton = api

  enabled.addEventListener('change', () => {
    explicitDisabled = !enabled.checked
    notify()
  })
  details.addEventListener('change', (event) => {
    if (event.target === enabled) return
    notify()
  })

  apply(undefined)
  return api
}

export function getErectionEditor() {
  return singleton
}
