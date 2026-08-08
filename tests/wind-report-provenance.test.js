import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateProject,
  createProjectInput,
} from '../packages/application/index.js'
import { WIND_ACTION_MODE_SP20_MEAN_V1 } from '../packages/domain/index.js'
import { createCalculationProjectHtml } from '../packages/reporting/index.js'

function sp20Project() {
  return createProjectInput({
    geometry: {
      moduleCount: 2,
      barDiameterMm: 16,
    },
    environment: {
      windActionMode: WIND_ACTION_MODE_SP20_MEAN_V1,
      windRegion: 'III',
      windTerrainType: 'B',
      windPresetId: 'custom',
      windPressurePa: 380,
      dragCoefficient: 1.2,
      windEnvelopeEnabled: false,
      windDirectionDeg: 0,
      lateralCapacityStepDeg: 60,
    },
    equipment: {
      massKg: 0,
      windAreaM2: 0.1,
      dragCoefficient: 1.4,
    },
    criteria: {
      displacementLimitMm: 1000,
      minimumBucklingFactor: 1,
      heightSearchMaxModules: 2,
    },
  })
}

test('SP20 wind provenance is identical in result, verification passport and paper project', () => {
  const result = calculateProject(sp20Project())
  const provenance = result.parameters.windActionProvenance
  assert.equal(provenance.model, WIND_ACTION_MODE_SP20_MEAN_V1)
  assert.equal(provenance.normative, true)
  assert.equal(provenance.windRegion, 'III')
  assert.equal(provenance.terrainType, 'B')
  assert.equal(provenance.basicWindPressurePa, 380)
  assert.ok(provenance.referenceHeightM > 0)
  assert.ok(provenance.referenceHeightCoefficient > 0)
  assert.equal(provenance.referenceCharacteristicMeanPressurePa, result.parameters.windPressurePa)
  assert.equal(provenance.loadReliabilityFactor, result.parameters.windLoadFactor)
  assert.equal(provenance.aerodynamicCoefficientSource, 'project-input-not-sp20-annex')
  assert.equal(provenance.memberAerodynamicCoefficient, 1.2)
  assert.equal(provenance.equipmentAerodynamicCoefficient, 1.4)
  assert.equal(provenance.pulsationComponentIncluded, false)
  assert.equal(provenance.dynamicResponseIncluded, false)

  assert.deepEqual(result.verification.windActionProvenance, provenance)

  const html = createCalculationProjectHtml(result, result.parameters, '2026-08-09T00:00:00.000Z', {
    repository: 'netkeep80/mast-calculator',
    ref: 'test',
    sha: 'test',
  })
  assert.match(html, /10\.1\. Нормативная модель средней ветровой нагрузки/)
  assert.match(html, /СП 20\.13330\.2016[\s\S]*изм\. №6[\s\S]*раздел 11/)
  assert.match(html, /05\.09\.2024/)
  assert.match(html, /25\.09\.2024/)
  assert.match(html, /<td>III<\/td>/)
  assert.match(html, /<td>B<\/td>/)
  assert.match(html, /γf ветровой нагрузки/)
  assert.match(html, /не является коэффициентом динамичности/)
  assert.match(html, /project-input-not-sp20-annex/)
  assert.match(html, /не заявляются как автоматически выбранные по приложению СП 20/)
  assert.match(html, /пульсационная составляющая — НЕ УЧТЕНА/i)
  assert.match(html, /динамический\/модальный отклик — НЕ УЧТЁН/i)
  assert.doesNotMatch(html, /dynamicCoefficient\s*=\s*2\.5/)
})
