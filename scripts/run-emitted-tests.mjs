import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const root = process.cwd()
const emittedRoot = path.join(root, '.build')
const TEST_SUITE_BUDGET_MS = 90_000
const TOTAL_REGRESSION_BUDGET_MS = 120_000

function collectTests(directory, relative = '') {
  const current = path.join(directory, relative)
  const tests = []
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) tests.push(...collectTests(directory, child))
    else if (/\.test\.(?:js|mjs|cjs)$/i.test(entry.name) && entry.name !== 'performance.test.js') tests.push(child)
  }
  return tests.sort()
}

function printFailedTapTests(stdout) {
  const failed = String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^not ok\s+\d+\s+-\s+/.test(line))
  if (failed.length === 0) return
  console.error('\nRegression failed tests:')
  for (const line of failed) console.error(`  ${line}`)
}

const totalStarted = performance.now()
execFileSync(process.execPath, ['scripts/build-test-runtime.mjs'], {
  cwd: root,
  stdio: 'inherit',
})

const testFiles = collectTests(path.join(emittedRoot, 'tests')).map((file) => path.join('tests', file))
if (testFiles.length === 0) throw new Error('Regression runner did not discover any tests')

const testsStarted = performance.now()
const testRun = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: emittedRoot,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
if (testRun.stdout) process.stdout.write(testRun.stdout)
if (testRun.stderr) process.stderr.write(testRun.stderr)
if (testRun.error) throw testRun.error
if (testRun.status !== 0) {
  printFailedTapTests(testRun.stdout)
  throw new Error(`Regression test process exited with status ${testRun.status}`)
}

const testsElapsedMs = performance.now() - testsStarted
const totalElapsedMs = performance.now() - totalStarted

console.info(`Regression budget: tests=${testsElapsedMs.toFixed(0)} ms/${TEST_SUITE_BUDGET_MS} ms; build+tests=${totalElapsedMs.toFixed(0)} ms/${TOTAL_REGRESSION_BUDGET_MS} ms; files=${testFiles.length}`)
if (testsElapsedMs > TEST_SUITE_BUDGET_MS) {
  throw new Error(`Regression test suite exceeded ${TEST_SUITE_BUDGET_MS} ms budget: ${testsElapsedMs.toFixed(0)} ms`)
}
if (totalElapsedMs > TOTAL_REGRESSION_BUDGET_MS) {
  throw new Error(`Regression build+test run exceeded ${TOTAL_REGRESSION_BUDGET_MS} ms budget: ${totalElapsedMs.toFixed(0)} ms`)
}
