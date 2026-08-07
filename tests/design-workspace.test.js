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
} from '../apps/web/design-storage.js'
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
  assert.ok(!('cases' in designPackage.result), 'операционные load cases не должны попадать в пакет 3D/КД')
  assert.ok(!('verification' in designPackage.result), 'паспорт верификации не должен дублироваться в пакет 3D/КД')
})

test('design package JSON имеет устойчивый round-trip и localStorage contract', () => {
  const result = calculation()
  const storage = memoryStorage()
  const designPackage = buildDesignPackage(result, {
    createdAt: '2026-08-07T00:00:00.000Z',
    ref: 'main',
    sha: 'abc123',
  })
  const text = serializeDesignPackage(designPackage)
  const parsed = parseDesignPackage(text)
  assert.deepEqual(parsed, designPackage)
  const saved = saveDesignPackage(parsed, storage)
  assert.ok(saved.bytes > 100)
  assert.equal(storage.getItem(DESIGN_PACKAGE_STORAGE_KEY), text)
  assert.deepEqual(loadDesignPackage(storage), designPackage)
})

test('восстановленный design result строит тот же тип detailed mesh и OBJ без повторного FEM', () => {
  const result = calculation()
  const designPackage = buildDesignPackage(result)
  const restored = designResultFromPackage(parseDesignPackage(serializeDesignPackage(designPackage)))
  const mesh = buildDetailedMastModel(restored, { radialSegments: 8 })
  const obj = createMastObj(restored, { radialSegments: 8 })
  assert.equal(restored.model.moduleCount, result.model.moduleCount)
  assert.equal(mesh.statistics.structuralMembers, result.model.members.length)
  assert.match(obj, /g structural_members/)
  assert.match(obj, /g joint_hardware/)
})

test('отдельная страница содержит 3D, OBJ, JSON и КД, а основной UX явно ведёт в неё', () => {
  const designHtml = fs.readFileSync(new URL('../apps/web/design.html', import.meta.url), 'utf8')
  const designApp = fs.readFileSync(new URL('../apps/web/design-app.js', import.meta.url), 'utf8')
  const mainHtml = fs.readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8')
  assert.match(designHtml, /<title>3D и конструкторская документация мачты<\/title>/)
  assert.match(designHtml, /id="export-obj"/)
  assert.match(designHtml, /id="export-package"/)
  assert.match(designHtml, /id="export-eskd"/)
  assert.match(designHtml, /id="joint-canvas"/)
  assert.match(designApp, /buildDesignPackage|serializeDesignPackage|parseDesignPackage|designResultFromPackage/)
  assert.match(designApp, /createMastObj/)
  assert.match(designApp, /createEskdConstructionDocumentationHtml/)
  assert.match(mainHtml, /href="\.\/design\.html"/)
})
