import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectInput } from '../packages/application/index.js'
import { createWebApplicationState } from '../apps/web/web-state.js'

const input = createProjectInput({ geometry: { moduleCount: 2 } })
const nextInput = createProjectInput({ geometry: { moduleCount: 3 } })
const optimizedInput = createProjectInput({
  geometry: { moduleCount: 3, barDiameterMm: 16 },
  connection: { configuratorMode: 'auto' },
})

const result = (moduleCount) => ({ model: { moduleCount } })

test('Web state binds a completed result to the ProjectInput of the matching job', () => {
  const state = createWebApplicationState()
  state.beginJob({ jobId: 1, action: 'calculate', projectInput: input, startedAt: 10 })

  assert.equal(state.completeJob(1, { result: result(2) }), true)
  assert.equal(state.snapshot.projectInput, input)
  assert.equal(state.snapshot.result.model.moduleCount, 2)
  assert.equal(state.snapshot.activeJob, null)
})

test('effective ProjectInput returned by optimization replaces the request input', () => {
  const state = createWebApplicationState()
  state.beginJob({ jobId: 1, action: 'optimize', projectInput: nextInput, startedAt: 10 })

  assert.equal(state.completeJob(1, { projectInput: optimizedInput, result: result(3) }), true)
  assert.equal(state.snapshot.projectInput, optimizedInput)
  assert.equal(state.snapshot.projectInput.geometry.barDiameterMm, 16)
  assert.equal(state.snapshot.projectInput.connection.configuratorMode, 'auto')
})

test('stale Worker completion cannot replace the current project/result pair', () => {
  const state = createWebApplicationState()
  state.beginJob({ jobId: 1, action: 'calculate', projectInput: input, startedAt: 10 })
  state.beginJob({ jobId: 2, action: 'calculate', projectInput: nextInput, startedAt: 20 })

  assert.equal(state.completeJob(1, { result: result(2) }), false)
  assert.equal(state.snapshot.result, null)
  assert.equal(state.snapshot.activeJob.jobId, 2)

  assert.equal(state.completeJob(2, { result: result(3) }), true)
  assert.equal(state.snapshot.projectInput, nextInput)
  assert.equal(state.snapshot.result.model.moduleCount, 3)
})

test('selected module is bounded by the current calculation result', () => {
  const state = createWebApplicationState()
  state.beginJob({ jobId: 1, action: 'calculate', projectInput: nextInput, startedAt: 10 })
  state.completeJob(1, { result: result(3) })

  assert.equal(state.selectModule(99), 2)
  assert.equal(state.snapshot.selectedModuleIndex, 2)

  state.beginJob({ jobId: 2, action: 'calculate', projectInput: input, startedAt: 20 })
  state.completeJob(2, { result: result(2) })
  assert.equal(state.snapshot.selectedModuleIndex, 1)
})
