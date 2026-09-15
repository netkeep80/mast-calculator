import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCompleteMastWithConfiguredJoint } from '../packages/application/index.js'
import { createCalculationProjectHtml } from '../packages/reporting/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

const common = {
  moduleCount: 1,
  heightSearchMaxModules: 1,
  windEnvelopeEnabled: false,
  lateralCapacityStepDeg: 60,
}

const normativeParameters = resolvedProject(common)
const normativeResult = calculateCompleteMastWithConfiguredJoint(normativeParameters)

const migratedParameters = resolvedProject({
  ...common,
  steelSelfWeightLoadFactor: 0,
  equipmentLoadFactor: 1.17,
  iceLoadFactor: 0,
  windLoadFactor: 1.41,
})
const migratedResult = calculateCompleteMastWithConfiguredJoint(migratedParameters)

const tableValue = (label, valuePattern) => new RegExp(`${label}<\\/td><td>${valuePattern}<\\/td>`)

test('calculation project identifies normative SP20 load-action provenance', () => {
  const html = createCalculationProjectHtml(normativeResult, normativeParameters)
  assert.match(html, /Профиль расчётных воздействий/)
  assert.match(html, /Нормативный профиль/)
  assert.match(html, /СП 20\.13330\.2016/)
  assert.match(html, tableValue('γf собственного веса стали', '1,05'))
  assert.match(html, tableValue('γf оборудования', '1,05'))
  assert.match(html, tableValue('γf гололёда', '1,8'))
  assert.match(html, tableValue('γf ветровой нагрузки', '1,4'))
})

test('calculation project identifies migrated project/v1 factors without relabelling them normative', () => {
  const html = createCalculationProjectHtml(migratedResult, migratedParameters)
  assert.match(html, /Профиль расчётных воздействий/)
  assert.match(html, /Мигрированный профиль project\/v1/)
  assert.match(html, /не являются нормативным профилем по умолчанию/i)
  assert.match(html, tableValue('γf собственного веса стали', '0(?:,0+)?'))
  assert.match(html, tableValue('γf оборудования', '1,17'))
  assert.match(html, tableValue('γf гололёда', '0(?:,0+)?'))
  assert.match(html, tableValue('γf ветровой нагрузки', '1,41'))
})
