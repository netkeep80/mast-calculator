import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptiveSampleRange } from '../packages/numerics/index.js'

const continuous = (state, ...metrics) => ({ state, metrics, continuityKey: 'continuous' })

test('adaptive sampler leaves an exactly linear response on its bounded initial resolution', () => {
  const result = adaptiveSampleRange(
    0,
    10,
    (x) => continuous(x, 3 * x + 2),
    {
      initialSegments: 2,
      relativeTolerance: 1e-6,
      minimumStep: 0.01,
      maximumEvaluations: 20,
    },
  )

  assert.equal(result.diagnostics.converged, true)
  assert.equal(result.diagnostics.reason, 'tolerance')
  assert.equal(result.samples.length, 5)
  assert.deepEqual(result.samples.map((sample) => sample.x), [0, 2.5, 5, 7.5, 10])
})

test('adaptive sampler resolves an interior smooth peak missed by endpoint-only sampling', () => {
  const peakX = 0.37
  const result = adaptiveSampleRange(
    0,
    1,
    (x) => continuous(x, 1 - (x - peakX) ** 2),
    {
      initialSegments: 2,
      relativeTolerance: 1e-4,
      minimumStep: 0.001,
      maximumEvaluations: 200,
      maximumDepth: 12,
    },
  )
  const governing = result.samples.reduce((best, sample) => (
    sample.metrics[0] > best.metrics[0] ? sample : best
  ))

  assert.equal(result.diagnostics.converged, true)
  assert.ok(Math.abs(governing.x - peakX) <= 0.02)
  assert.ok(governing.x > 0 && governing.x < 1)
})

test('continuity-key boundary is refined instead of interpolated through', () => {
  const boundary = 0.5
  const result = adaptiveSampleRange(
    0,
    1,
    (x) => ({
      state: x,
      metrics: [],
      continuityKey: x < boundary ? 'left' : 'right',
    }),
    {
      initialSegments: 1,
      minimumStep: 0.01,
      maximumEvaluations: 40,
      maximumDepth: 12,
    },
  )
  const transition = result.samples.slice(0, -1).map((sample, index) => ({
    left: sample,
    right: result.samples[index + 1],
  })).find(({ left, right }) => left.continuityKey !== right.continuityKey)

  assert.ok(transition)
  assert.ok(transition.right.x - transition.left.x <= 0.02)
  assert.ok(transition.left.x < boundary)
  assert.ok(transition.right.x >= boundary)
})

test('adaptive sampler reports its evaluation budget instead of silently claiming convergence', () => {
  const result = adaptiveSampleRange(
    0,
    1,
    (x) => continuous(x, Math.sin(40 * x)),
    {
      initialSegments: 2,
      relativeTolerance: 1e-6,
      minimumStep: 1e-6,
      maximumEvaluations: 7,
      maximumDepth: 20,
    },
  )

  assert.equal(result.diagnostics.converged, false)
  assert.equal(result.diagnostics.reason, 'max-evaluations')
  assert.equal(result.diagnostics.evaluationCount, 7)
})
