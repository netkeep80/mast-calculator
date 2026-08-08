import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')
const exists = (relativePath) => fs.existsSync(path.join(sourceRoot, relativePath))

test('integrated guy editor belongs to the canonical project form and public catalogs', () => {
  const editor = source('apps/web/guy-editor.js')
  const bootstrap = source('apps/web/app-bootstrap.js')

  assert.match(editor, /previewProjectGeometry/)
  assert.match(editor, /readProjectInputFromForm/)
  assert.match(editor, /DEFAULT_GUY_WIRE_ID/)
  assert.match(editor, /GUY_WIRE_CATALOG/)
  assert.match(bootstrap, /initializeGuyEditor\(form\)/)
  assert.doesNotMatch(editor, /mastFieldMap|calculateProject|calculateGuyedProject|calculateGuyedMast/)
  assert.doesNotMatch(editor, /packages\/(engineering|numerics|structural-analysis)/)
})

test('guy editor stores only user-owned project inputs, never derived cable results', () => {
  const editor = source('apps/web/guy-editor.js')

  for (const field of [
    'heightM', 'guyCount', 'anchorRadiusM', 'pretensionN', 'azimuthOffsetDeg', 'wireId',
    'safetyFactor', 'terminationEfficiency',
  ]) {
    assert.ok(editor.includes(field), `editable guy field missing: ${field}`)
  }

  assert.doesNotMatch(editor, /\btensionN\s*:|angleToHorizontalDeg\s*:|anchorLoadN\s*:|moduleNodeReactionN\s*:|designLengthM\s*:/)
})

test('guy editor can explicitly disable or restore ProjectPackage.guys', () => {
  const editor = source('apps/web/guy-editor.js')

  assert.match(editor, /if \(!enabled\.checked\) return undefined/)
  assert.match(editor, /const hasGuys = Boolean\(value\?\.tiers\?\.length\)/)
  assert.match(editor, /enabled\.checked = hasGuys/)
  assert.match(editor, /rebuild\(hasGuys \? value\.tiers\.length : 2/)
})

test('guy editor validates the durable ProjectGuysInput ranges before persistence', () => {
  const editor = source('apps/web/guy-editor.js')

  assert.match(editor, /tier\.guyCount < 3 \|\| tier\.guyCount > 6/)
  assert.match(editor, /tier\.pretensionN < 0/)
  assert.match(editor, /value\.safetyFactor > 0/)
  assert.match(editor, /value\.terminationEfficiency > 0 && value\.terminationEfficiency <= 1/)
})

test('legacy guys page is only a deep-link redirect and owns no second mast form', () => {
  const guysPage = source('apps/web/guys.html')
  assert.match(guysPage, /index\.html#guys/)
  assert.doesNotMatch(guysPage, /id="module-count"|id="bar-diameter"|id="wind-pressure"|id="calculate-guys"/)
  assert.equal(exists('apps/web/guys-app.js'), false)
  assert.equal(exists('apps/web/guy-procurement-sync.js'), false)
})

test('one Worker/controller transport owns bare and guyed project calculation', () => {
  const controller = source('apps/web/calculation-controller.js')
  const worker = source('apps/web/calculation-worker.js')
  const guyState = source('apps/web/guy-project-state.js')

  assert.match(controller, /currentProjectGuys\(\)/)
  assert.match(controller, /guys: projectGuys/)
  assert.match(worker, /calculateProjectWithGuys/)
  assert.doesNotMatch(worker, /packages\/(engineering|numerics|structural-analysis)/)
  assert.match(guyState, /getGuyEditor\(\)\?\.read\(\)/)
  assert.doesNotMatch(controller + worker + guyState, /mastFieldMap/)
})
