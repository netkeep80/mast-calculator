import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const html = fs.readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../apps/web/app.js', import.meta.url), 'utf8')
const mainForm = fs.readFileSync(new URL('../apps/web/main-project-form.js', import.meta.url), 'utf8')
const calculationController = fs.readFileSync(new URL('../apps/web/calculation-controller.js', import.meta.url), 'utf8')
const bootstrap = fs.readFileSync(new URL('../apps/web/app-bootstrap.js', import.meta.url), 'utf8')
const projectPackageUi = fs.readFileSync(new URL('../apps/web/project-package-ui.js', import.meta.url), 'utf8')
const usage = fs.readFileSync(new URL('../apps/web/usage-scenarios.js', import.meta.url), 'utf8')
const viewer = fs.readFileSync(new URL('../apps/web/viewer.js', import.meta.url), 'utf8')
const moduleViewer = fs.readFileSync(new URL('../apps/web/module-viewer.js', import.meta.url), 'utf8')
const jointViewer = fs.readFileSync(new URL('../apps/web/joint-viewer.js', import.meta.url), 'utf8')
const jointVisualGeometry = fs.readFileSync(new URL('../packages/design/src/joint-visual-geometry.js', import.meta.url), 'utf8')
const worker = fs.readFileSync(new URL('../apps/web/calculation-worker.js', import.meta.url), 'utf8')

test('UI не позволяет вручную вводить геометрию правильного октаэдра', () => {
  assert.match(html, /name="moduleHeightMm"[^>]*readonly/)
  assert.match(html, /name="ribCutLengthMm"[^>]*readonly/)
  assert.doesNotMatch(html, /name="moduleHeightMm"[^>]*(?:min|step)=/)
})

test('модуль зафиксирован ножками вниз и отдельного closeTopRing в UI больше нет', () => {
  assert.match(html, /правильный октаэдр ножками вниз/i)
  assert.match(html, /верхн(?:ий|его) треугольник/i)
  assert.doesNotMatch(html, /name="closeTopRing"/)
  assert.doesNotMatch(app, /closeTopRing/)
})

test('практические параметры закупки и материала остаются выпадающими списками', () => {
  for (const name of ['stockBarLengthMm', 'stockBarPieces', 'barDiameterMm', 'reinforcementClass']) {
    assert.match(html, new RegExp(`<select name="${name}">`))
  }
})

test('конфигуратор узла использует выпадающие списки и русский автоподбор', () => {
  for (const name of [
    'jointConfiguratorMode', 'jointBoltDiameterMm', 'jointBoltClass',
    'jointClearanceNutThreadMm', 'jointBoltLengthMm', 'jointThreadEngagementFactor',
    'weldConsumableId', 'weldLegMm', 'weldSegmentsPerEnd',
  ]) assert.match(html, new RegExp(`<select name="${name}">`))
  assert.match(html, /подбирается автоматически/i)
  assert.match(html, /Гайка ножки с проходом болта/i)
  assert.match(html, /длинн(?:ая|ой) соединительн(?:ая|ой) гайк/i)
  assert.match(bootstrap, /modeSelect\.value = 'auto'/)
  assert.match(bootstrap, /jointConfiguratorMode/)
  assert.match(bootstrap, /subscribeCalculationResult/)
  assert.doesNotMatch(bootstrap, /message\.action|JointAwareWorker|globalThis\.Worker\s*=/)
})

test('эффективный радиус и длинная гайка являются производными параметрами', () => {
  assert.match(html, /name="jointEffectiveRadiusMm"[^>]*readonly/)
  assert.match(html, /name="jointCouplingNutDescription"[^>]*readonly/)
  assert.match(bootstrap, /geometry\.effectiveRadiusMm/)
  assert.match(bootstrap, /topCouplingNut/)
})

test('отдельное 3D-окно показывает текстурированный узел, 4+2 ребра, контакты и сварку', () => {
  assert.match(html, /id="joint-canvas"/)
  assert.match(html, /двух гаек и болта|две гайки и болт/i)
  assert.match(jointViewer, /class JointViewer/)
  assert.match(jointViewer, /buildJointVisualGeometry/)
  assert.match(jointViewer, /drawTexturedFace/)
  assert.match(jointViewer, /красный — зона углового шва/)
  assert.match(jointViewer, /4 ребра длинной гайки/)
  assert.match(jointViewer, /2 ребра проходной гайки/)
  assert.match(jointVisualGeometry, /topCouplingNut/)
  assert.match(jointVisualGeometry, /bottomClearanceNut/)
  assert.match(jointVisualGeometry, /representativeOctahedronJointDirections/)
  assert.match(jointVisualGeometry, /angleToFacePlaneDeg/)
  assert.match(jointVisualGeometry, /weldStartPoint/)
  assert.match(bootstrap, /new JointViewer/)
})

test('issue #33 добавляет параметры момента затяжки, сечения гаек и эффективной площади шва', () => {
  for (const token of [
    'jointTighteningTorqueNm', 'jointNutFactor', 'jointPreloadVariation',
    'jointNutSectionAreaRatio', 'weldToRibAreaRatio',
  ]) assert.match(bootstrap, new RegExp(token))
  assert.match(bootstrap, /F0=T\/\(K·d\)/)
  assert.match(bootstrap, /нетто-сечение каждой гайки/i)
  assert.match(bootstrap, /эффективная площадь шва/i)
})

