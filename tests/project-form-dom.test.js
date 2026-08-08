import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyDefaultProjectInputToForm,
  applyProjectInputToForm,
  readProjectInputFromForm,
} from '../apps/web/project-form-dom.js'
import { createProjectInput } from '../packages/application/index.js'
import { WIND_ACTION_MODE_SP20_MEAN_V1 } from '../packages/domain/index.js'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

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
  assert.equal(input.environment.windActionMode, undefined)
  assert.equal(input.equipment.massKg, 8.5)
})

test('legacy ProjectInput can be written to the same DOM adapter and read back unchanged', () => {
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

test('SP20 wind mode region and terrain round-trip as optional project/v1 fields', () => {
  const form = fakeForm([
    'moduleCount', 'stockBarLengthMm', 'stockBarPieces', 'barDiameterMm',
    'reinforcementClass', 'windActionMode', 'windRegion', 'windTerrainType',
    'windPresetId', 'windPressurePa', 'windEnvelopeEnabled',
    'equipmentMassKg', 'equipmentWindAreaM2', 'displacementLimitMm',
  ])
  const input = createProjectInput({
    geometry: { moduleCount: 8, stockBarLengthMm: 12000, stockBarPieces: 5, barDiameterMm: 16 },
    material: { reinforcementClass: 'A500C' },
    environment: {
      windActionMode: WIND_ACTION_MODE_SP20_MEAN_V1,
      windRegion: 'III',
      windTerrainType: 'B',
      windPresetId: 'custom',
      windPressurePa: 380,
      windEnvelopeEnabled: true,
    },
    equipment: { massKg: 12, windAreaM2: 0.45 },
    criteria: { displacementLimitMm: 55 },
  })

  applyDefaultProjectInputToForm(form)
  applyProjectInputToForm(form, input)
  const roundTrip = readProjectInputFromForm(form)
  assert.deepEqual(roundTrip, input)
})

test('SP20 controls are static UI while normative wind formulas stay outside Web presentation', () => {
  const index = source('apps/web/index.html')
  const controller = source('apps/web/main-project-form.js')
  const formAdapter = source('apps/web/project-form.js')
  const domAdapter = source('apps/web/project-form-dom.js')
  const presenter = source('apps/web/wind-action-result.js')
  const resultTabs = source('apps/web/result-tabs.js')
  const webSources = [controller, formAdapter, domAdapter, presenter]

  for (const name of ['windActionMode', 'windRegion', 'windTerrainType']) {
    assert.match(index, new RegExp(`name="${name}"`), `missing static ${name} control`)
  }
  assert.match(index, /γf ветровой нагрузки/, 'wind reliability factor is not named explicitly')
  assert.match(index, /id="wind-action-note"/, 'wind model scope note is missing')
  assert.match(controller, /WIND_ACTION_MODE_SP20_MEAN_V1/, 'Web controller cannot select SP20 mean mode')
  assert.match(controller, /Пульсация и динамический отклик ещё не включены/, 'UI hides the mean-only model boundary')
  assert.match(controller, /preset\.disabled = normative/, 'Beaufort remains active as a fake normative wind region')
  assert.match(resultTabs, /renderWindActionProvenance\(snapshot\)/, 'resolved wind provenance is not projected into Verification')
  assert.match(presenter, /windActionProvenance/, 'Verification presenter does not read canonical provenance')
  assert.match(presenter, /γf — коэффициент надёжности по нагрузке, не коэффициент динамичности/, 'result UI confuses reliability and dynamics')
  assert.match(presenter, /Пульсационная составляющая/, 'result UI hides the pulsation boundary')
  assert.match(presenter, /Динамический\/модальный отклик/, 'result UI hides the dynamic boundary')

  for (const text of webSources) {
    assert.doesNotMatch(text, /sp20HeightCoefficient|sp20CharacteristicMeanPressurePa|SP20_TERRAIN_PARAMETERS/)
    assert.doesNotMatch(text, /Math\.pow|\*\*\s*\(?.*alpha|w0\s*\*|k\(ze\)\s*\*/i)
    assert.doesNotMatch(text, /dynamicCoefficient\s*=\s*2\.5/)
    assert.doesNotMatch(text, /calculateProject|buildLoadCase|analyzeFrame|Worker\s*\(|postMessage\s*\(/)
  }
})
