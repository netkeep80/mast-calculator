import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDefaultProjectInputToForm,
  applyProjectInputToForm,
  readProjectInputFromForm,
} from '../apps/web/project-form-dom.js'
import { createProjectInput } from '../packages/application/index.js'

function fakeForm(fieldNames) {
  const fields = new Map(fieldNames.map((name) => [name, {
    value: '',
    checked: false,
    labels: [{ textContent: name }],
  }]))
  return {
    elements: {
      namedItem: (name) => fields.get(name) ?? null,
    },
    field: (name) => fields.get(name),
  }
}

test('shared DOM adapter reads canonical ProjectInput with integer/boolean/string coercion', () => {
  const form = fakeForm([
    'moduleCount', 'stockBarPieces', 'barDiameterMm', 'reinforcementClass',
    'windPresetId', 'windPressurePa', 'windEnvelopeEnabled', 'equipmentMassKg',
  ])
  applyDefaultProjectInputToForm(form)
  form.field('moduleCount').value = '3.9'
  form.field('stockBarPieces').value = '5.8'
  form.field('barDiameterMm').value = '14'
  form.field('reinforcementClass').value = 'A500C'
  form.field('windPresetId').value = 'custom'
  form.field('windPressurePa').value = '321.5'
  form.field('windEnvelopeEnabled').checked = false
  form.field('equipmentMassKg').value = '8.5'

  const input = readProjectInputFromForm(form)
  assert.equal(input.geometry.moduleCount, 3)
  assert.equal(input.geometry.stockBarPieces, 5)
  assert.equal(input.geometry.barDiameterMm, 14)
  assert.equal(input.material.reinforcementClass, 'A500C')
  assert.equal(input.environment.windPresetId, 'custom')
  assert.equal(input.environment.windPressurePa, 321.5)
  assert.equal(input.environment.windEnvelopeEnabled, false)
  assert.equal(input.equipment.massKg, 8.5)
})

test('ProjectInput can be written to the same DOM adapter and read back', () => {
  const form = fakeForm([
    'moduleCount', 'stockBarLengthMm', 'stockBarPieces', 'barDiameterMm',
    'reinforcementClass', 'windPresetId', 'windPressurePa', 'windEnvelopeEnabled',
    'equipmentMassKg', 'equipmentWindAreaM2', 'displacementLimitMm',
  ])
  const input = createProjectInput({
    geometry: { moduleCount: 4, stockBarLengthMm: 12000, stockBarPieces: 5, barDiameterMm: 16 },
    material: { reinforcementClass: 'A500C' },
    environment: { windPresetId: 'custom', windPressurePa: 450, windEnvelopeEnabled: false },
    equipment: { massKg: 12, windAreaM2: 0.45 },
    criteria: { displacementLimitMm: 55 },
  })

  applyProjectInputToForm(form, input)
  const roundTrip = readProjectInputFromForm(form)
  assert.deepEqual(roundTrip, input)
})