test('логотип из корня репозитория подключён в шапке приложения', () => {
  assert.match(html, /class="brand-logo"/)
  assert.match(html, /src="\.\/logo\.jpg"/)
  assert.match(html, /alt="Логотип калькулятора мачты"/)
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
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /name="heightSearchMaxModules"/)
  assert.match(app, /heightCapacity/)
  assert.match(app, /bottomModuleAtFirstDesignOverload/)
})

test('погодные явления выбираются из выпадающего списка вплоть до урагана', () => {
  assert.match(html, /<select name="windPresetId"><\/select>/)
  assert.match(mainForm, /WEATHER_PRESETS/)
  assert.match(mainForm, /getWeatherPreset/)
  assert.match(html, /Скорость:/)
  assert.match(html, /name="windSpeedMs"[^>]*readonly/)
})

test('ручное ветровое давление сохраняется как отдельный пользовательский режим', () => {
  assert.match(mainForm, /CUSTOM_WIND_PRESET_ID/)
  assert.match(mainForm, /previewProjectConfiguration/)
  assert.match(mainForm, /resolved\.weather\.custom/)
  assert.match(mainForm, /resolved\.weather\.pressurePa/)
  assert.match(mainForm, /resolved\.weather\.speedMs/)
  assert.doesNotMatch(mainForm, /windPressureFromSpeedMs|windSpeedFromPressurePa/)
})

test('боковой и статический расчёты предыдущей версии остаются в интерфейсе', () => {
  for (const id of [
    'metric-lateral-capacity', 'metric-lateral-buckling', 'metric-lateral-bolt', 'metric-lateral-mode',
    'metric-static-payload', 'metric-static-reserve', 'metric-water-volume', 'metric-static-mode',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(app, /globalBucklingForceKgf/)
  assert.match(app, /boltLimitForceKgf/)
  assert.match(app, /maximumTotalTopMassKg/)
  assert.match(app, /equivalentWaterVolumeM3/)
})

test('соединения и сварка не потеряны при упрощении конфигуратора', () => {
  for (const id of [
    'metric-bolt-utilization', 'metric-bolt-joint', 'metric-weld-length',
    'bolt-recommendations-body', 'weld-results-body', 'weld-recommendation',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(app, /renderConnections/)
  assert.match(app, /requiredPhysicalLengthMm/)
})

test('многоуровневый паспорт верификации остаётся видимым', () => {
  for (const id of [
    'metric-verification', 'verification-summary-card', 'verification-summary',
    'verification-details', 'verification-levels', 'verification-checks',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(app, /renderVerification/)
  assert.match(app, /Как проверить самому/)
})

test('тяжёлый расчёт остаётся в модульном Web Worker и проходит через application API', () => {
  assert.match(app, /createCalculationController/)
  assert.match(calculationController, /new Worker\('\.\/calculation-worker\.js', \{ type: 'module' \}\)/)
  assert.match(worker, /calculateProject/)
  assert.match(worker, /optimizeAndCalculateProject/)
  assert.doesNotMatch(worker, /\boptimizeProject\b/)
  assert.doesNotMatch(worker, /augmentVerificationWithModuleChecks/)
  assert.doesNotMatch(worker, /calculateCompleteMastWithConfiguredJoint/)
  assert.doesNotMatch(worker, /selectUniformDiameter/)
  assert.doesNotMatch(app, /\bcalculateMast\(/)
  assert.doesNotMatch(usage, /\bcalculateMast\(/)
})

test('progress показывает отдельный этап поиска максимальной высоты', () => {
  for (const id of [
    'calculation-progress', 'progress-stage', 'progress-percent', 'progress-bar',
    'progress-detail', 'progress-elapsed', 'progress-eta', 'cancel-calculation-button',
  ]) assert.match(html, new RegExp(`id="${id}"`))
  assert.match(app, /height-capacity/)
  assert.match(app, /Поиск максимальной высоты/)
  assert.match(calculationController, /\.terminate\(\)/)
  assert.match(calculationController, /function cancel/)
  assert.doesNotMatch(app, /activeWorker/)
})

test('бумажный расчёт и portable project JSON остаются разными пользовательскими артефактами', () => {
  assert.match(html, /id="export-note-button"[^>]*>Скачать бумажный расчётный проект</)
  assert.match(projectPackageUi, /export-project-package-button/)
  assert.match(projectPackageUi, /open-project-package-button/)
  assert.match(projectPackageUi, /createProjectPackage/)
  assert.match(projectPackageUi, /parseProjectPackage/)
  assert.match(projectPackageUi, /serializeProjectPackage/)
  assert.match(bootstrap, /initializeProjectPackageUi\(form/)
  assert.doesNotMatch(app, /createCalculationJson/)
})

test('результирующие таблицы показывают N, V, M и эквивалентное напряжение', () => {
  assert.match(html, /<th>N, кН<\/th>/)
  assert.match(html, /<th>V, кН<\/th>/)
  assert.match(html, /<th>M, Н·м<\/th>/)
  assert.match(html, /<th>σэкв, МПа<\/th>/)
})

test('пользовательский прототип обновлён до 1.3 и название страницы русское', () => {
  assert.match(html, /прототип 1\.3/)
  assert.match(html, /<title>Калькулятор мачты<\/title>/)
  assert.doesNotMatch(html, /Mast Calculator/)
})
