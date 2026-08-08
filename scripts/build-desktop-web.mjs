import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const webBuild = path.join(root, '_site')
const desktopBuild = path.join(root, '_desktop')
const desktopOverlay = path.join(root, 'apps', 'desktop', 'web')

execFileSync(process.execPath, ['scripts/build-web.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

if (!fs.existsSync(webBuild)) throw new Error('_site not found after build:web')
if (!fs.existsSync(desktopOverlay)) throw new Error('apps/desktop/web not found')

fs.rmSync(desktopBuild, { recursive: true, force: true })
fs.cpSync(webBuild, desktopBuild, { recursive: true })

for (const entry of fs.readdirSync(desktopOverlay, { withFileTypes: true })) {
  if (!entry.isFile()) throw new Error(`Desktop Web overlay must stay flat and explicit: ${entry.name}`)
  fs.copyFileSync(
    path.join(desktopOverlay, entry.name),
    path.join(desktopBuild, 'apps', 'web', entry.name),
  )
}

const forbiddenPatterns = [
  { pattern: /<script\b[^>]*\bsrc=["']https?:\/\//i, reason: 'remote runtime script' },
  { pattern: /<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)["'][^>]*\bhref=["']https?:\/\//i, reason: 'remote runtime style/module' },
  { pattern: /<link\b[^>]*\bhref=["']https?:\/\/[^"']+["'][^>]*\brel=["'](?:stylesheet|modulepreload)["']/i, reason: 'remote runtime style/module' },
  { pattern: /\bfrom\s*["']https?:\/\//i, reason: 'remote JavaScript import' },
  { pattern: /\bimport\s*\(\s*["']https?:\/\//i, reason: 'remote dynamic import' },
]

const scannedExtensions = new Set(['.html', '.js', '.css', '.mjs'])
function scanDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      scanDirectory(fullPath)
      continue
    }
    if (!scannedExtensions.has(path.extname(entry.name))) continue
    const source = fs.readFileSync(fullPath, 'utf8')
    for (const { pattern, reason } of forbiddenPatterns) {
      if (pattern.test(source)) {
        throw new Error(`Desktop offline policy violation (${reason}): ${path.relative(root, fullPath)}`)
      }
    }
  }
}
scanDirectory(desktopBuild)

const browserAdapter = fs.readFileSync(path.join(webBuild, 'apps', 'web', 'file-adapter.js'), 'utf8')
const desktopAdapter = fs.readFileSync(path.join(desktopBuild, 'apps', 'web', 'file-adapter.js'), 'utf8')
if (!/environment:\s*'browser'/.test(browserAdapter)) throw new Error('Canonical Web build lost browser file adapter')
if (!/environment:\s*'tauri'/.test(desktopAdapter)) throw new Error('Desktop overlay did not replace file adapter')
if (desktopAdapter.includes('new Blob(')) throw new Error('Desktop file adapter must not use browser download hacks')

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const desktopBuildInfo = {
  adapter: 'tauri',
  appVersion: String(packageJson.version ?? 'unknown'),
  coreVersion: String(packageJson.version ?? 'unknown'),
  repository: 'netkeep80/mast-calculator',
  ref: process.env.GITHUB_REF ?? 'local',
  sha: process.env.GITHUB_SHA ?? 'development',
  runId: process.env.GITHUB_RUN_ID ?? 'local',
}
const desktopBuildInfoJson = `${JSON.stringify(desktopBuildInfo, null, 2)}\n`
fs.writeFileSync(path.join(desktopBuild, 'desktop-build-info.json'), desktopBuildInfoJson)
fs.writeFileSync(path.join(desktopBuild, 'apps', 'web', 'build-info.json'), desktopBuildInfoJson)

console.log(`Desktop WebView build ready: ${path.relative(root, desktopBuild)} (canonical Web + emitted packages + environment overlay)`)
