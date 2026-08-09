import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SP20_DYNAMIC_WIND_REFERENCES,
  SP20_MEAN_WIND_REFERENCES,
  SP20_WIND_MODEL_SOURCE,
  SP20_WIND_STANDARD,
  SP20_WIND_STANDARD_SOURCE,
  WIND_ACTION_MODE_SP20_MEAN_V1,
  resolveWindAction,
} from '../packages/domain/index.js'

test('SP20 wind source registry pins the active amendment-6 primary-source identity', () => {
  assert.equal(SP20_WIND_STANDARD.designation, 'СП 20.13330.2016')
  assert.equal(SP20_WIND_STANDARD.amendmentNumber, 6)
  assert.equal(SP20_WIND_STANDARD.approvalOrder, '597/пр')
  assert.equal(SP20_WIND_STANDARD.approvedOn, '2024-09-05')
  assert.equal(SP20_WIND_STANDARD.registeredOn, '2024-09-16')
  assert.equal(SP20_WIND_STANDARD.officiallyPublishedOn, '2024-09-17')
  assert.equal(SP20_WIND_STANDARD.effectiveOn, '2024-09-25')
  assert.equal(SP20_WIND_STANDARD.officialPublisher, 'Росстандарт')
  assert.match(SP20_WIND_STANDARD.officialRegistryUrl, /^https:\/\/protect\.gost\.ru\/sp\/details\//)
  assert.match(SP20_WIND_STANDARD.amendmentRegistryUrl, /^https:\/\/protect\.gost\.ru\/sp\/changesdetails\//)
  assert.equal(SP20_WIND_MODEL_SOURCE, SP20_WIND_STANDARD_SOURCE)
  assert.equal(SP20_WIND_STANDARD.sourceLabel, SP20_WIND_MODEL_SOURCE)
})

test('implemented SP20 mean coefficients retain explicit table/formula locators', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(SP20_MEAN_WIND_REFERENCES).map(([key, reference]) => [
      key,
      [reference.kind, reference.id, reference.status],
    ])),
    {
      basicWindPressure: ['table', '11.1', 'implemented'],
      lowHeightCoefficient: ['table', '11.2', 'implemented'],
      terrainParameters: ['table', '11.3', 'implemented'],
      heightCoefficient: ['formula', '11.4', 'implemented'],
    },
  )
})

test('dynamic SP20 source registry fails closed until exact official locators are verified', () => {
  assert.deepEqual(SP20_DYNAMIC_WIND_REFERENCES, [])
})

test('source-registry refactor preserves frozen sp20-mean-v1 provenance text and semantics', () => {
  const resolved = resolveWindAction({
    windActionMode: WIND_ACTION_MODE_SP20_MEAN_V1,
    windRegion: 'II',
    windTerrainType: 'B',
    windPressurePa: 0,
    windLoadFactor: 1.4,
    dragCoefficient: 1.2,
    equipmentDragCoefficient: 1.1,
  }, 20)

  assert.equal(resolved.windActionProvenance.source, 'СП 20.13330.2016 «Нагрузки и воздействия», изм. №6; приказ Минстроя России №597/пр от 05.09.2024; введено 25.09.2024; раздел 11')
  assert.equal(resolved.windActionProvenance.model, 'sp20-mean-v1')
  assert.equal(resolved.windActionProvenance.meanComponentIncluded, true)
  assert.equal(resolved.windActionProvenance.pulsationComponentIncluded, false)
  assert.equal(resolved.windActionProvenance.dynamicResponseIncluded, false)
})
