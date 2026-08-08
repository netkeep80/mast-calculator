import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const sourceIconPath = path.join(root, 'apps', 'desktop', 'src-tauri', 'icons', 'icon.png')
const staleIcoPath = path.join(root, 'apps', 'desktop', 'src-tauri', 'icons', 'icon.ico')
const configPath = path.join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json')
const buildScriptPath = path.join(root, 'apps', 'desktop', 'src-tauri', 'build.rs')
const packagePath = path.join(root, 'package.json')

const expectedGeneratedIcons = [
  'generated-icons/32x32.png',
  'generated-icons/128x128.png',
  'generated-icons/128x128@2x.png',
  'generated-icons/icon.icns',
  'generated-icons/icon.ico',
]

test('Desktop icon source is a square 32-bit RGBA PNG', () => {
  const png = fs.readFileSync(sourceIconPath)
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), 'desktop icon must be square')
  assert.equal(png[24], 8, 'desktop icon must use 8 bits per channel')
  assert.equal(png[25], 6, 'desktop icon must use RGBA color type')
})

test('Desktop bundles use the generated cross-platform Tauri iconset', () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const buildScript = fs.readFileSync(buildScriptPath, 'utf8')

  assert.equal(fs.existsSync(staleIcoPath), false, 'do not commit a separately maintained icon.ico')
  assert.deepEqual(config.bundle.icon, expectedGeneratedIcons)
  assert.equal(
    packageJson.scripts['prepare:desktop:icons'],
    'npx --yes @tauri-apps/cli@2.11.4 icon apps/desktop/src-tauri/icons/icon.png --output apps/desktop/src-tauri/generated-icons',
  )
  assert.match(buildScript, /window_icon_path\("generated-icons\/icon\.ico"\)/)
})
