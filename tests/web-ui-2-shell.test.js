import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shell = fs.readFileSync(path.join(root, 'apps', 'web', 'workspace-shell.js'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'apps', 'web', 'workspace.css'), 'utf8')
const index = fs.readFileSync(path.join(root, 'apps', 'web', 'index.html'), 'utf8')
const projectPackageUi = fs.readFileSync(path.join(root, 'apps', 'web', 'project-package-ui.js'), 'utf8')
const runtimeInfo = fs.readFileSync(path.join(root, 'apps', 'web', 'runtime-info.js'), 'utf8')
const resultTabs = fs.readFileSync(path.join(root, 'apps', 'web', 'result-tabs.js'), 'utf8')
const resultTabStyles = fs.readFileSync(path.join(root, 'apps', 'web', 'result-tabs.css'), 'utf8')
const resultChannel = fs.readFileSync(path.join(root, 'apps', 'web', 'result-channel.js'), 'utf8')
const guyResultPanel = fs.readFileSync(path.join(root, 'apps', 'web', 'guy-result-panel.js'), 'utf8')

function requires(text, pattern, message) {
  assert.match(text, pattern, message)
}

test('Web UI 2.0 installs a project / 3D / engineering-result workspace', () => {
  requires(shell, /workspace-project-pane/, 'нет project pane')
  requires(shell, /workspace-view-pane/, 'нет 3D pane')
  requires(shell, /workspace-summary-pane/, 'нет engineering summary pane')
  requires(shell, /workspace-details/, 'нет detail area')
  requires(shell, /legacyMain\.replaceWith\(workspace\)/, 'старый runtime layout не заменяется')
  requires(shell, /legacyHeader\.remove\(\)/, 'старый hero header остаётся видимым')
  requires(shell, /scenarioPanel\?\.remove\(\)/, 'scenario landing остаётся видимым')
})

test('usage scenarios become compact views rather than four competing entry points', () => {
  for (const label of ['Проверка', 'Подбор', 'Пределы', 'Верификация']) {
    assert.ok(shell.includes(label), `нет компактного view preset ${label}`)
  }
  requires(shell, /className = 'view-switch'/, 'scenario grid не превращается в view switch')
  requires(styles, /\.view-switch \.scenario-card > span:not\(\.scenario-card-title\)/, 'старые scenario descriptions не скрываются в app bar')
})

