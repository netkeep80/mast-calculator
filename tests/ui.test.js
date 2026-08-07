import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../site/app.js', import.meta.url), 'utf8')

test('UI не позволяет вручную вводить высоту октаэдра', () => {
  assert.match(html, /name="moduleHeightMm"[^>]*readonly/)
  assert.doesNotMatch(html, /name="moduleHeightMm"[^>]*(?:min|step)=/)
})

test('UI показывает вычисляемую длину ребра только для чтения', () => {
  assert.match(html, /name="ribCutLengthMm"[^>]*readonly/)
})

test('практические параметры закупки и материала представлены select-полями', () => {
  for (const name of ['stockBarLengthMm', 'stockBarPieces', 'barDiameterMm', 'reinforcementClass']) {
    assert.match(html, new RegExp(`<select name="${name}">`))
  }
})

test('погодные явления выбираются из выпадающего списка вплоть до урагана', () => {
  assert.match(html, /<select name="windPresetId"><\/select>/)
  assert.match(app, /WEATHER_PRESETS/)
  assert.match(app, /getWeatherPreset/)
  assert.match(html, /Скорость сценария, м\/с/)
})

test('ручное ветровое давление сохраняется как отдельный пользовательский режим', () => {
  assert.match(app, /CUSTOM_WIND_PRESET_ID/)
  assert.match(app, /windPressureFromSpeedMs/)
  assert.match(app, /windSpeedFromPressurePa/)
})

test('интерфейс показывает предельную боковую нагрузку вершины в кгс', () => {
  assert.match(html, /id="metric-lateral-capacity"/)
  assert.match(html, /id="metric-lateral-mode"/)
  assert.match(html, /id="lateral-capacity-description"/)
  assert.match(app, /calculateLateralCapacity/)
  assert.match(app, /кгс/)
})

test('бумажный проект доступен, пользовательского JSON-экспорта нет', () => {
  assert.match(html, /id="export-note-button"[^>]*>Скачать расчётный проект</)
  assert.doesNotMatch(html, /export-json-button/)
  assert.doesNotMatch(app, /createCalculationJson/)
  assert.doesNotMatch(app, /application\/json/)
})

test('интерфейс явно сообщает формулу высоты правильного октаэдра', () => {
  assert.match(html, /h = a·√\(2\/3\)/)
  assert.match(app, /regularOctahedronHeightMm/)
})

test('результирующая таблица показывает N, V, M и эквивалентное напряжение', () => {
  assert.match(html, /<th>N, кН<\/th>/)
  assert.match(html, /<th>V, кН<\/th>/)
  assert.match(html, /<th>M, Н·м<\/th>/)
  assert.match(html, /<th>σэкв, МПа<\/th>/)
})

test('версия пользовательского прототипа обновлена до 0.6', () => {
  assert.match(html, /прототип 0\.6/)
})
