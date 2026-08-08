import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { calculateCompleteMastWithConfiguredJoint } from '../packages/application/index.js'
import {
  buildDesignPackage,
  DESIGN_PACKAGE_SCHEMA,
  designResultFromPackage,
  parseDesignPackage,
  serializeDesignPackage,
  buildDetailedMastModel,
  createMastObj,
} from '../packages/design/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

function calculation() {
  return calculateCompleteMastWithConfiguredJoint(resolvedProject({
    moduleCount: 3,
    heightSearchMaxModules: 4,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  }))
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

test('design package JSON имеет устойчивый round-trip без browser persistence contract', () => {
  const result = calculation()
  const designPackage = buildDesignPackage(result, {
    createdAt: '2026-08-07T00:00:00.000Z',
    ref: 'main',
    sha: 'abc123',
  })
  const text = serializeDesignPackage(designPackage)
  const parsed = parseDesignPackage(text)
  assert.deepEqual(parsed, designPackage)
  assert.equal(serializeDesignPackage(parsed), text)
})

test('восстановленный design result строит тот же detailed mesh и OBJ без повторного FEM', () => {
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

test('Web UI exposes design, OBJ, KD and procurement in one Reports workspace', () => {
  const reports = fs.readFileSync(new URL('../apps/web/reports-exports.js', import.meta.url), 'utf8')
  assert.match(reports, /createDesignPackage/)
  assert.match(reports, /serializeDesignPackage/)
  assert.match(reports, /designResultFromPackage/)
  assert.match(reports, /createMastObj/)
  assert.match(reports, /createEskdConstructionDocumentationHtml/)
  assert.match(reports, /createProcurementEstimateFromCalculation/)
  assert.match(reports, /fileAdapter\.saveText/)
  assert.doesNotMatch(reports, /calculateProject|calculateCompleteMast|analyzeFrame|Worker\s*\(|postMessage\s*\(/)
})

test('legacy design URL is compatibility-only and cannot remain a second product shell', () => {
  const designHtml = fs.readFileSync(new URL('../apps/web/design.html', import.meta.url), 'utf8')
  assert.match(designHtml, /http-equiv="refresh" content="0; url=\.\/#reports"/)
  assert.match(designHtml, /href="\.\/#reports"/)
  assert.doesNotMatch(designHtml, /id="export-obj"|id="export-package"|id="joint-canvas"|design-app\.js/)
})
