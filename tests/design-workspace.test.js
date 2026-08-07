import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../packages/application/index.js'
import { calculateCompleteMastWithConfiguredJoint } from '../packages/application/index.js'
import {
  buildDesignPackage,
  DESIGN_PACKAGE_SCHEMA,
  designResultFromPackage,
  parseDesignPackage,
  serializeDesignPackage,
} from '../packages/design/index.js'
import {
  DESIGN_PACKAGE_STORAGE_KEY,
  loadDesignPackage,
  saveDesignPackage,
} from '../site/design-storage.js'
import { buildDetailedMastModel } from '../packages/design/index.js'
import { createMastObj } from '../packages/design/index.js'

function calculation() {
  return calculateCompleteMastWithConfiguredJoint({
    ...DEFAULT_PARAMETERS,
    moduleCount: 3,
    heightSearchMaxModules: 4,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  })
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('design package переносит только производственно значимую геометрию и выбранный узел', () => {
  const result = calculation()
  const designPackage = buildDesignPackage(result, { sha: 'abc123' })
  assert.equal(designPackage.schema, DESIGN_PACKAGE_SCHEMA)
  assert.equal(designPackage.result.model.moduleCount, result.model.moduleCount)
  assert.equal(designPackage.result.model.members.length, result.model.members.length)
  assert.equal(designPackage.result.connections.configurator.geometry.bolt.diameterMm, result.connections.configurator.geometry.bolt.diameterMm)
  assert.equal(designPackage.result.assemblyMass.module.totalMassKg, result.assemblyMass.module.totalMassKg)
  assert.ok(!('cases' in designPackage.result))
  assert.ok(!('heightCapacity' in designPackage.result))
})

test('design package JSON имеет устойчивый round-trip и localStorage contract', () => {
  const designPackage = buildDesignPackage(calculation())
  const text = serializeDesignPackage(designPackage)
  const parsed = parseDesignPackage(text)
  assert.deepEqual(parsed, designPackage)

  const storage = memoryStorage()
  const saved = saveDesignPackage(designPackage, storage)
  assert.ok(saved.bytes > 1000)
  assert.ok(storage.getItem(DESIGN_PACKAGE_STORAGE_KEY)?.includes(DESIGN_PACKAGE_SCHEMA))
  assert.deepEqual(loadDesignPackage(storage), designPackage)
})

test('восстановленный design result строит тот же тип detailed mesh и OBJ без повторного FEM', () => {
  const original = calculation()
  const restored = designResultFromPackage(buildDesignPackage(original))
  const mesh = buildDetailedMastModel(restored, { radialSegments: 8 })
  assert.equal(mesh.statistics.structuralMembers, original.model.members.length)
  assert.ok(mesh.statistics.hardwareObjects > 0)
  const obj = createMastObj(restored, { radialSegments: 8 })
  assert.match(obj, /g structural_members/)
  assert.match(obj, /g joint_hardware/)
  assert.match(obj, /# structural members=/)
})

test('отдельная страница содержит 3D, OBJ, JSON и КД, а основной UX явно ведёт в неё', () => {
  const page = fs.readFileSync(new URL('../site/design.html', import.meta.url), 'utf8')
  const app = fs.readFileSync(new URL('../site/design-app.js', import.meta.url), 'utf8')
  const usage = fs.readFileSync(new URL('../site/usage-scenarios.js', import.meta.url), 'utf8')
  assert.match(page, /Модуль 3D и конструкторской документации/)
  assert.match(page, /Скачать OBJ/)
  assert.match(page, /Скачать КД по ЕСКД/)
  assert.match(page, /Скачать пакет JSON/)
  assert.match(page, /id="mast-canvas"/)
  assert.match(page, /id="joint-canvas"/)
  assert.match(app, /createEskdConstructionDocumentationHtml/)
  assert.match(app, /createMastObj/)
  assert.match(usage, /Открыть 3D и КД/)
  assert.match(usage, /Расчётный проект содержит только расчёты/)
  assert.match(usage, /export-obj-button/)
})
