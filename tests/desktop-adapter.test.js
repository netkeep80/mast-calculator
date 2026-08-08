import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const browserFiles = read('apps/web/file-adapter.js')
const projectPackageUi = read('apps/web/project-package-ui.js')
const mainApp = read('apps/web/app.js')
const designApp = read('apps/web/design-app.js')
const desktopFiles = read('apps/desktop/web/file-adapter.js')
const rustMain = read('apps/desktop/src-tauri/src/main.rs')
const capability = JSON.parse(read('apps/desktop/src-tauri/capabilities/main.json'))
const tauriConfig = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'))
const cargo = read('apps/desktop/src-tauri/Cargo.toml')
const desktopBuild = read('scripts/build-desktop-web.mjs')

test('shared presentation delegates all user file I/O to one environment adapter', () => {
  assert.match(projectPackageUi, /fileAdapter as defaultFileAdapter/)
  assert.match(projectPackageUi, /fileAdapter\.saveText/)
  assert.match(projectPackageUi, /fileAdapter\.openText/)
  assert.match(mainApp, /fileAdapter\.saveText/)
  assert.match(designApp, /fileAdapter\.saveText/)
  assert.match(designApp, /fileAdapter\.openText/)
  for (const presentation of [projectPackageUi, mainApp, designApp]) {
    assert.doesNotMatch(presentation, /new Blob\(|createObjectURL|type = 'file'|\.download\s*=/)
  }
  assert.match(browserFiles, /environment:\s*'browser'/)
  assert.match(browserFiles, /new Blob\(/)
  assert.match(browserFiles, /createObjectURL/)
  assert.match(browserFiles, /type = 'file'/)
})

test('desktop file adapter exposes only two custom IPC operations', () => {
  assert.match(desktopFiles, /environment:\s*'tauri'/)
  assert.match(desktopFiles, /__TAURI__\?\.core\?\.invoke/)
  assert.match(desktopFiles, /'open_text_file'/)
  assert.match(desktopFiles, /'save_text_file'/)
  assert.doesNotMatch(desktopFiles, /plugin-fs|plugin-shell|http:|fetch\(/)
  assert.doesNotMatch(desktopFiles, /new Blob\(|createObjectURL/)
  assert.doesNotMatch(desktopFiles, /mediaType/)
})

test('Rust shell reads and writes only paths explicitly returned by native dialogs', () => {
  assert.match(rustMain, /blocking_pick_file\(\)/)
  assert.match(rustMain, /blocking_save_file\(\)/)
  assert.match(rustMain, /fs::read_to_string\(&path\)/)
  assert.match(rustMain, /fs::write\(&path, content\)/)
  assert.match(rustMain, /generate_handler!\[open_text_file, save_text_file\]/)
  assert.doesNotMatch(rustMain, /Command::new|std::process|shell|reqwest|TcpStream/)
})

test('Tauri capability is narrow and CSP is explicitly offline-first', () => {
  assert.deepEqual(capability.windows, ['main'])
  assert.deepEqual(capability.permissions, ['allow-project-files'])
  const csp = tauriConfig.app.security.csp
  assert.equal(csp['default-src'], "'self'")
  assert.match(csp['connect-src'], /ipc:/)
  assert.doesNotMatch(JSON.stringify(csp), /https:\/\/(?!schema\.tauri\.app)/)
  assert.equal(csp['object-src'], "'none'")
  assert.equal(tauriConfig.build.frontendDist, '../../../_desktop')
  assert.equal(tauriConfig.app.withGlobalTauri, true)
})

test('desktop shell pins the reviewed Tauri generation and has no fs/shell/http/updater plugin', () => {
  assert.match(cargo, /tauri = "=2\.11\.5"/)
  assert.match(cargo, /tauri-build = "=2\.6\.3"/)
  assert.match(cargo, /tauri-plugin-dialog = "=2\.7\.2"/)
  assert.doesNotMatch(cargo, /tauri-plugin-(?:fs|shell|http|updater)/)
  assert.doesNotMatch(cargo, /rust-version/)
})

test('desktop WebView is generated from the canonical Web build plus an explicit environment overlay', () => {
  assert.match(desktopBuild, /scripts\/build-web\.mjs/)
  assert.match(desktopBuild, /fs\.cpSync\(webBuild, desktopBuild/)
  assert.match(desktopBuild, /apps', 'desktop', 'web/)
  assert.match(desktopBuild, /file-adapter\.js/)
  assert.match(desktopBuild, /remote runtime script/)
  assert.match(desktopBuild, /remote JavaScript import/)
  assert.doesNotMatch(desktopBuild, /app-copy|desktop-app-copy/)
})
