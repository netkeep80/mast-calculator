import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const PRODUCTION_REVIEW_LIMIT = 600
const PRODUCTION_HARD_LIMIT = 800
const GENERAL_HARD_LIMIT = 1800
const CHECKED_EXTENSIONS = /\.(?:js|mjs|cjs|ts|mts|cts|rs|md|yml|yaml|html|css|sh)$/i
const PRODUCTION_MODULE = /^(?:packages\/.*\.(?:ts|mts|cts)|apps\/web\/.*\.(?:js|mjs|cjs)|apps\/cli\/.*\.(?:js|mjs|cjs)|apps\/desktop\/web\/.*\.(?:js|mjs|cjs)|apps\/desktop\/src-tauri\/src\/.*\.rs)$/

// A module above the review limit must be named here with a narrow cap and a concrete reason.
// If it shrinks below the review limit, CI requires deleting the now-obsolete budget entry.
const LARGE_MODULE_BUDGETS = new Map([
  ['apps/web/app.js', {
    maxLines: 700,
    reason: 'main presentation coordinator while UI extraction remains behaviour-preserving',
  }],
  ['packages/application/src/calculate.ts', {
    maxLines: 760,
    reason: 'single calculation-result construction boundary; splitting must not reintroduce result mutation',
  }],
  ['packages/engineering/src/guy-wire-system.ts', {
    maxLines: 700,
    reason: 'coupled nonlinear guy-wire analysis kept together around one numerical state model',
  }],
  ['packages/structural-analysis/src/solver.ts', {
    maxLines: 680,
    reason: 'canonical frame-solver assembly/recovery path guarded by independent solver cross-checks',
  }],
])

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => CHECKED_EXTENSIONS.test(file))
  .filter((file) => !file.startsWith('docs/case-studies/'))

const lineCounts = new Map()
const violations = []
for (const file of tracked) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length
  lineCounts.set(file, lines)

  if (PRODUCTION_MODULE.test(file)) {
    if (lines > PRODUCTION_HARD_LIMIT) {
      violations.push(`${file}: ${lines} строк > production hard limit ${PRODUCTION_HARD_LIMIT}`)
      continue
    }
    const budget = LARGE_MODULE_BUDGETS.get(file)
    if (lines > PRODUCTION_REVIEW_LIMIT && !budget) {
      violations.push(`${file}: ${lines} строк > review limit ${PRODUCTION_REVIEW_LIMIT}; split module or add a narrow justified budget`)
      continue
    }
    if (budget && lines > budget.maxLines) {
      violations.push(`${file}: ${lines} строк > named budget ${budget.maxLines} (${budget.reason})`)
    }
    continue
  }

  if (lines > GENERAL_HARD_LIMIT) violations.push(`${file}: ${lines} строк > general hard limit ${GENERAL_HARD_LIMIT}`)
}

for (const [file, budget] of LARGE_MODULE_BUDGETS) {
  const lines = lineCounts.get(file)
  if (lines === undefined) {
    violations.push(`${file}: stale large-module budget for missing file`)
    continue
  }
  if (lines <= PRODUCTION_REVIEW_LIMIT) {
    violations.push(`${file}: ${lines} строк <= ${PRODUCTION_REVIEW_LIMIT}; remove obsolete large-module budget (${budget.reason})`)
  }
}

if (violations.length) {
  for (const violation of violations) console.error(`::error::${violation}`)
  process.exit(1)
}

for (const [file, budget] of LARGE_MODULE_BUDGETS) {
  const lines = lineCounts.get(file)
  console.log(`Large module: ${file} ${lines}/${budget.maxLines} — ${budget.reason}`)
}
console.log(`Maintainability gate: production review>${PRODUCTION_REVIEW_LIMIT}, production hard>${PRODUCTION_HARD_LIMIT}, general hard>${GENERAL_HARD_LIMIT}; tracked=${tracked.length}`)