test('project package Open/Save live in the top-level project action area', () => {
  requires(shell, /id = 'project-file-actions'/, 'нет top-level project file action slot')
  requires(projectPackageUi, /#project-file-actions/, 'project package UI не использует новый slot')
  requires(projectPackageUi, /openButton\.textContent = 'Открыть'/, 'Open не является first-level action')
  requires(projectPackageUi, /downloadButton\.textContent = 'Сохранить'/, 'Save не является first-level action')
})

test('runtime version is supplied by build-info instead of the prototype label', () => {
  requires(runtimeInfo, /fetch\('\.\/build-info\.json'/, 'runtime info не читает build metadata')
  requires(runtimeInfo, /version\.textContent = `v\$\{appVersion\}`/, 'version label не берётся из appVersion')
  requires(runtimeInfo, /#runtime-info-slot/, 'runtime provenance не подключён к app bar')
})

test('workspace shell is presentation-only and cannot acquire engineering ownership', () => {
  assert.doesNotMatch(shell, /packages\/(domain|numerics|structural-analysis|engineering|application|design|reporting)/)
  assert.doesNotMatch(shell, /calculateProject|analyzeFrame|solveModuleStack|buildLoadCase|checkBoltDemand/)
  assert.doesNotMatch(shell, /Math\.(sqrt|pow|hypot)|9\.80665|1e9|1e6/)
})

test('workspace CSS is loaded before DOM migration instead of racing shell layout', () => {
  requires(index, /<link rel="stylesheet" href="\.\/workspace\.css">/, 'workspace.css не загружается в head до bootstrap')
  assert.doesNotMatch(shell, /data\.webUiStyles/, 'shell не должен динамически подключать основной layout CSS')
})

test('desktop workspace cannot be widened by legacy min-content controls', () => {
  requires(
    styles,
    /grid-template-columns:\s*minmax\(280px, 330px\)\s+minmax\(0, 1fr\)\s+minmax\(280px, 330px\)/,
    'нет shrink-safe трёхколоночного desktop workspace',
  )
  requires(styles, /\.workspace-layout > \*[\s\S]*min-width:\s*0/, 'primary panes не имеют min-width:0')
  requires(styles, /\.workspace-project-card \.form-grid\s*\{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/, 'project form сохраняет min-content overflow')
  requires(styles, /\.workspace-project-card select[\s\S]*max-width:\s*100%/, 'длинные select не ограничены шириной project pane')
  requires(styles, /@media \(max-width:\s*1180px\)/, 'двухколоночный breakpoint должен быть ниже 1366-class desktop')
})

test('sticky panes follow the real wrapped app-bar height', () => {
  requires(shell, /ResizeObserver/, 'app bar height не отслеживается при переносе toolbar')
  requires(shell, /--app-bar-height/, 'runtime app-bar height не публикуется в CSS')
  requires(styles, /top:\s*calc\(var\(--app-bar-height\) \+ \.75rem\)/, 'sticky pane использует фиксированный top')
  requires(styles, /max-height:\s*calc\(100vh - var\(--app-bar-height\) - 1\.5rem\)/, 'sticky pane не учитывает фактическую высоту app bar')
  assert.doesNotMatch(styles, /top:\s*84px/, 'старый фиксированный offset 84px возвращён')
})

test('desktop-first layout exposes all three primary panes at 1366-class width', () => {
  requires(styles, /grid-template-areas:\s*\n\s*'project view summary'/, 'primary panes не находятся в одной строке desktop workspace')
  requires(styles, /#mast-canvas[\s\S]*height:\s*calc\(100vh - var\(--app-bar-height\) - 118px\)/, '3D viewport не привязан к фактической высоте toolbar')
})

test('durable result workspace has accessible presentation-only tabs', () => {
  for (const id of ['summary', 'limits', 'connections', 'guys', 'verification', 'reports']) {
    assert.ok(resultTabs.includes(`id: '${id}'`), `нет result tab ${id}`)
  }
  requires(resultTabs, /setAttribute\('role', 'tablist'\)/, 'нет ARIA tablist')
  requires(resultTabs, /setAttribute\('role', 'tab'\)/, 'нет ARIA tab semantics')
  requires(resultTabs, /setAttribute\('role', 'tabpanel'\)/, 'нет ARIA tabpanel semantics')
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
    assert.ok(resultTabs.includes(`event.key === '${key}'`), `нет keyboard navigation ${key}`)
  }
  requires(resultTabStyles, /\.result-tabpanel\[hidden\][\s\S]*display:\s*none/, 'скрытая вкладка не исключается из layout')
})

test('tab switching cannot create a second FEM or engineering path', () => {
  assert.doesNotMatch(resultTabs, /packages\/(domain|numerics|structural-analysis|engineering|application|design|reporting)/)
  assert.doesNotMatch(resultTabs, /calculateProject|analyzeFrame|solveModuleStack|Worker\s*\(|postMessage\s*\(/)
  assert.doesNotMatch(resultTabs, /createWebApplicationState|selectedModuleIndex\s*=/)
  requires(resultTabs, /#module-selector/, 'linked rows do not route selection through the existing module selector/state path')
  requires(resultTabs, /dispatchEvent\(new Event\('change'/, 'row selection bypasses the canonical selectModule path')
})

test('result tabs reuse one selected physical module for member, connection and guy projections', () => {
  requires(resultTabs, /member\.moduleNumber|moduleNumber = Number/, 'member rows are not linked to physical modules')
  requires(resultTabs, /governingDemand\?\.level/, 'connection rows are not linked to their governing interface level')
  requires(resultTabs, /model\?\.members\?\.\[memberId\]\?\.moduleIndex/, 'weld rows are not linked through the canonical model member index')
  requires(resultTabs, /cables\[index\]\?\.attachmentLevel/, 'guy rows are not linked to their physical attachment level')
  requires(resultTabs, /module-selected-row/, 'selected module is not projected back into result rows')
})

test('Guys tab is conditional and scenario presets only change result focus', () => {
  requires(resultTabs, /conditional:\s*true/, 'Guys tab is not conditional')
  requires(resultTabs, /button\.hidden = !enabled/, 'Guys tab remains visible for bare projects')
  requires(resultTabs, /check:\s*'summary'/, 'check scenario does not focus Summary')
  requires(resultTabs, /design:\s*'connections'/, 'design scenario does not focus Connections')
  requires(resultTabs, /limits:\s*'limits'/, 'limits scenario does not focus Limits')
  requires(resultTabs, /verify:\s*'verification'/, 'verify scenario does not focus Verification')
})

test('late result presenters replay the current snapshot without changing existing subscribers', () => {
  requires(resultChannel, /let latestSnapshot = null/, 'result channel does not retain the latest presentation snapshot')
  requires(resultChannel, /\{ replay = false \} = \{\}/, 'replay is not opt-in/backward compatible')
  requires(resultChannel, /if \(replay && latestSnapshot !== null\) listener\(latestSnapshot\)/, 'late subscriber cannot replay current snapshot')
  requires(guyResultPanel, /\{ replay: true \}/, 'guy result presenter can miss a fast calculation')
  requires(resultTabs, /subscribeCalculationResult\([\s\S]*\{ replay: true \}\)/, 'result tabs can miss a fast calculation')
})

test('tab styles are loaded before result DOM migration', () => {
  requires(shell, /loadPresentationStylesheet\('\.\/result-tabs\.css', 'data-result-tabs-styles'\)/, 'result tab CSS is not preloaded')
  requires(shell, /loadPresentationStylesheet\('\.\/guy-result-panel\.css', 'data-guy-result-styles'\)/, 'guy result CSS is not preloaded')
  requires(shell, /Promise\.all\([\s\S]*\.then\(\(\) => import\('\.\/result-tabs\.js'\)\)/, 'tab DOM migration can race its styles')
})
