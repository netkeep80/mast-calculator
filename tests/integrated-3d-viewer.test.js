import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { generateMastModel } from '../packages/structural-analysis/index.js'
import { buildJointHardwareGeometry } from '../packages/domain/index.js'
import {
  buildDetailedMastModel,
  DETAILED_MAST_MODEL_SCHEMA,
} from '../packages/design/index.js'
import { MastViewer } from '../apps/web/viewer.js'

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
  const model = generateMastModel(parameters)
  return {
    parameters,
    model,
    analysis: {
      memberResults: model.members.map((member) => ({
        memberId: member.id,
        utilization: member.moduleIndex === 0 ? 0.35 : 0.65,
      })),
      buckling: {
        criticalLoadFactor: 2.5,
        mode: model.nodes.map(() => [0, 0, 0]),
      },
    },
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

function countKind(model, kind) {
  return model.objects.filter((object) => object.kind === kind).length
}

test('detailed mast model is a shared polygon mesh with structural and hardware metadata', () => {
  const result = fixtureResult(2)
  const model = buildDetailedMastModel(result, { radialSegments: 8 })

  assert.equal(model.schema, DETAILED_MAST_MODEL_SCHEMA)
  assert.equal(model.units, 'mm')
  assert.equal(countKind(model, 'member'), 18)
  assert.equal(countKind(model, 'coupling-nut'), 6)
  assert.equal(countKind(model, 'clearance-nut'), 6)
  assert.equal(countKind(model, 'bolt-shaft'), 3)
  assert.equal(countKind(model, 'bolt-head'), 3)
  assert.equal(model.statistics.structuralMembers, 18)
  assert.equal(model.statistics.hardwareObjects, 18)
  assert.ok(model.statistics.vertices > 0)
  assert.ok(model.statistics.faces > 0)
  assert.ok(model.bounds.size[2] > result.parameters.moduleHeightMm)
  assert.ok(model.objects.every((object) => object.vertices.length > 0 && object.faces.length > 0))
})

test('detailed viewer geometry preserves mixed module diameters and interface ownership', () => {
  const result = fixtureResult(2, [16, 12])
  const model = buildDetailedMastModel(result, { radialSegments: 8 })
  const lowerMember = model.objects.find((object) => object.memberId === 0)
  const upperMember = model.objects.find((object) => object.memberId === 9)
  const couplingAtInterface = model.objects.find((object) => object.name === 'coupling_nut_level_1_node_3')
  const clearanceAtInterface = model.objects.find((object) => object.name === 'clearance_nut_level_1_node_3')
  const boltAtInterface = model.objects.find((object) => object.name === 'bolt_shaft_level_1_node_3')

  assert.equal(lowerMember.radiusMm, 8)
  assert.equal(upperMember.radiusMm, 6)
  assert.deepEqual(lowerMember.moduleIndices, [0])
  assert.deepEqual(upperMember.moduleIndices, [1])
  assert.deepEqual(couplingAtInterface.moduleIndices, [0])
  assert.deepEqual(clearanceAtInterface.moduleIndices, [1])
  assert.deepEqual(boltAtInterface.moduleIndices, [0, 1])
})

test('detailed model can omit physical joint hardware for lightweight consumers', () => {
  const result = fixtureResult(3)
  const model = buildDetailedMastModel(result, {
    radialSegments: 6,
    includeJointHardware: false,
  })

  assert.equal(model.objects.length, result.model.members.length)
  assert.equal(model.statistics.hardwareObjects, 0)
  assert.ok(model.objects.every((object) => object.kind === 'member'))
})

test('integrated MastViewer renders filled detailed faces instead of only FEM centerlines', () => {
  const previousWindow = globalThis.window
  const PreviousResizeObserver = globalThis.ResizeObserver
  let fillCount = 0
  let closePathCount = 0
  const context = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() { closePathCount += 1 },
    fill() { fillCount += 1 },
    stroke() {},
    arc() {},
    fillText() {},
  }
  const listeners = new Map()
  const canvas = {
    clientWidth: 900,
    clientHeight: 620,
    width: 900,
    height: 620,
    style: {},
    tabIndex: -1,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 620 }),
    addEventListener: (name, handler) => listeners.set(name, handler),
    setPointerCapture() {},
    focus() {},
  }

  globalThis.window = { devicePixelRatio: 1 }
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback }
    observe() { this.callback() }
  }

  try {
    const viewer = new MastViewer(canvas)
    viewer.setResult(fixtureResult(2))
    assert.equal(viewer.detailedModel.schema, DETAILED_MAST_MODEL_SCHEMA)
    assert.equal(viewer.detailedModel.statistics.structuralMembers, 18)
    assert.ok(fillCount > 20, 'solid viewer must fill polygon faces')
    assert.ok(closePathCount > 20, 'solid viewer must draw closed mesh faces')
    assert.ok(listeners.has('pointermove'))
    assert.ok(listeners.has('wheel'))
    assert.ok(listeners.has('dblclick'))
    assert.ok(listeners.has('keydown'))
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (PreviousResizeObserver === undefined) delete globalThis.ResizeObserver
    else globalThis.ResizeObserver = PreviousResizeObserver
  }
})

test('viewer and OBJ exporter are wired to one detailed-model source', () => {
  const viewerSource = fs.readFileSync(new URL('../apps/web/viewer.js', import.meta.url), 'utf8')
  const objSource = fs.readFileSync(new URL('../packages/design/src/obj-export.js', import.meta.url), 'utf8')
  assert.match(viewerSource, /buildDetailedMastModel/)
  assert.match(viewerSource, /drawDetailedModel/)
  assert.match(objSource, /buildDetailedMastModel/)
  assert.doesNotMatch(viewerSource, /createMastObj/)
})
