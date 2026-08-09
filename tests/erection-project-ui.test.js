import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

test('erection configuration is an editable project/v1 stage rather than an invisible sidecar', () => {
  const adapter = source('apps/web/project-package-ui.js')
  const editor = source('apps/web/erection-editor.js')

  assert.match(adapter, /initializeErectionEditor/)
  assert.match(adapter, /erectionEditor \?\? initializeErectionEditor\(form\)/)
  assert.match(adapter, /editableErection\.read\(\)/)
  assert.match(adapter, /editableErection\?\.apply\(packageValue\.erection\)/)
  assert.match(adapter, /erection === undefined \? \{\} : \{ erection \}/)
  assert.match(editor, /hingeBaseEdgeIndex/)
  assert.match(editor, /attachmentTopCornerIndex/)
  assert.match(editor, /anchorPointM/)
  assert.match(editor, /minimumAngleStepDeg/)
  assert.match(editor, /mode: 'disabled'/)
  assert.match(editor, /mode: 'tilt-up'/)
})

test('erection Web editor owns only user input and cannot become a second solver path', () => {
  const editor = source('apps/web/erection-editor.js')

  assert.doesNotMatch(editor, /structural-analysis/)
  assert.doesNotMatch(editor, /calculateErectionEnvelope|calculateErectionState|generateMastModel/)
  assert.doesNotMatch(editor, /hingeNodeIds|attachmentNodeId|requiredCableTensionN|memberResults|reactionMoments/)
})

test('legacy package remains absence-preserving until the user enables or explicitly disables erection', () => {
  const editor = source('apps/web/erection-editor.js')

  assert.match(editor, /let explicitDisabled = false/)
  assert.match(editor, /return explicitDisabled \? Object\.freeze\(\{ mode: 'disabled' \}\) : undefined/)
  assert.match(editor, /explicitDisabled = value\?\.mode === 'disabled'/)
  assert.match(editor, /enabled\.checked = value\?\.mode === 'tilt-up'/)
})
