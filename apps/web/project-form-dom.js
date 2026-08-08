import {
  DEFAULT_PROJECT_FORM_VALUES,
  projectInputFromFlatValues,
  projectInputToFlatValues,
} from './project-form.js'

const STRING_FIELDS = new Set([
  'reinforcementClass',
  'windPresetId',
  'jointConfiguratorMode',
  'jointBoltClass',
  'weldConsumableId',
])

const BOOLEAN_FIELDS = new Set([
  'windEnvelopeEnabled',
])

const INTEGER_FIELDS = new Set([
  'moduleCount',
  'stockBarPieces',
  'jointBoltShearPlanes',
  'weldSegmentsPerEnd',
  'heightSearchMaxModules',
])

function fieldElement(form, name) {
  return form?.elements?.namedItem(name) ?? null
}

function fieldLabel(element, name) {
  return element?.labels?.[0]?.textContent?.trim() || name
}

function readFieldValue(form, name, fallback) {
  const element = fieldElement(form, name)
  if (!element) return fallback
  if (BOOLEAN_FIELDS.has(name)) return Boolean(element.checked)
  if (STRING_FIELDS.has(name)) return element.value || fallback

  const raw = element.value
  if (raw === '' && fallback === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`Поле «${fieldLabel(element, name)}» заполнено неверно`)
  }
  return INTEGER_FIELDS.has(name) ? Math.floor(value) : value
}

export function readProjectInputFromForm(form) {
  const values = {}
  for (const [name, fallback] of Object.entries(DEFAULT_PROJECT_FORM_VALUES)) {
    const value = readFieldValue(form, name, fallback)
    if (value !== undefined) values[name] = value
  }
  return projectInputFromFlatValues(values)
}

export function applyProjectInputToForm(form, projectInput) {
  const values = projectInputToFlatValues(projectInput)
  for (const [name, value] of Object.entries(values)) {
    const element = fieldElement(form, name)
    if (!element) continue
    if (BOOLEAN_FIELDS.has(name)) element.checked = Boolean(value)
    else element.value = String(value)
  }
  return values
}

export function applyDefaultProjectInputToForm(form) {
  for (const [name, value] of Object.entries(DEFAULT_PROJECT_FORM_VALUES)) {
    const element = fieldElement(form, name)
    if (!element) continue
    if (BOOLEAN_FIELDS.has(name)) element.checked = Boolean(value)
    else element.value = String(value)
  }
  return DEFAULT_PROJECT_FORM_VALUES
}
