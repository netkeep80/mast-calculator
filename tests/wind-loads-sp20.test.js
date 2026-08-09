import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WIND_ACTION_MODE_MANUAL,
  WIND_ACTION_MODE_SP20_MEAN_V1,
  createProjectInput,
  resolveProjectInput,
  sp20CharacteristicMeanPressurePa,
  sp20HeightCoefficient,
} from '../packages/domain/index.js'
import {
  buildLoadCase,
  generateMastModel,
} from '../packages/structural-analysis/index.js'

const approximately = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`)
}

test('SP20 mean wind uses table 11.2 below 10 m and formula 11.4 from 10 m', () => {
  approximately(sp20HeightCoefficient(0, 'A'), 0.75)
  approximately(sp20HeightCoefficient(5, 'B'), 0.50)
  approximately(sp20HeightCoefficient(10, 'C'), 0.40)

  // Current SP20 table 11.2: linear interpolation between 5 m and 10 m.
  approximately(sp20HeightCoefficient(7.5, 'A'), 0.875)
  approximately(sp20HeightCoefficient(7.5, 'B'), 0.575)
  approximately(sp20HeightCoefficient(7.5, 'C'), 0.40)

  // Formula 11.4 with table 11.3 parameters: k10 * (ze / 10)^(2 alpha).
  approximately(sp20HeightCoefficient(20, 'A'), Math.pow(2, 0.30))
  approximately(sp20HeightCoefficient(20, 'B'), 0.65 * Math.pow(2, 0.40))
  approximately(sp20HeightCoefficient(20, 'C'), 0.40 * Math.pow(2, 0.50))
  assert.throws(() => sp20HeightCoefficient(301, 'A'), /above 300 m/)
})

test('SP20 region pressure and gamma_f remain separate named quantities', () => {
  const characteristic = sp20CharacteristicMeanPressurePa('III', 'B', 10)
  approximately(characteristic, 380 * 0.65)
  const gammaF = 1.4
  approximately(characteristic * gammaF, 345.8)
})

test('legacy custom pressure resolves to explicit manual provenance without changing pressure', () => {
  const resolved = resolveProjectInput(createProjectInput({
    environment: {
      windPresetId: 'custom',
      windPressurePa: 380,
    },
  }))
  assert.equal(resolved.windActionMode, WIND_ACTION_MODE_MANUAL)
  assert.equal(resolved.windRegion, null)
  assert.equal(resolved.windTerrainType, null)
  assert.equal(resolved.windPressurePa, 380)
  assert.equal(resolved.windActionProvenance.normative, false)
  assert.equal(resolved.windActionProvenance.loadReliabilityFactor, resolved.windLoadFactor)
  assert.equal(resolved.windActionProvenance.pulsationComponentIncluded, false)
  assert.equal(resolved.windActionProvenance.dynamicResponseIncluded, false)

  const loadCase = buildLoadCase(generateMastModel(resolved), resolved)
  for (const detail of loadCase.memberLoadDetails.filter(Boolean)) {
    assert.equal(detail.characteristicMeanWindPressurePa, 380)
    assert.equal(detail.designMeanWindPressurePa, 380 * resolved.windLoadFactor)
  }
  assert.equal(loadCase.equipmentCharacteristicMeanWindPressurePa, 380)
  assert.equal(loadCase.windActionProvenance.model, WIND_ACTION_MODE_MANUAL)
})

test('SP20 mean mode resolves height-dependent member and equipment pressure with provenance', () => {
  const resolved = resolveProjectInput(createProjectInput({
    geometry: {
      moduleCount: 24,
    },
    environment: {
      windActionMode: WIND_ACTION_MODE_SP20_MEAN_V1,
      windRegion: 'III',
      windTerrainType: 'B',
      windPresetId: 'custom',
      windPressurePa: 380,
    },
  }))
  assert.equal(resolved.windActionMode, WIND_ACTION_MODE_SP20_MEAN_V1)
  assert.equal(resolved.windActionProvenance.normative, true)
  assert.equal(resolved.windActionProvenance.basicWindPressurePa, 380)
  assert.equal(resolved.windActionProvenance.terrainType, 'B')
  assert.equal(resolved.windActionProvenance.pulsationComponentIncluded, false)
  assert.equal(resolved.windActionProvenance.dynamicResponseIncluded, false)

  const model = generateMastModel(resolved)
  const loadCase = buildLoadCase(model, resolved)
  const details = loadCase.memberLoadDetails.filter(Boolean)
  const lowest = details.reduce((best, item) => item.windReferenceHeightM < best.windReferenceHeightM ? item : best)
  const highest = details.reduce((best, item) => item.windReferenceHeightM > best.windReferenceHeightM ? item : best)

  approximately(
    lowest.characteristicMeanWindPressurePa,
    sp20CharacteristicMeanPressurePa('III', 'B', lowest.windReferenceHeightM),
    1e-9,
  )
  approximately(
    highest.characteristicMeanWindPressurePa,
    sp20CharacteristicMeanPressurePa('III', 'B', highest.windReferenceHeightM),
    1e-9,
  )
  assert.ok(highest.characteristicMeanWindPressurePa > lowest.characteristicMeanWindPressurePa)
  approximately(
    highest.designMeanWindPressurePa,
    highest.characteristicMeanWindPressurePa * resolved.windLoadFactor,
    1e-9,
  )

  const topHeightM = Math.max(...model.topNodeIds.map((nodeId) => model.nodes[nodeId].position[2]))
  approximately(loadCase.equipmentWindReferenceHeightM, topHeightM, 1e-12)
  approximately(
    loadCase.equipmentCharacteristicMeanWindPressurePa,
    sp20CharacteristicMeanPressurePa('III', 'B', topHeightM),
    1e-9,
  )
  approximately(
    loadCase.equipmentDesignMeanWindPressurePa,
    loadCase.equipmentCharacteristicMeanWindPressurePa * resolved.windLoadFactor,
    1e-9,
  )
})
