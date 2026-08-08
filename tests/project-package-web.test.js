import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  PROJECT_PACKAGE_SCHEMA,
  createProjectInput,
  createProjectPackage,
  parseProjectPackage,
  serializeProjectPackage,
} from '../packages/application/index.js'
import { WIND_ACTION_MODE_SP20_MEAN_V1 } from '../packages/domain/index.js'

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

test('project/v1 keeps legacy packages readable and round-trips optional SP20 wind fields without a schema fork', () => {
  const legacyProject = createProjectInput({
    geometry: { moduleCount: 3 },
    environment: { windPresetId: 'custom', windPressurePa: 380 },
  })
  assert.equal(legacyProject.environment.windActionMode, undefined)
  const legacyPackage = createProjectPackage(legacyProject)
  const legacyParsed = parseProjectPackage(serializeProjectPackage(legacyPackage))
  assert.equal(legacyParsed.schema, PROJECT_PACKAGE_SCHEMA)
  assert.deepEqual(legacyParsed.project, legacyProject)
  assert.equal(legacyParsed.project.environment.windActionMode, undefined)

  const sp20Project = createProjectInput({
    geometry: { moduleCount: 8 },
    environment: {
      windActionMode: WIND_ACTION_MODE_SP20_MEAN_V1,
      windRegion: 'III',
      windTerrainType: 'B',
      windPresetId: 'custom',
      windPressurePa: 380,
    },
  })
  const sp20Parsed = parseProjectPackage(serializeProjectPackage(createProjectPackage(sp20Project)))
  assert.equal(sp20Parsed.schema, PROJECT_PACKAGE_SCHEMA)
  assert.deepEqual(sp20Parsed.project, sp20Project)
  assert.equal(sp20Parsed.project.environment.windActionMode, WIND_ACTION_MODE_SP20_MEAN_V1)
  assert.equal(sp20Parsed.project.environment.windRegion, 'III')
  assert.equal(sp20Parsed.project.environment.windTerrainType, 'B')

  const invalid = JSON.parse(serializeProjectPackage(createProjectPackage(sp20Project)))
  invalid.project.environment.windRegion = 'VIII'
  assert.throws(() => parseProjectPackage(JSON.stringify(invalid)), /windRegion не поддерживается/)
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
