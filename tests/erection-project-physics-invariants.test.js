import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MastApplicationError,
  PROJECT_PACKAGE_SCHEMA,
  ProjectSchemaError,
  calculateProjectErection,
  createProjectInput,
  createProjectPackage,
  parseProjectPackage,
  resolveProjectInput,
  serializeProjectPackage,
} from '../packages/application/index.js'
import {
  calculateErectionEnvelope,
  calculateErectionState,
  generateMastModel,
  resolveProjectErectionPath,
} from '../packages/structural-analysis/index.js'

const add = (a, b) => a.map((value, index) => value + b[index])
const sub = (a, b) => a.map((value, index) => value - b[index])
const scale = (a, factor) => a.map((value) => value * factor)
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a) => Math.hypot(...a)
const unit = (a) => scale(a, 1 / norm(a))

function stableErectionInput(project, midpointAngleDeg = 35) {
  const parameters = resolveProjectInput(project)
  const model = generateMastModel(parameters)
  const hingeNodeIds = [model.baseNodeIds[0], model.baseNodeIds[1]]
  const attachmentNodeId = model.topNodeIds[0]
  const probe = calculateErectionState(model, parameters, {
    angleDeg: midpointAngleDeg,
    hingeNodeIds,
    attachmentNodeId,
    anchorPointM: [50, 50, 50],
  })
  const hingePoint = model.nodes[hingeNodeIds[0]].position
  const radius = sub(probe.geometry.attachmentPointM, hingePoint)
  const maximumMomentDirection = unit(cross(probe.geometry.hingeAxis, radius))
  const cableDirection = scale(maximumMomentDirection, probe.gravityMomentAboutHingeNm > 0 ? -1 : 1)
  const anchorPointM = add(probe.geometry.attachmentPointM, scale(cableDirection, 30))
  return {
    mode: 'tilt-up',
    hingeBaseEdgeIndex: 0,
    attachmentTopCornerIndex: 0,
    anchorPointM,
    rotationSense: 1,
    startAngleDeg: midpointAngleDeg - 5,
    endAngleDeg: midpointAngleDeg + 5,
    sampling: {
      initialSegments: 2,
      relativeTolerance: 0.02,
      minimumAngleStepDeg: 0.5,
      maximumEvaluations: 25,
      maximumDepth: 12,
    },
  }
}

test('legacy project/v1 without erection preserves exact serialization', () => {
  const project = createProjectInput({ geometry: { moduleCount: 2 } })
  const legacy = { schema: PROJECT_PACKAGE_SCHEMA, project }
  assert.deepEqual(parseProjectPackage(JSON.stringify(legacy)), legacy)
  assert.equal(serializeProjectPackage(legacy), `${JSON.stringify(legacy, null, 2)}\n`)
})

test('project/v1 round-trips only user-owned erection configuration', () => {
  const project = createProjectInput({ geometry: { moduleCount: 2 } })
  const erection = stableErectionInput(project)
  const packageValue = createProjectPackage(project, { erection })
  const parsed = parseProjectPackage(serializeProjectPackage(packageValue))

  assert.deepEqual(parsed, packageValue)
  assert.deepEqual(parsed.erection, erection)
  assert.equal('hingeNodeIds' in parsed.erection, false)
  assert.equal('attachmentNodeId' in parsed.erection, false)
  assert.equal('requiredCableTensionN' in parsed.erection, false)
  assert.equal('samples' in parsed.erection, false)
})

test('erection package boundary rejects FEM-derived fields and malformed sampling', () => {
  const project = createProjectInput({ geometry: { moduleCount: 1 } })
  const erection = stableErectionInput(project)
  assert.throws(
    () => parseProjectPackage(JSON.stringify({
      schema: PROJECT_PACKAGE_SCHEMA,
      project,
      erection: { ...erection, hingeNodeIds: [0, 1] },
    })),
    (error) => error instanceof ProjectSchemaError && error.code === 'unknown-package-field',
  )
  assert.throws(
    () => createProjectPackage(project, {
      erection: {
        ...erection,
        sampling: { ...erection.sampling, maximumEvaluations: 2 },
      },
    }),
    (error) => error instanceof ProjectSchemaError && error.code === 'invalid-erection-sampling',
  )
  assert.throws(
    () => createProjectPackage(project, { erection: { ...erection, anchorPointM: [0, Number.NaN, 1] } }),
    (error) => error instanceof ProjectSchemaError && error.code === 'invalid-number',
  )
})

for (const moduleCount of [1, 2, 4, 12]) {
  test(`semantic erection selectors resolve against generated topology for ${moduleCount} modules`, () => {
    const project = createProjectInput({ geometry: { moduleCount } })
    const parameters = resolveProjectInput(project)
    const model = generateMastModel(parameters)
    const erection = {
      ...stableErectionInput(project),
      hingeBaseEdgeIndex: 2,
      attachmentTopCornerIndex: 1,
    }
    const resolved = resolveProjectErectionPath(model, erection)

    assert.deepEqual(resolved.topology.hingeNodeIds, [model.baseNodeIds[2], model.baseNodeIds[0]])
    assert.equal(resolved.topology.attachmentNodeId, model.topNodeIds[1])
    assert.equal(resolved.path.startAngleDeg, erection.startAngleDeg)
    assert.equal(resolved.options.minimumStep, erection.sampling.minimumAngleStepDeg)
  })
}

test('semantic erection selectors are independent of a mixed-diameter material profile', () => {
  const uniform = createProjectInput({ geometry: { moduleCount: 4, barDiameterMm: 16 } })
  const mixed = createProjectInput({ geometry: { moduleCount: 4, barDiameterMm: 16, moduleDiametersMm: [20, 18, 16, 14] } })
  const erection = stableErectionInput(uniform)
  const uniformModel = generateMastModel(resolveProjectInput(uniform))
  const mixedModel = generateMastModel(resolveProjectInput(mixed))
  const a = resolveProjectErectionPath(uniformModel, erection)
  const b = resolveProjectErectionPath(mixedModel, erection)

  assert.deepEqual(a.topology, b.topology)
  assert.deepEqual(a.path, b.path)
})

test('application erection result is an exact oracle for direct structural envelope', () => {
  const project = createProjectInput({
    geometry: { moduleCount: 1 },
    equipment: { massKg: 35 },
  })
  const erection = stableErectionInput(project, 38)
  const parameters = resolveProjectInput(project)
  const model = generateMastModel(parameters)
  const resolved = resolveProjectErectionPath(model, erection)
  const direct = calculateErectionEnvelope(model, parameters, resolved.path, resolved.options)
  const application = calculateProjectErection(project, erection)

  assert.ok(application)
  assert.deepEqual(application.configuration, erection)
  assert.deepEqual(application.topology, resolved.topology)
  assert.deepEqual(application.envelope, direct)
  assert.ok(Object.isFrozen(application))
  assert.ok(Object.isFrozen(application.envelope))
})

test('disabled erection returns without resolving or calculating the operational project', () => {
  assert.equal(calculateProjectErection({}, { mode: 'disabled' }), null)
  assert.equal(calculateProjectErection({}, undefined), null)
})

test('direct application erection boundary normalizes invalid configuration errors', () => {
  const project = createProjectInput({ geometry: { moduleCount: 1 } })
  const erection = stableErectionInput(project)
  assert.throws(
    () => calculateProjectErection(project, { ...erection, hingeBaseEdgeIndex: 9 }),
    (error) => error instanceof MastApplicationError && error.category === 'schema-error',
  )
})
