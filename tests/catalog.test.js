import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getReinforcementClass,
  regularOctahedronHeightMm,
  STANDARD_DIAMETERS_MM,
  STOCK_BAR_DIVISIONS,
  theoreticalCutLengthMm,
} from '../packages/domain/index.js'
import { resolveCalculationParameters } from '../packages/application/index.js'

test('закупочный пруток делится на заданное число равных заготовок', () => {
  assert.equal(theoreticalCutLengthMm(12000, 1), 12000)
  assert.equal(theoreticalCutLengthMm(12000, 16), 750)
  assert.equal(theoreticalCutLengthMm(11800, 16), 737.5)
  assert.equal(theoreticalCutLengthMm(11800, 12), 11800 / 12)
  assert.equal(theoreticalCutLengthMm(12000, 48), 250)
})

test('каталог раскроя содержит каждый целый вариант от 1 до 48', () => {
  assert.equal(STOCK_BAR_DIVISIONS.length, 48)
  assert.deepEqual(STOCK_BAR_DIVISIONS, Array.from({ length: 48 }, (_, index) => index + 1))
})

test('высота правильного октаэдра однозначно определяется длиной ребра', () => {
  assert.ok(Math.abs(regularOctahedronHeightMm(750) - 750 * Math.sqrt(2 / 3)) < 1e-12)
  assert.ok(Math.abs(regularOctahedronHeightMm(11800 / 12) - (11800 / 12) * Math.sqrt(2 / 3)) < 1e-12)
})

test('некорректный раскрой и длина ребра отвергаются', () => {
  assert.throws(() => theoreticalCutLengthMm(0, 12), /положительным/)
  assert.throws(() => theoreticalCutLengthMm(12000, 12.5), /целым/)
  assert.throws(() => theoreticalCutLengthMm(12000, 49), /от 1 до 48/)
  assert.throws(() => regularOctahedronHeightMm(-1), /положительным/)
})

test('практический ввод разрешается в расчётные параметры из единого каталога', () => {
  const parameters = resolveCalculationParameters({
    stockBarLengthMm: 11800,
    stockBarPieces: 16,
    reinforcementClass: 'A500C',
    barDiameterMm: 12,
    moduleHeightMm: 54,
    effectiveLengthFactor: 2,
  })

  assert.equal(parameters.ribCutLengthMm, 737.5)
  assert.equal(parameters.triangleSideMm, 737.5)
  assert.ok(Math.abs(parameters.moduleHeightMm - 737.5 * Math.sqrt(2 / 3)) < 1e-12)
  assert.equal(parameters.yieldStrengthMPa, 500)
  assert.equal(parameters.tensileStrengthMPa, 600)
  assert.equal(parameters.youngModulusGPa, 200)
  assert.equal(parameters.poissonRatio, 0.3)
  assert.equal(parameters.reinforcementWeldabilityGuaranteed, true)
  assert.equal(parameters.effectiveLengthFactor, 0.5)
})

test('ручная высота модуля не может изменить геометрию правильного октаэдра', () => {
  const low = resolveCalculationParameters({ stockBarLengthMm: 12000, stockBarPieces: 16, moduleHeightMm: 1 })
  const high = resolveCalculationParameters({ stockBarLengthMm: 12000, stockBarPieces: 16, moduleHeightMm: 99999 })
  assert.equal(low.moduleHeightMm, high.moduleHeightMm)
  assert.ok(Math.abs(low.moduleHeightMm - 750 * Math.sqrt(2 / 3)) < 1e-12)
})

test('каталог содержит практические стандартные диаметры и свариваемые классы', () => {
  assert.ok(STANDARD_DIAMETERS_MM.includes(12))
  assert.equal(STANDARD_DIAMETERS_MM.includes(24), false)
  assert.equal(getReinforcementClass('A400C').yieldStrengthMPa, 390)
  assert.equal(getReinforcementClass('A600C').yieldStrengthMPa, 600)
  assert.equal(getReinforcementClass('A400C').poissonRatio, 0.3)
  assert.equal(getReinforcementClass('A500C').weldabilityGuaranteed, true)
})

test('неизвестный класс арматуры отвергается', () => {
  assert.throws(() => getReinforcementClass('A999'), /Неизвестный класс/)
})
