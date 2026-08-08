#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { analyzeRepository, evaluatePolicy } from './architecture-audit-lib.mjs'
import { reportToMarkdown } from './architecture-report.mjs'

const root = process.cwd()
const args = new Set(process.argv.slice(2))
const baselinePath = path.join(root, 'docs/architecture/architecture-baseline.json')
const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  : {}
const report = analyzeRepository(root)
const violations = evaluatePolicy(report, baseline)
const output = args.has('--json')
  ? `${JSON.stringify({ ...report, violations }, null, 2)}\n`
  : reportToMarkdown(report, violations)

process.stdout.write(output)
if (args.has('--check') && violations.length) process.exitCode = 1
