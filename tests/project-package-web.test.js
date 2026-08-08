import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

test('Web project package adapter uses canonical project/v1 parsing and shared DOM mapping', () => {
  const adapter = source('apps/web/project-package-ui.js')
  const bootstrap = source('apps/web/app-bootstrap.js')

  assert.match(adapter, /createProjectPackage/)
  assert.match(adapter, /parseProjectPackage/)
  assert.match(adapter, /serializeProjectPackage/)
  assert.match(adapter, /readProjectInputFromForm/)
  assert.match(adapter, /applyProjectInputToForm/)
  assert.match(adapter, /new Blob/)
  assert.match(adapter, /URL\.createObjectURL/)
  assert.match(adapter, /file\.text\(\)/)
  assert.match(bootstrap, /initializeProjectPackageUi\(form\)/)
  assert.doesNotMatch(adapter, /ribCutLengthMm|moduleHeightMm|jointEffectiveRadiusMm|calculateProject|calculateMast/)
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
