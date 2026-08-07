import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getReinforcementClass,
  STANDARD_DIAMETERS_MM,
  theoreticalCutLengthMm,
} from '../site/engine/catalog.js'
import { resolveCalculationParameters } from '../site/engine/calculate.js'

test('закупочный пруток делится на заданное число равных заготовок', () => {
  assert.equal(theoreticalCutLengthMm(12000, 16), 750)
  assert.equal(theoreticalCutLengthMm(11800, 16), 737.5)
})

test('практический ввод разрешается в расчётные параметры из единого каталога', () => {
  const parameters = resolveCalculationParameters({
    stockBarLengthMm: 11800,
    stockBarPieces: 16,
    reinforcementClass: 'A500C',
    barDiameterMm: 12,
  })

  assert.equal(parameters.ribCutLengthMm, 737.5)
  assert.equal(parameters.triangleSideMm, 737.5)
  assert.equal(parameters.yieldStrengthMPa, 500)
  assert.equal(parameters.tensileStrengthMPa, 600)
  assert.equal(parameters.youngModulusGPa, 200)
  assert.equal(parameters.reinforcementWeldabilityGuaranteed, true)
})

test('каталог содержит практические стандартные диаметры и свариваемые классы', () => {
  assert.ok(STANDARD_DIAMETERS_MM.includes(12))
  assert.ok(STANDARD_DIAMETERS_MM.includes(24) === false)
  assert.equal(getReinforcementClass('A400C').yieldStrengthMPa, 390)
  assert.equal(getReinforcementClass('A600C').yieldStrengthMPa, 600)
})
