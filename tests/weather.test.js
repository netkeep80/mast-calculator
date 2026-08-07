import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AIR_DENSITY_KG_M3,
  getWeatherPreset,
  resolveWindParameters,
  WEATHER_PRESETS,
  windPressureFromSpeedMs,
  windSpeedFromPressurePa,
} from '../packages/domain/index.js'

test('погодные сценарии покрывают полную шкалу Бофорта 0–12', () => {
  assert.equal(WEATHER_PRESETS.length, 13)
  assert.deepEqual(WEATHER_PRESETS.map((item) => item.beaufort), [...Array(13).keys()])
  assert.equal(getWeatherPreset('bft12').label, 'Ураган')
  assert.equal(getWeatherPreset('bft12').designSpeedMs, 33)
})

test('динамическое давление вычисляется как q = ρv²/2', () => {
  const pressure = windPressureFromSpeedMs(27)
  assert.equal(pressure, 0.5 * AIR_DENSITY_KG_M3 * 27 ** 2)
  assert.ok(Math.abs(windSpeedFromPressurePa(pressure) - 27) < 1e-12)
})

test('погодные пресеты дают монотонно возрастающее давление', () => {
  const pressures = WEATHER_PRESETS.map((preset) => windPressureFromSpeedMs(preset.designSpeedMs))
  for (let index = 1; index < pressures.length; index += 1) {
    assert.ok(pressures[index] >= pressures[index - 1])
  }
})

test('выбор Бофорта переопределяет ручное давление и сохраняет описание сценария', () => {
  const resolved = resolveWindParameters({ windPresetId: 'bft10', windPressurePa: 1 })
  assert.equal(resolved.windSpeedMs, 27)
  assert.equal(resolved.beaufortForce, 10)
  assert.ok(resolved.windPresetLabel.includes('Сильный шторм'))
  assert.equal(resolved.windPressurePa, windPressureFromSpeedMs(27))
})

test('пользовательский режим сохраняет введённое давление', () => {
  const resolved = resolveWindParameters({ windPresetId: 'custom', windPressurePa: 380 })
  assert.equal(resolved.windPressurePa, 380)
  assert.equal(resolved.beaufortForce, null)
  assert.ok(Math.abs(resolved.windSpeedMs - windSpeedFromPressurePa(380)) < 1e-12)
})
