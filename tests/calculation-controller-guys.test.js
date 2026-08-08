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
  postMessage(message) { this.sent.push(message) }
  terminate() { this.terminated = true }
  emit(data) { this.onmessage?.({ data }) }
}

const input = createProjectInput({ geometry: { moduleCount: 2 } })
const guys = Object.freeze({
  tiers: Object.freeze([{ heightM: 0.8, anchorRadiusM: 4, guyCount: 3, pretensionN: 500 }]),
  safetyFactor: 3,
  terminationEfficiency: 0.8,
})

test('one calculation controller job transports ProjectInput and optional ProjectGuysInput together', () => {
  const state = createWebApplicationState()
  const worker = new FakeWorker()
  const controller = createCalculationController({ state, createWorker: () => worker })

  const jobId = controller.start('calculate', input, { projectGuys: guys })
  assert.equal(worker.sent.length, 1)
  assert.equal(worker.sent[0].jobId, jobId)
  assert.equal(worker.sent[0].parameters, input)
  assert.equal(worker.sent[0].guys, guys)
  assert.equal(state.snapshot.activeJob.projectGuys, guys)

  const result = { model: { moduleCount: 2 } }
  const guyResult = { passes: true, envelope: { maximumCableUtilization: 0.4 } }
  worker.emit({ type: 'result', jobId, projectInput: input, projectGuys: guys, result, guyResult, optimization: null })

  assert.equal(state.snapshot.projectGuys, guys)
  assert.equal(state.snapshot.result, result)
  assert.equal(state.snapshot.guyResult, guyResult)
  assert.equal(state.snapshot.activeJob, null)
  assert.equal(worker.terminated, true)
})

test('bare calculation remains backward-compatible when ProjectGuysInput is absent', () => {
  const state = createWebApplicationState()
  const worker = new FakeWorker()
  const controller = createCalculationController({ state, createWorker: () => worker })

  controller.start('calculate', input, { projectGuys: null })
  assert.equal(worker.sent[0].guys, null)
  assert.equal(state.snapshot.activeJob.projectGuys, null)
})
