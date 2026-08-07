import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PROJECT_INPUT,
  MastApplicationError,
  PROJECT_PACKAGE_SCHEMA,
  ProjectSchemaError,
  calculateProject,
  createProjectInput,
  createProjectPackage,
  parseProjectPackage,
  resolveProjectInput,
  serializeProjectPackage,
  validateProjectInput,
} from '../packages/application/index.js'

test('ProjectInput is grouped, user-only and rejects derived/dead fields', () => {
  const input = createProjectInput({ geometry: { moduleCount: 3 } })
  assert.equal(input.geometry.moduleCount, 3)
  assert.equal('ribCutLengthMm' in input.geometry, false)
  assert.equal('yieldStrengthMPa' in input.material, false)
  assert.equal('extraHorizontalLoadN' in input.environment, false)
  assert.equal('extraVerticalLoadN' in input.environment, false)
  assert.equal('jointEffectiveRadiusMm' in input.connection, false)

  assert.throws(() => createProjectInput({ geometry: { ribCutLengthMm: 750 } }), /Неизвестные поля ProjectInput\.geometry/)
  assert.throws(() => createProjectInput({ environment: { extraHorizontalLoadN: 1 } }), /Неизвестные поля ProjectInput\.environment/)
  assert.throws(() => createProjectInput({ connection: { jointEffectiveRadiusMm: 18 } }), /Неизвестные поля ProjectInput\.connection/)
})

test('ProjectInput resolves once into derived ResolvedProject values', () => {
  const resolved = resolveProjectInput(DEFAULT_PROJECT_INPUT)
  assert.ok(Number.isFinite(resolved.ribCutLengthMm))
  assert.ok(Number.isFinite(resolved.moduleHeightMm))
  assert.ok(Number.isFinite(resolved.windSpeedMs))
  assert.ok(Number.isFinite(resolved.yieldStrengthMPa))
  assert.ok(Number.isFinite(resolved.jointBaseMetalTensileStrengthMPa))
  assert.equal('extraHorizontalLoadN' in resolved, false)
  assert.equal('extraVerticalLoadN' in resolved, false)
})

test('versioned project package round-trips and rejects unknown schemas/fields', () => {
  const project = createProjectInput({ geometry: { moduleCount: 2 } })
  const packageValue = createProjectPackage(project)
  assert.equal(packageValue.schema, PROJECT_PACKAGE_SCHEMA)
  assert.deepEqual(parseProjectPackage(serializeProjectPackage(packageValue)), packageValue)

  assert.throws(
    () => parseProjectPackage(JSON.stringify({ schema: 'mast-calculator/project/v999', project })),
    (error) => error instanceof ProjectSchemaError && error.code === 'unsupported-schema',
  )
  assert.throws(
    () => validateProjectInput({ ...project, derived: { moduleHeightMm: 1 } }),
    (error) => error instanceof ProjectSchemaError && error.code === 'invalid-project-input',
  )
  assert.throws(
    () => parseProjectPackage(JSON.stringify({ ...packageValue, legacy: true })),
    (error) => error instanceof ProjectSchemaError && error.code === 'unknown-package-field',
  )
})

test('public calculation returns a deeply immutable complete result', () => {
  const result = calculateProject(createProjectInput({
    geometry: { moduleCount: 1 },
    environment: { windEnvelopeEnabled: false },
    criteria: { heightSearchMaxModules: 1 },
  }))

  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.parameters))
  assert.ok(Object.isFrozen(result.envelope))
  assert.ok(Object.isFrozen(result.verification))
  assert.ok(result.craneBoomCapacity)
  assert.throws(() => { result.parameters.moduleCount = 99 }, TypeError)
})

test('invalid public input is normalized to typed application error', () => {
  const invalid = createProjectInput({ geometry: { moduleCount: 1 } })
  invalid.geometry.moduleCount = 0
  assert.throws(
    () => calculateProject(invalid),
    (error) => error instanceof MastApplicationError
      && error.category === 'input-validation'
      && error.code === 'invalid-module-count',
  )
})
