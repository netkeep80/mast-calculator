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
const erection = Object.freeze({ mode: 'disabled' })

test('calculation controller transports ProjectInput and optional stages as one job snapshot', () => {
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

  const jobId = controller.start('calculate', input, { projectGuys: null, projectErection: erection })
  assert.equal(workers[0].sent[0].action, 'calculate')
  assert.equal(workers[0].sent[0].parameters, input)
  assert.equal(workers[0].sent[0].guys, null)
  assert.equal(workers[0].sent[0].erection, erection)
  assert.equal(state.snapshot.activeJob.startedAt, 123)
  assert.equal(state.snapshot.activeJob.projectErection, erection)

  const erectionResult = Object.freeze({ envelope: { diagnostics: { converged: true } } })
  workers[0].emit({
    type: 'result',
    jobId,
    projectInput: input,
    projectGuys: null,
    projectErection: erection,
    result: { model: { moduleCount: 2 } },
    guyResult: null,
    erectionResult,
    optimization: null,
  })

  assert.equal(controller.active, false)
  assert.equal(workers[0].terminated, true)
  assert.equal(state.snapshot.projectInput, input)
  assert.equal(state.snapshot.projectErection, erection)
  assert.equal(state.snapshot.erectionResult, erectionResult)
  assert.equal(results.length, 1)
})

test('calculation controller still binds effective optimized input without optional-stage leakage', () => {
  const state = createWebApplicationState()
  const worker = new FakeWorker()
  const controller = createCalculationController({ state, createWorker: () => worker })
  const jobId = controller.start('optimize', input, { projectGuys: null, projectErection: null })

  worker.emit({
    type: 'result',
    jobId,
    projectInput: effectiveInput,
    projectGuys: null,
    projectErection: null,
    result: { model: { moduleCount: 2 } },
    guyResult: null,
    erectionResult: null,
    optimization: { recommendedDiameter: 16 },
  })

  assert.equal(state.snapshot.projectInput, effectiveInput)
  assert.equal(state.snapshot.projectErection, null)
  assert.equal(state.snapshot.erectionResult, null)
  assert.equal(state.snapshot.optimization.recommendedDiameter, 16)
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

  controller.start('calculate', input, { projectGuys: null, projectErection: erection })
  assert.equal(controller.active, true)
  assert.equal(controller.cancel(), true)
  assert.equal(worker.terminated, true)
  assert.equal(state.snapshot.activeJob, null)
  assert.equal(cancelled, 1)
})

test('stale Worker completion cannot mix old erection result into a newer project snapshot', () => {
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

  const firstErection = Object.freeze({ mode: 'disabled' })
  const secondErection = null
  const firstJob = controller.start('calculate', input, { projectGuys: null, projectErection: firstErection })
  const secondJob = controller.start('calculate', effectiveInput, { projectGuys: null, projectErection: secondErection })
  workers[0].emit({
    type: 'result',
    jobId: firstJob,
    projectInput: input,
    projectErection: firstErection,
    result: { model: { moduleCount: 2 } },
    erectionResult: { envelope: { diagnostics: { converged: true } } },
  })

  assert.equal(state.snapshot.activeJob.jobId, secondJob)
  assert.equal(state.snapshot.activeJob.projectErection, secondErection)
  assert.equal(state.snapshot.result, null)
  assert.equal(state.snapshot.erectionResult, null)
})
