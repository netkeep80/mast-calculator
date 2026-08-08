import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

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

  assert.doesNotMatch(editor, /tensionN\s*:|angleToHorizontalDeg\s*:|anchorLoadN\s*:|moduleNodeReactionN\s*:|designLengthM\s*:/)
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
