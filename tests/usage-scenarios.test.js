import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const html = fs.readFileSync(path.join(root, 'apps', 'web', 'index.html'), 'utf8')
const scenarios = fs.readFileSync(path.join(root, 'apps', 'web', 'usage-scenarios.js'), 'utf8')
const reference = fs.readFileSync(path.join(root, 'apps', 'web', 'reference-catalog.js'), 'utf8')

function hasScenario(value) {
  return new RegExp(`name="usageScenario"\\s+value="${value}"`).test(html)
}

test('интерфейс начинается с четырёх понятных пользовательских сценариев', () => {
  for (const id of ['check', 'design', 'limits', 'verify']) assert.ok(hasScenario(id), `нет сценария ${id}`)
  assert.match(html, /Проверить конкретную мачту/)
  assert.match(html, /Подобрать конструкцию/)
  assert.match(html, /Узнать пределы/)
  assert.match(html, /Проверить расчёт/)
})

test('ручной ввод отделён от автоматически вычисляемых величин', () => {
  assert.match(html, /name="ribCutLengthMm"[^>]*readonly/)
  assert.match(html, /name="moduleHeightMm"[^>]*readonly/)
  assert.match(html, /id="preview-rib-mass"/)
  assert.match(html, /Соединительный узел — обычно подбирается автоматически/)
  assert.match(html, /Инженерные коэффициенты и ограничения/)
})

test('главный ответ отделён от полного набора подробных метрик', () => {
  assert.match(html, /id="scenario-answer"/)
  assert.match(html, /id="scenario-answer-status"/)
  assert.match(html, /id="scenario-key-metrics"/)
  assert.match(html, /<details id="all-metrics-details"/)
  assert.match(html, /Как программа получила этот ответ\?/)
})

test('в интерфейсе явно присутствуют требуемые массы физической сборки', () => {
  assert.match(html, /id="metric-rib-mass"/)
  assert.match(html, /id="metric-joint-mass"/)
  assert.match(html, /id="metric-module-mass"/)
  assert.match(html, /Один полный узел со сваркой/)
  assert.match(html, /Сваренный и закреплённый модуль/)
})

test('справочники арматуры, крепежа и сварочных материалов доступны из интерфейса', () => {
  for (const id of [
    'reference-rebar-classes',
    'reference-rebar-diameters',
    'reference-bolt-classes',
    'reference-bolt-sizes',
    'reference-regular-nuts',
    'reference-coupling-nuts',
    'reference-welding',
  ]) assert.ok(html.includes(`id="${id}"`), `нет справочника ${id}`)
  assert.match(reference, /buildReferenceData/)
  assert.doesNotMatch(reference, /yieldStrengthMPa:\s*500/)
  assert.doesNotMatch(reference, /rbtMPa:\s*451/)
})

test('сценарный слой не создаёт второй FEM solver или инженерный расчётный путь', () => {
  assert.doesNotMatch(scenarios, /analyzeFrame/)
  assert.doesNotMatch(scenarios, /compileFrameSystem/)
  assert.doesNotMatch(scenarios, /solveModuleStack/)
  assert.doesNotMatch(scenarios, /calculateAssemblyMass|reinforcementMassPerMeterKg|theoreticalCutLengthMm/)
  assert.match(scenarios, /previewRibFabrication/)
  assert.match(scenarios, /result\.assemblyMass/)
  assert.match(scenarios, /renderScenarioResult/)
})