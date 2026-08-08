import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shell = fs.readFileSync(path.join(root, 'apps', 'web', 'workspace-shell.js'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'apps', 'web', 'workspace.css'), 'utf8')
const projectPackageUi = fs.readFileSync(path.join(root, 'apps', 'web', 'project-package-ui.js'), 'utf8')
const runtimeInfo = fs.readFileSync(path.join(root, 'apps', 'web', 'runtime-info.js'), 'utf8')

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

test('desktop-first layout exposes all three primary panes at 1366-class width', () => {
  requires(styles, /grid-template-columns:\s*minmax\(300px, 350px\)\s+minmax\(470px, 1fr\)\s+minmax\(290px, 350px\)/, 'нет трёхколоночного desktop workspace')
  requires(styles, /grid-template-areas:\s*\n\s*'project view summary'/, 'primary panes не находятся в одной строке desktop workspace')
  requires(styles, /#mast-canvas[\s\S]*height:\s*calc\(100vh - 190px\)/, '3D viewport не привязан к первому экрану')
})
