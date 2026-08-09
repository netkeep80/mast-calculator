import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  calculateProjectErection,
  createProjectInput,
  createProjectPackage,
  resolveProjectInput,
  serializeProjectPackage,
} from '../packages/application/index.js'
import {
  calculateErectionState,
  generateMastModel,
} from '../packages/structural-analysis/index.js'
import { executeCliRequest } from '../apps/cli/cli-runtime.mjs'

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

function erectionInput(project) {
  const parameters = resolveProjectInput(project)
  const model = generateMastModel(parameters)
  const hingeNodeIds = [model.baseNodeIds[0], model.baseNodeIds[1]]
  const attachmentNodeId = model.topNodeIds[0]
  const probe = calculateErectionState(model, parameters, {
    angleDeg: 40,
    hingeNodeIds,
    attachmentNodeId,
    anchorPointM: [50, 50, 50],
  })
  const hingePoint = model.nodes[hingeNodeIds[0]].position
  const radius = sub(probe.geometry.attachmentPointM, hingePoint)
  const momentDirection = unit(cross(probe.geometry.hingeAxis, radius))
  const cableDirection = scale(momentDirection, probe.gravityMomentAboutHingeNm > 0 ? -1 : 1)
  return {
    mode: 'tilt-up',
    hingeBaseEdgeIndex: 0,
    attachmentTopCornerIndex: 0,
    anchorPointM: add(probe.geometry.attachmentPointM, scale(cableDirection, 25)),
    rotationSense: 1,
    startAngleDeg: 36,
    endAngleDeg: 44,
    sampling: {
      initialSegments: 2,
      relativeTolerance: 0.02,
      minimumAngleStepDeg: 0.5,
      maximumEvaluations: 17,
      maximumDepth: 8,
    },
  }
}

test('CLI erection --json is an exact oracle for the headless application erection stage', async () => {
  const project = createProjectInput({ geometry: { moduleCount: 1 }, equipment: { massKg: 30 } })
  const erection = erectionInput(project)
  const packageValue = createProjectPackage(project, { erection })
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mast-cli-erection-'))
  const projectFile = path.join(directory, 'erection.project.json')
  await fs.writeFile(projectFile, serializeProjectPackage(packageValue), 'utf8')

  try {
    const direct = calculateProjectErection(project, erection)
    const cli = await executeCliRequest({ command: 'erection', projectFile, json: true, quiet: true })
    assert.deepEqual(JSON.parse(cli.content), direct)
    assert.equal(cli.mediaType, 'application/json')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('CLI erection fails explicitly when the project has no enabled tilt-up stage', async () => {
  const project = createProjectInput({ geometry: { moduleCount: 1 } })
  const packageValue = createProjectPackage(project)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mast-cli-no-erection-'))
  const projectFile = path.join(directory, 'bare.project.json')
  await fs.writeFile(projectFile, serializeProjectPackage(packageValue), 'utf8')

  try {
    await assert.rejects(
      () => executeCliRequest({ command: 'erection', projectFile, json: true, quiet: true }),
      (error) => error?.category === 'unsupported-configuration' && error?.code === 'erection-disabled',
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
