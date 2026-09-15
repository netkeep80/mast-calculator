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
import {
  MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE,
  PROJECT_PACKAGE_SCHEMA_V1,
  WIND_ACTION_MODE_SP20_MEAN_V1,
} from '../packages/domain/index.js'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

test('project package presentation uses canonical project/v2, shared DOM mapping and an environment file adapter', () => {
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

test('project/v1 migrates historical load factors explicitly into project/v2 manual-migrated-v1 actions', () => {
  const currentProject = createProjectInput({
    geometry: { moduleCount: 3 },
    environment: { windPresetId: 'custom', windPressurePa: 380 },
  })
  const { loadActions: _currentLoadActions, ...legacyGroups } = currentProject
  const legacyPackage = {
    schema: PROJECT_PACKAGE_SCHEMA_V1,
    project: {
      ...legacyGroups,
      environment: {
        ...currentProject.environment,
        deadLoadFactor: 1.1,
        windLoadFactor: 1.4,
      },
      equipment: {
        ...currentProject.equipment,
        loadFactor: 1.1,
      },
    },
  }

  const migrated = parseProjectPackage(JSON.stringify(legacyPackage))
  assert.equal(migrated.schema, PROJECT_PACKAGE_SCHEMA)
  assert.equal(migrated.project.loadActions.profile, MANUAL_MIGRATED_V1_LOAD_ACTION_PROFILE)
  assert.equal(migrated.project.loadActions.steelSelfWeightLoadFactor, 1.1)
  assert.equal(migrated.project.loadActions.iceLoadFactor, 1.1)
  assert.equal(migrated.project.loadActions.equipmentLoadFactor, 1.1)
  assert.equal(migrated.project.loadActions.windLoadFactor, 1.4)
  assert.equal('deadLoadFactor' in migrated.project.environment, false)
  assert.equal('windLoadFactor' in migrated.project.environment, false)
  assert.equal('loadFactor' in migrated.project.equipment, false)
})

test('project/v2 round-trips optional SP20 wind fields without a schema fork', () => {
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

  const handAuthoredSp20 = JSON.parse(serializeProjectPackage(createProjectPackage(sp20Project)))
  delete handAuthoredSp20.project.environment.windPressurePa
  const withoutPressure = parseProjectPackage(JSON.stringify(handAuthoredSp20))
  assert.equal(withoutPressure.project.environment.windPressurePa, undefined)
  assert.equal(withoutPressure.project.environment.windActionMode, WIND_ACTION_MODE_SP20_MEAN_V1)

  const invalidRegion = JSON.parse(serializeProjectPackage(createProjectPackage(sp20Project)))
  invalidRegion.project.environment.windRegion = 'VIII'
  assert.throws(() => parseProjectPackage(JSON.stringify(invalidRegion)), /windRegion не поддерживается/)

  const manualWithoutPressure = JSON.parse(serializeProjectPackage(legacyPackage))
  delete manualWithoutPressure.project.environment.windPressurePa
  assert.throws(() => parseProjectPackage(JSON.stringify(manualWithoutPressure)), /windPressurePa/)
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
