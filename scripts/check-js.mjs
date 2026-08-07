import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['apps', 'packages', 'scripts', 'tests']
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])

function walk(root) {
  if (!fs.existsSync(root)) return []
  const result = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '_site') continue
      result.push(...walk(target))
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      result.push(target)
    }
  }
  return result
}

const files = ROOTS.flatMap(walk).sort()
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
}
console.log(`Syntax checked: ${files.length} JavaScript modules`)
