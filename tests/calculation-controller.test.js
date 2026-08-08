import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectInput } from '../packages/application/index.js'
import { createCalculationController } from '../apps/web/calculation-controller.js'
import { createWebApplicationState } from '../apps/web/web-state.js'

class FakeWorker {
  constructor() {
    this.sent = []
    this.terminated = false
    this.onmessage = null
    this.onerror = null
  }

  postMessage(message) {
    this.sent.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(data) {
    this.onmessage?.({ data })
  }
}

const input = createProjectInput({ geometry: { moduleCount: 2 } })
const effectiveInput = createProjectInput({ geometry: { moduleCount: 2, barDiameterMm: 16 } })

test('calculation controller transports ProjectInput and binds effective result state', () => {
  const state = createWebApplicationState()
  const workers = []
  const results = []
  const controller = createCalculationController({
    state,
    now: () => 123,
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    onResult: (snapshot) => results.push(snapshot),
  })

  const jobId = controller.start('optimize', input)
  assert.equal(workers[0].sent[0].action, 'optimize')
  assert.equal(workers[0].sent[0].parameters, input)
  assert.equal(state.snapshot.activeJob.startedAt, 123)

  workers[0].emit({
    type: 'result',
    jobId,
    projectInput: effectiveInput,
    result: { model: { moduleCount: 2 } },
    optimization: { recommendedDiameter: 16 },
  })

  assert.equal(controller.active, false)
  assert.equal(workers[0].terminated, true)
  assert.equal(state.snapshot.projectInput, effectiveInput)
  assert.equal(state.snapshot.optimization.recommendedDiameter, 16)
  assert.equal(results.length, 1)
})

test('calculation controller cancellation terminates transport and clears active job', () => {
  const state = createWebApplicationState()
  const worker = new FakeWorker()
  let cancelled = 0
  const controller = createCalculationController({
    state,
    createWorker: () => worker,
    onCancel: () => { cancelled += 1 },
  })

  controller.start('calculate', input)
  assert.equal(controller.active, true)
  assert.equal(controller.cancel(), true)
  assert.equal(worker.terminated, true)
  assert.equal(state.snapshot.activeJob, null)
  assert.equal(cancelled, 1)
})

test('stale Worker messages are ignored after a newer job starts', () => {
  const state = createWebApplicationState()
  const workers = []
  const controller = createCalculationController({
    state,
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
  })

  const firstJob = controller.start('calculate', input)
  const secondJob = controller.start('calculate', effectiveInput)
  workers[0].emit({ type: 'result', jobId: firstJob, projectInput: input, result: { model: { moduleCount: 2 } } })

  assert.equal(state.snapshot.activeJob.jobId, secondJob)
  assert.equal(state.snapshot.result, null)
})
