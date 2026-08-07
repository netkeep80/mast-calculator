import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const HARD_LIMIT = 1500
const WARNING_LIMIT = 1000
const CHECKED_EXTENSIONS = /\.(?:js|mjs|cjs|md|yml|yaml|html|css|sh)$/i

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((path) => CHECKED_EXTENSIONS.test(path))
  .filter((path) => !path.startsWith('docs/case-studies/'))

const violations = []
for (const path of tracked) {
  const text = fs.readFileSync(path, 'utf8')
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length
  if (lines > HARD_LIMIT) {
    violations.push(`${path}: ${lines} строк > ${HARD_LIMIT}`)
  } else if (lines > WARNING_LIMIT) {
    console.warn(`::warning file=${path}::${lines} строк; рекомендуемый предел ${WARNING_LIMIT}`)
  }
}

if (violations.length) {
  for (const violation of violations) console.error(`::error::${violation}`)
  process.exit(1)
}

console.log(`Проверено файлов: ${tracked.length}; жёсткий предел: ${HARD_LIMIT} строк`)
