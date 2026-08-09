import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const source = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')

test('one Worker transport owns operational, guy and erection project stages', () => {
  const worker = source('apps/web/calculation-worker.js')
  const controller = source('apps/web/calculation-controller.js')
  const state = source('apps/web/web-state.js')

  assert.match(worker, /calculateProjectStages/)
  assert.doesNotMatch(worker, /calculateProjectWithGuys|calculateProjectErection|calculateErectionEnvelope|calculateErectionState/)
  assert.match(worker, /projectErection: erection \?\? null/)
  assert.match(worker, /erectionResult: output\.erectionResult/)
  assert.match(controller, /currentProjectErection/)
  assert.match(controller, /erection: projectErection/)
  assert.match(controller, /erectionResult: message\.erectionResult/)
  assert.match(state, /projectErection: null/)
  assert.match(state, /erectionResult: null/)
  assert.match(state, /activeJob: freeze\(\{ jobId, action, projectInput, projectGuys, projectErection, startedAt \}\)/)
})

test('obsolete guy-only application orchestrator is physically absent', () => {
  assert.equal(fs.existsSync(path.join(sourceRoot, 'packages/application/src/project-with-guys.ts')), false)
  const applicationIndex = source('packages/application/index.ts')
  assert.match(applicationIndex, /project-stages/)
  assert.doesNotMatch(applicationIndex, /project-with-guys/)
})

test('CLI delegates optional guy stages instead of reconstructing guy calculations', () => {
  const cli = source('apps/cli/cli-runtime.mjs')
  assert.match(cli, /calculateProjectStages/)
  assert.match(cli, /calculateProjectGuys/)
  assert.doesNotMatch(cli, /calculateGuyedProject/)
})

test('erection result panel is projection-only and refuses to invent acceptance', () => {
  const panel = source('apps/web/erection-result-panel.js')

  assert.doesNotMatch(panel, /structural-analysis|packages\/application/)
  assert.doesNotMatch(panel, /calculateErection|generateMastModel|resolveProjectErectionPath/)
  assert.match(panel, /snapshot\.erectionResult/)
  assert.match(panel, /не объявляет ERECTION PASS\/FAIL/)
  assert.match(panel, /maximumCableTensionN/)
  assert.match(panel, /memberActions/)
  assert.match(panel, /hingeReactions/)
  assert.match(panel, /feasibilityTransitions/)
})
