import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDefaultProjectInputToForm,
  applyProjectInputToForm,
  readProjectInputFromForm,
} from '../apps/web/project-form-dom.js'
import { createProjectInput } from '../packages/application/index.js'
import { MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE } from '../packages/domain/index.js'

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

test('Web form round-trip preserves migrated project/v1 load-action semantics including zero factors', () => {
  const form = fakeForm([
    'loadActionProfile',
    'steelSelfWeightLoadFactor',
    'equipmentLoadFactor',
    'iceLoadFactor',
    'windLoadFactor',
  ])
  const input = createProjectInput({
    loadActions: {
      profile: MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE,
      steelSelfWeightLoadFactor: 0,
      equipmentLoadFactor: 1.17,
      iceLoadFactor: 0,
      windLoadFactor: 1.41,
    },
  })

  applyDefaultProjectInputToForm(form)
  applyProjectInputToForm(form, input)
  const roundTrip = readProjectInputFromForm(form)

  assert.deepEqual(roundTrip.loadActions, input.loadActions)
})
