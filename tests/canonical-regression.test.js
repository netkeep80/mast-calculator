import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertClose } from './helpers/regression-tolerances.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/canonical/baseline-v1.json'), 'utf8'))
const BEGIN = '===CANONICAL_BASELINE_BEGIN==='
const END = '===CANONICAL_BASELINE_END==='

function generateCurrentBaseline() {
  const output = execFileSync(process.execPath, ['scripts/generate-canonical-baseline.mjs'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const start = output.indexOf(BEGIN)
  const finish = output.indexOf(END)
  assert.ok(start >= 0 && finish > start, 'canonical generator did not emit baseline markers')
  return JSON.parse(output.slice(start + BEGIN.length, finish).trim())
}

const exactNumberKeys = new Set([
  'count', 'modules', 'nodes', 'members', 'baseNodes', 'topNodes', 'jointCount',
  'boltDiameterMm', 'boltLengthMm', 'tiers', 'cables', 'maximumIterations',
  'designMaximumModules', 'designFirstFailModules', 'ultimateMaximumModules',
  'ultimateFirstFailModules', 'evaluationCount', 'serializedBytes', 'structuralMembers',
  'hardwareObjects', 'bytes', 'vertexLines', 'faceLines', 'directionDeg',
  'governingDirectionDeg',
])

function toleranceKind(pathParts, key) {
  const pathText = [...pathParts, key].join('.')
  if (pathText.includes('dofChecksum') || /DisplacementM$/.test(key)) return 'dof'
  if (/Utilization/.test(key)) return 'utilization'
  if (/BucklingFactor/.test(key)) return 'eigenvalue'
  if (/Residual|RelativeDifference/.test(key)) return 'residual'
  if (/ForceN$|WeightN$/.test(key) || pathText.includes('tensionChecksum')) return 'force'
  if (/Moment/.test(key)) return 'moment'
  if (/MassKg$/.test(key)) return 'massKg'
  if (/LengthMm$/.test(key)) return 'geometryMm'
  return 'scalar'
}

function compareExpectedSubset(actual, expected, pathParts = []) {
  if (expected === null || typeof expected === 'string' || typeof expected === 'boolean') {
    assert.deepEqual(actual, expected, `${pathParts.join('.')}: exact value differs`)
    return
  }
  if (typeof expected === 'number') {
    const key = pathParts.at(-1) ?? ''
    if (exactNumberKeys.has(key)) {
      assert.equal(actual, expected, `${pathParts.join('.')}: exact numeric contract differs`)
    } else {
      assertClose(actual, expected, toleranceKind(pathParts.slice(0, -1), key), pathParts.join('.'))
    }
    return
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${pathParts.join('.')}: expected array`)
    assert.equal(actual.length, expected.length, `${pathParts.join('.')}: array length differs`)
    expected.forEach((value, index) => compareExpectedSubset(actual[index], value, [...pathParts, String(index)]))
    return
  }
  assert.ok(actual && typeof actual === 'object', `${pathParts.join('.')}: expected object`)
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(Object.hasOwn(actual, key), `${[...pathParts, key].join('.')}: field missing in current projection`)
    compareExpectedSubset(actual[key], value, [...pathParts, key])
  }
}

test('canonical engineering scenarios preserve the frozen pre-foundation numerical baseline', () => {
  const current = generateCurrentBaseline()
  assert.equal(current.schema, baseline.schema)
  assert.equal(current.scenariosSchema, baseline.scenariosSchema)
  assert.deepEqual(Object.keys(current.cases), Object.keys(baseline.cases), 'canonical scenario set changed without baseline versioning')
  compareExpectedSubset(current, baseline)
})
