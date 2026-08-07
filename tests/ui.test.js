import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../site/app.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../site/calculation-worker.js', import.meta.url), 'utf8')

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

test('интерфейс разделяет первый боковой предел и общую потерю устойчивости в кгс', () => {
  assert.match(html, /id="metric-lateral-capacity"/)
  assert.match(html, /id="metric-lateral-buckling"/)
  assert.match(html, /Боковая сила общей потери устойчивости/)
  assert.match(html, /id="metric-lateral-mode"/)
  assert.match(html, /id="lateral-capacity-description"/)
  assert.match(worker, /calculateCompleteMast/)
  assert.match(app, /globalBucklingForceKgf/)
  assert.match(app, /кгс/)
})

test('интерфейс показывает статическую массу вершины, резерв и объём воды', () => {
  assert.match(html, /id="metric-static-payload"/)
  assert.match(html, /id="metric-static-reserve"/)
  assert.match(html, /id="metric-water-volume"/)
  assert.match(html, /id="metric-static-mode"/)
  assert.match(html, /id="static-payload-description"/)
  assert.match(app, /maximumTotalTopMassKg/)
  assert.match(app, /remainingAdditionalMassKg/)
  assert.match(app, /equivalentWaterVolumeM3/)
  assert.match(app, /Статическая нагрузка вершины/)
})

test('интерфейс показывает многоуровневый паспорт верификации понятный неспециалисту', () => {
  for (const id of [
    'metric-verification',
    'verification-summary-card',
    'verification-summary',
    'verification-details',
    'verification-levels',
    'verification-checks',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(html, /Паспорт верификации — проверка по шагам/)
  assert.match(html, /сторонний КЭ-комплекс/)
  assert.match(app, /renderVerification/)
  assert.match(app, /Как проверить самому/)
  assert.match(app, /не проверено/)
})

test('тяжёлый расчёт вынесен из main thread в модульный Web Worker', () => {
  assert.match(app, /new Worker\('\.\/calculation-worker\.js', \{ type: 'module' \}\)/)
  assert.match(worker, /calculateCompleteMast/)
  assert.match(worker, /selectUniformDiameter/)
  assert.doesNotMatch(app, /\bcalculateMast\(/)
  assert.doesNotMatch(app, /\bcalculateCompleteMast\(/)
})

test('UI показывает ход вычисления, прошедшее время, ETA и позволяет отменить worker', () => {
  for (const id of [
    'calculation-progress', 'progress-stage', 'progress-percent', 'progress-bar',
    'progress-detail', 'progress-elapsed', 'progress-eta', 'cancel-calculation-button',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(html, /aria-live="polite"/)
  assert.match(app, /Осталось: ≈/)
  assert.match(app, /activeWorker\.terminate\(\)/)
  assert.match(app, /cancelActiveJob/)
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

test('версия пользовательского прототипа обновлена до 0.9', () => {
  assert.match(html, /прототип 0\.9/)
})
