import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../site/index.html', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../site/app.js', import.meta.url), 'utf8')
const viewer = fs.readFileSync(new URL('../site/viewer.js', import.meta.url), 'utf8')
const moduleViewer = fs.readFileSync(new URL('../site/module-viewer.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../site/calculation-worker.js', import.meta.url), 'utf8')

test('UI не позволяет вручную вводить геометрию правильного октаэдра', () => {
  assert.match(html, /name="moduleHeightMm"[^>]*readonly/)
  assert.match(html, /name="ribCutLengthMm"[^>]*readonly/)
  assert.doesNotMatch(html, /name="moduleHeightMm"[^>]*(?:min|step)=/)
})

test('модуль зафиксирован ножками вниз и отдельного closeTopRing в UI больше нет', () => {
  assert.match(html, /каждый модуль устанавливается ножками вниз/i)
  assert.match(html, /верхняя грань последнего модуля уже существует/i)
  assert.doesNotMatch(html, /name="closeTopRing"/)
  assert.doesNotMatch(app, /closeTopRing/)
})

test('практические параметры закупки, материала и соединений остаются доступны', () => {
  for (const name of ['stockBarLengthMm', 'stockBarPieces', 'barDiameterMm', 'reinforcementClass']) {
    assert.match(html, new RegExp(`<select name="${name}">`))
  }
  for (const name of ['jointBoltDiameterMm', 'jointBoltClass', 'weldConsumableId']) {
    assert.match(html, new RegExp(`<select name="${name}">`))
  }
  assert.match(app, /BOLT_DIAMETERS_MM/)
  assert.match(app, /WELD_CONSUMABLES/)
})

test('главная схема позволяет выбрать физический модуль кликом или select', () => {
  assert.match(html, /id="module-selector"/)
  assert.match(viewer, /pickModule/)
  assert.match(viewer, /selectedModuleIndex/)
  assert.match(viewer, /onModuleSelect/)
  assert.match(app, /selectModule/)
  assert.match(app, /populateModuleSelector/)
})

test('есть второе окно подробной визуализации выбранного модуля с силами и моментами', () => {
  for (const id of ['module-canvas', 'module-detail-summary', 'module-interface-body', 'module-member-body']) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(moduleViewer, /topAppliedFromAbove/)
  assert.match(moduleViewer, /bottomReactionFromBelow/)
  assert.match(moduleViewer, /N=/)
  assert.match(moduleViewer, /V=/)
  assert.match(moduleViewer, /M=/)
  assert.match(app, /renderSelectedModule/)
})

test('ведомость рёбер группируется по модулям и сортируется по расчётным параметрам', () => {
  for (const id of ['member-group-mode', 'member-sort-field', 'member-sort-direction']) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(html, /<th>Модуль<\/th>/)
  assert.match(app, /memberComparator/)
  assert.match(app, /member-group-row/)
  assert.match(app, /moduleNumber/)
})

test('интерфейс показывает максимальную проектную и предельную высоту и механизм нижнего модуля', () => {
  for (const id of [
    'metric-height-design', 'metric-height-modules', 'metric-height-ultimate',
    'metric-bottom-failure', 'height-capacity-description',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(html, /name="heightSearchMaxModules"/)
  assert.match(app, /heightCapacity/)
  assert.match(app, /bottomModuleAtFirstDesignOverload/)
  assert.match(app, /tensile-rupture/)
  assert.match(app, /local-member-buckling/)
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

test('боковой и статический расчёты предыдущей версии остаются в интерфейсе', () => {
  for (const id of [
    'metric-lateral-capacity', 'metric-lateral-buckling', 'metric-lateral-bolt', 'metric-lateral-mode',
    'metric-static-payload', 'metric-static-reserve', 'metric-water-volume', 'metric-static-mode',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(app, /globalBucklingForceKgf/)
  assert.match(app, /boltLimitForceKgf/)
  assert.match(app, /maximumTotalTopMassKg/)
  assert.match(app, /equivalentWaterVolumeM3/)
})

test('соединения и сварка не потеряны при добавлении модульного интерфейса', () => {
  for (const id of [
    'metric-bolt-utilization', 'metric-bolt-joint', 'metric-weld-length',
    'bolt-recommendations-body', 'weld-results-body', 'weld-recommendation',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(app, /renderConnections/)
  assert.match(app, /requiredPhysicalLengthMm/)
})

test('многоуровневый паспорт верификации остаётся видимым', () => {
  for (const id of [
    'metric-verification', 'verification-summary-card', 'verification-summary',
    'verification-details', 'verification-levels', 'verification-checks',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(html, /помодульной Schur-конденсацией/i)
  assert.match(app, /renderVerification/)
  assert.match(app, /Как проверить самому/)
})

test('тяжёлый расчёт остаётся в модульном Web Worker', () => {
  assert.match(app, /new Worker\('\.\/calculation-worker\.js', \{ type: 'module' \}\)/)
  assert.match(worker, /calculateCompleteMast/)
  assert.match(worker, /selectUniformDiameter/)
  assert.doesNotMatch(app, /\bcalculateMast\(/)
  assert.doesNotMatch(app, /\bcalculateCompleteMast\(/)
})

test('progress показывает отдельный этап поиска максимальной высоты', () => {
  for (const id of [
    'calculation-progress', 'progress-stage', 'progress-percent', 'progress-bar',
    'progress-detail', 'progress-elapsed', 'progress-eta', 'cancel-calculation-button',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(app, /height-capacity/)
  assert.match(app, /Поиск максимальной высоты/)
  assert.match(app, /activeWorker\.terminate\(\)/)
})

test('бумажный проект доступен, пользовательского JSON-экспорта нет', () => {
  assert.match(html, /id="export-note-button"[^>]*>Скачать расчётный проект</)
  assert.doesNotMatch(html, /export-json-button/)
  assert.doesNotMatch(app, /createCalculationJson/)
})

test('результирующие таблицы показывают N, V, M и эквивалентное напряжение', () => {
  assert.match(html, /<th>N, кН<\/th>/)
  assert.match(html, /<th>V, кН<\/th>/)
  assert.match(html, /<th>M, Н·м<\/th>/)
  assert.match(html, /<th>σэкв, МПа<\/th>/)
})

test('версия пользовательского прототипа обновлена до 1.1', () => {
  assert.match(html, /прототип 1\.1/)
})
