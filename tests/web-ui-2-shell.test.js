import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = (...parts) => path.join(root, 'apps', 'web', ...parts)
const read = (name) => fs.readFileSync(web(name), 'utf8')
const index = read('index.html')
const styles = read('workspace.css')
const behavior = read('workspace-behavior.js')
const bootstrap = read('app-bootstrap.js')
const projectPackageUi = read('project-package-ui.js')
const runtimeInfo = read('runtime-info.js')
const resultTabs = read('result-tabs.js')
const resultTabStyles = read('result-tabs.css')
const resultChannel = read('result-channel.js')
const guyResultPanel = read('guy-result-panel.js')
const reportsExports = read('reports-exports.js')

function requires(text, pattern, message) {
  assert.match(text, pattern, message)
}

test('Web UI 2.0 is static source markup, not a runtime migration of the prototype', () => {
  requires(index, /<body data-web-ui="2\.0">/, 'body is not explicitly Web UI 2.0')
  for (const token of ['app-bar', 'workspace-project-pane', 'workspace-view-pane', 'workspace-summary-pane', 'workspace-details']) {
    assert.ok(index.includes(token), `static index is missing ${token}`)
  }
  assert.doesNotMatch(index, /class="page-header"|class="[^"]*scenario-panel|workflow-strip/)
  assert.doesNotMatch(index, /Что вы хотите узнать о мачте\?|прототип\s+1\./i)
  assert.equal(fs.existsSync(web('workspace-shell.js')), false, 'runtime DOM migration shell must be deleted')
  assert.doesNotMatch(bootstrap, /workspace-shell/)
  assert.doesNotMatch(behavior, /createElement|replaceWith|\.remove\(\)|append\(|prepend\(/)
})

test('usage scenarios are compact result views rather than four competing landing cards', () => {
  for (const [id, label] of [['check', 'Проверка'], ['design', 'Подбор'], ['limits', 'Пределы'], ['verify', 'Верификация']]) {
    requires(index, new RegExp(`name="usageScenario"\\s+value="${id}"`), `missing scenario view ${id}`)
    assert.ok(index.includes(`>${label}</span>`), `missing compact scenario label ${label}`)
  }
  requires(index, /id="usage-scenarios" class="view-switch"/, 'scenario views are not statically in the app bar')
})

test('project package Open/Save live in the top-level project action area', () => {
  requires(index, /id="project-file-actions"/, 'no top-level project file action slot')
  requires(projectPackageUi, /#project-file-actions/, 'project package UI does not use the canonical slot')
  requires(projectPackageUi, /openButton\.textContent = 'Открыть'/, 'Open is not first-level')
  requires(projectPackageUi, /downloadButton\.textContent = 'Сохранить'/, 'Save is not first-level')
})

test('runtime version is supplied by build-info instead of a hardcoded prototype label', () => {
  requires(index, /class="app-version">версия определяется сборкой</, 'static shell lacks runtime version slot')
  requires(runtimeInfo, /fetch\('\.\/build-info\.json'/, 'runtime info does not read build metadata')
  requires(runtimeInfo, /version\.textContent = `v\$\{appVersion\}`/, 'version label does not use appVersion')
  requires(runtimeInfo, /#runtime-info-slot/, 'runtime provenance is not connected to the app bar')
  assert.doesNotMatch(index, /prototype|прототип\s+1\./i)
})

test('workspace behavior is presentation-only and cannot acquire engineering ownership', () => {
  for (const source of [behavior, resultTabs]) {
    assert.doesNotMatch(source, /packages\/(domain|numerics|structural-analysis|engineering|application|design|reporting)/)
    assert.doesNotMatch(source, /calculateProject|analyzeFrame|solveModuleStack|buildLoadCase|checkBoltDemand/)
  }
  assert.doesNotMatch(behavior, /Math\.(sqrt|pow|hypot)|9\.80665|1e9|1e6/)
})

test('all presentation styles are linked before module bootstrap', () => {
  for (const href of ['./workspace.css', './result-tabs.css', './guy-result-panel.css', './reports-exports.css']) {
    assert.ok(index.includes(`<link rel="stylesheet" href="${href}">`), `missing static stylesheet ${href}`)
  }
  const lastStyle = index.lastIndexOf('<link rel="stylesheet"')
  const bootstrapIndex = index.indexOf('<script type="module" src="./app-bootstrap.js"')
  assert.ok(lastStyle >= 0 && bootstrapIndex > lastStyle, 'module bootstrap starts before presentation CSS is declared')
})

test('desktop workspace cannot be widened by legacy min-content controls', () => {
  requires(styles, /grid-template-columns:\s*minmax\(280px, 320px\)\s+minmax\(560px, 1fr\)\s+minmax\(280px, 320px\)/, 'no shrink-safe three-column desktop workspace')
  requires(styles, /\.workspace-layout > \*[\s\S]*min-width:\s*0/, 'primary panes lack min-width:0')
  requires(styles, /\.workspace-project-card \.form-grid\s*\{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/, 'project form keeps min-content overflow')
  requires(styles, /\.workspace-project-card select[\s\S]*max-width:\s*100%/, 'long selects are not constrained')
  requires(styles, /@media \(max-width:\s*1180px\)/, 'two-column breakpoint must remain below 1366-class desktop')
})

test('issue #92: Results stay in the center column while sticky sidebars are active', () => {
  requires(styles, /grid-template-areas:\s*\n\s*'project view summary'\s*\n\s*'project details summary'/, 'desktop Results are not structurally confined between sidebars')
  assert.doesNotMatch(styles, /'details details details'/, 'full-width Results can slide under sticky sidebars again')
  requires(styles, /\.workspace-layout\s*\{[\s\S]*min-width:\s*0/, 'workspace does not remain shrink-safe')
  const breakpoint = styles.match(/@media \(max-width:\s*1180px\)\s*\{([\s\S]*?)@media \(max-width:\s*900px\)/)?.[1] ?? ''
  assert.match(breakpoint, /\.workspace-project-pane[\s\S]*\.workspace-summary-pane[\s\S]*position:\s*static/, 'sidebars remain sticky when result rows widen')
})

test('sticky panes follow the real wrapped app-bar height', () => {
  requires(behavior, /ResizeObserver/, 'app bar height is not observed when toolbar wraps')
  requires(behavior, /--app-bar-height/, 'runtime app-bar height is not published to CSS')
  requires(styles, /top:\s*calc\(var\(--app-bar-height\) \+ \.75rem\)/, 'sticky pane does not use runtime app-bar height')
  requires(styles, /max-height:\s*calc\(100vh - var\(--app-bar-height\) - 1\.5rem\)/, 'sticky pane ignores real app-bar height')
  assert.doesNotMatch(styles, /top:\s*84px/, 'old fixed 84px offset returned')
})

test('desktop-first layout exposes all three primary panes at 1366-class width', () => {
  requires(index, /workspace-project-pane[\s\S]*workspace-view-pane[\s\S]*workspace-summary-pane[\s\S]*workspace-details/, 'static source does not contain the primary workspace order')
  requires(styles, /#mast-canvas[\s\S]*height:\s*calc\(100vh - var\(--app-bar-height\) - 118px\)/, '3D viewport is not tied to toolbar height')
})

test('durable result workspace has accessible presentation-only tabs', () => {
  for (const id of ['summary', 'limits', 'connections', 'guys', 'verification', 'reports']) assert.ok(resultTabs.includes(`id: '${id}'`), `missing result tab ${id}`)
  requires(resultTabs, /setAttribute\('role', 'tablist'\)/, 'no ARIA tablist')
  requires(resultTabs, /setAttribute\('role', 'tab'\)/, 'no ARIA tab semantics')
  requires(resultTabs, /setAttribute\('role', 'tabpanel'\)/, 'no ARIA tabpanel semantics')
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.ok(resultTabs.includes(`event.key === '${key}'`), `no keyboard navigation ${key}`)
  requires(resultTabStyles, /\.result-tabpanel\[hidden\][\s\S]*display:\s*none/, 'hidden tab remains in layout')
})

test('tab switching cannot create a second FEM or engineering path', () => {
  assert.doesNotMatch(resultTabs, /packages\/(domain|numerics|structural-analysis|engineering|application|design|reporting)/)
  assert.doesNotMatch(resultTabs, /calculateProject|analyzeFrame|solveModuleStack|Worker\s*\(|postMessage\s*\(/)
  assert.doesNotMatch(resultTabs, /createWebApplicationState|selectedModuleIndex\s*=/)
  requires(resultTabs, /#module-selector/, 'linked rows do not use the existing module selector/state path')
  requires(resultTabs, /dispatchEvent\(new Event\('change'/, 'row selection bypasses canonical selectModule')
})

test('result tabs reuse one selected physical module for member, connection and guy projections', () => {
  requires(resultTabs, /member\.moduleNumber|moduleNumber = Number/, 'member rows are not linked to physical modules')
  requires(resultTabs, /governingDemand\?\.level/, 'connection rows are not linked to governing interface level')
  requires(resultTabs, /model\?\.members\?\.\[memberId\]\?\.moduleIndex/, 'weld rows do not use canonical member index')
  requires(resultTabs, /cables\[index\]\?\.attachmentLevel/, 'guy rows are not linked to attachment level')
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
  requires(resultChannel, /let latestSnapshot = null/, 'result channel does not retain the latest snapshot')
  requires(resultChannel, /\{ replay = false \} = \{\}/, 'replay is not opt-in/backward compatible')
  requires(resultChannel, /if \(replay && latestSnapshot !== null\) listener\(latestSnapshot\)/, 'late subscriber cannot replay current snapshot')
  requires(guyResultPanel, /\{ replay: true \}/, 'guy presenter can miss a fast calculation')
  requires(resultTabs, /subscribeCalculationResult\([\s\S]*\{ replay: true \}\)/, 'result tabs can miss a fast calculation')
})

test('Reports/Exports is initialized directly and compatibility presentation modules are gone', () => {
  requires(bootstrap, /initializeResultTabs\(\)/, 'bootstrap does not initialize result tabs directly')
  requires(bootstrap, /initializeReportsExports\(\)/, 'bootstrap does not initialize Reports directly')
  requires(bootstrap, /initializeWorkspaceBehavior\(\)/, 'static workspace behavior is not initialized')
  requires(reportsExports, /fileAdapter/, 'Reports workspace does not use the environment file adapter')
  for (const removed of ['workspace-shell.js', 'procurement-export.js', 'design-storage.js', 'navigation.js']) {
    assert.equal(fs.existsSync(web(removed)), false, `${removed} must be physically deleted`)
    assert.doesNotMatch(bootstrap, new RegExp(removed.replace('.', '\\.')))
  }
})
