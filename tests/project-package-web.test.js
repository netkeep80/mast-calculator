import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

test('project package presentation uses canonical project/v1, shared DOM mapping and an environment file adapter', () => {
  const adapter = source('apps/web/project-package-ui.js')
  const browserFiles = source('apps/web/file-adapter.js')
  const bootstrap = source('apps/web/app-bootstrap.js')

  assert.match(adapter, /createProjectPackage/)
  assert.match(adapter, /parseProjectPackage/)
  assert.match(adapter, /serializeProjectPackage/)
  assert.match(adapter, /readProjectInputFromForm/)
  assert.match(adapter, /applyProjectInputToForm/)
  assert.match(adapter, /fileAdapter as defaultFileAdapter/)
  assert.match(adapter, /fileAdapter\.saveText/)
  assert.match(adapter, /fileAdapter\.openText/)
  assert.doesNotMatch(adapter, /new Blob|URL\.createObjectURL|type = 'file'|file\.text\(\)/)
  assert.match(browserFiles, /new Blob/)
  assert.match(browserFiles, /URL\.createObjectURL/)
  assert.match(browserFiles, /file\.text\(\)/)
  assert.match(bootstrap, /initializeProjectPackageUi\(form/)
  assert.doesNotMatch(adapter, /ribCutLengthMm|moduleHeightMm|jointEffectiveRadiusMm|calculateProject|calculateMast/)
})

test('main project package UI round-trips editable guys instead of retaining an invisible sidecar', () => {
  const adapter = source('apps/web/project-package-ui.js')
  const bootstrap = source('apps/web/app-bootstrap.js')

  assert.match(adapter, /guyEditor \? guyEditor\.read\(\) : retainedGuys/)
  assert.match(adapter, /guyEditor\?\.apply\(packageValue\.guys\)/)
  assert.match(adapter, /editableGuys === undefined \? \{\} : \{ guys: editableGuys \}/)
  assert.match(bootstrap, /const guyEditor = initializeGuyEditor\(form\)/)
  assert.match(bootstrap, /initializeProjectPackageUi\(form, undefined, guyEditor\)/)
})

test('browser file/download APIs remain outside portable packages', () => {
  for (const file of [
    'packages/domain/src/project-package.ts',
    'packages/application/src/result-summary.ts',
    'packages/application/src/use-cases.ts',
  ]) {
    const text = source(file)
    assert.doesNotMatch(text, /\bBlob\b|createObjectURL|localStorage|document\.|window\.|FileReader/)
  }
})
