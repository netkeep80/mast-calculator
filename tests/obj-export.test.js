import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { generateMastModel } from '../packages/structural-analysis/index.js'
import { buildJointHardwareGeometry } from '../packages/domain/index.js'
import { createMastObj } from '../packages/design/index.js'

function fixtureResult(moduleCount = 2, moduleDiametersMm = null) {
  const triangleSideMm = 1000
  const parameters = {
    moduleCount,
    triangleSideMm,
    moduleHeightMm: triangleSideMm * Math.sqrt(2 / 3),
    barDiameterMm: 12,
    moduleDiametersMm,
    youngModulusGPa: 200,
    yieldStrengthMPa: 355,
    tensileStrengthMPa: 500,
    poissonRatio: 0.3,
    densityKgM3: 7850,
    effectiveLengthFactor: 1,
  }
  return {
    parameters,
    model: generateMastModel(parameters),
    connections: {
      configurator: {
        geometry: buildJointHardwareGeometry({
          boltDiameterMm: 24,
          boltClass: '8.8',
          threadEngagementFactor: 2,
        }),
      },
    },
  }
}

function countObjects(obj, prefix) {
  return (obj.match(new RegExp(`^o ${prefix}`, 'gm')) ?? []).length
}

function validateFaceIndices(obj) {
  const vertices = obj.split('\n').filter((line) => line.startsWith('v '))
  const faces = obj.split('\n').filter((line) => line.startsWith('f '))
  assert.ok(vertices.length > 0)
  assert.ok(faces.length > 0)
  for (const face of faces) {
    const indices = face.slice(2).trim().split(/\s+/).map((token) => Number(token.split('/')[0]))
    assert.ok(indices.length >= 3)
    for (const index of indices) assert.ok(index >= 1 && index <= vertices.length)
  }
}

function firstVertexOfObject(obj, name) {
  const lines = obj.split('\n')
  const objectLine = lines.indexOf(`o ${name}`)
  assert.ok(objectLine >= 0, `OBJ object ${name} not found`)
  for (let index = objectLine + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('o ')) break
    if (lines[index].startsWith('v ')) return lines[index].slice(2).trim().split(/\s+/).map(Number)
  }
  assert.fail(`OBJ object ${name} has no vertices`)
}

function distanceToNearestEndpoint(point, result, memberId) {
  const member = result.model.members[memberId]
  const endpoints = [member.nodeA, member.nodeB].map((nodeId) => (
    result.model.nodes[nodeId].position.map((value) => value * 1000)
  ))
  return Math.min(...endpoints.map((center) => Math.hypot(
    point[0] - center[0],
    point[1] - center[1],
    point[2] - center[2],
  )))
}

test('OBJ export builds closed member meshes in millimeters', () => {
  const result = fixtureResult(2)
  const obj = createMastObj(result)

  assert.match(obj, /^# mast-calculator detailed Wavefront OBJ export/m)
  assert.match(obj, /^# units: millimeters; Z axis: mast vertical$/m)
  assert.equal(countObjects(obj, 'member_'), result.model.members.length)
  assert.ok(!/\b(?:NaN|Infinity)\b/.test(obj))
  assert.match(obj, /# structural members=18/)
  validateFaceIndices(obj)
})

test('OBJ export preserves per-module diameters from the latest mixed-diameter model', () => {
  const result = fixtureResult(2, [16, 12])
  const obj = createMastObj(result, { radialSegments: 8, includeJointHardware: false })

  assert.equal(result.model.members[0].diameterM * 1000, 16)
  assert.equal(result.model.members[9].diameterM * 1000, 12)
  const lowerVertex = firstVertexOfObject(obj, 'member_0_module_1_top-ring')
  const upperVertex = firstVertexOfObject(obj, 'member_9_module_2_top-ring')
  assert.ok(Math.abs(distanceToNearestEndpoint(lowerVertex, result, 0) - 8) < 1e-5)
  assert.ok(Math.abs(distanceToNearestEndpoint(upperVertex, result, 9) - 6) < 1e-5)
})

test('OBJ export repeats selected physical hardware over the full mast', () => {
  const result = fixtureResult(2)
  const obj = createMastObj(result)

  assert.equal(countObjects(obj, 'coupling_nut_'), 6)
  assert.equal(countObjects(obj, 'clearance_nut_'), 6)
  assert.equal(countObjects(obj, 'bolt_shaft_'), 3)
  assert.equal(countObjects(obj, 'bolt_head_'), 3)
  assert.match(obj, /# joint hardware objects=18/)
})

test('OBJ hardware can be disabled without changing structural member count', () => {
  const result = fixtureResult(3)
  const obj = createMastObj(result, { includeJointHardware: false, radialSegments: 8 })

  assert.equal(countObjects(obj, 'member_'), result.model.members.length)
  assert.equal(countObjects(obj, 'coupling_nut_'), 0)
  assert.equal(countObjects(obj, 'clearance_nut_'), 0)
  assert.equal(countObjects(obj, 'bolt_shaft_'), 0)
  assert.match(obj, /# joint hardware objects=0/)
  validateFaceIndices(obj)
})

test('OBJ exporter rejects incomplete calculation snapshots', () => {
  assert.throws(() => createMastObj({}), /выполненный расчёт/)
})

test('issue #47: OBJ export belongs to unified Reports workspace and delegates file persistence', () => {
  const bootstrap = fs.readFileSync(new URL('../apps/web/app-bootstrap.js', import.meta.url), 'utf8')
  const reports = fs.readFileSync(new URL('../apps/web/reports-exports.js', import.meta.url), 'utf8')
  const page = fs.readFileSync(new URL('../apps/web/design.html', import.meta.url), 'utf8')

  assert.doesNotMatch(bootstrap, /createMastObj/)
  assert.doesNotMatch(bootstrap, /export-obj-button/)
  assert.match(reports, /createMastObj/)
  assert.match(reports, /designArtifacts/)
  assert.match(reports, /fileAdapter/)
  assert.match(reports, /export-design-obj-button/)
  assert.doesNotMatch(reports, /new Blob|createObjectURL|downloadText/)
  assert.match(page, /url=\.\/#reports/)
  assert.doesNotMatch(page, /id="export-obj"/)
})
