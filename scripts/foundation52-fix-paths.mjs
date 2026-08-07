import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const packageFiles = tracked.filter((file) => /^packages\/[^/]+\/src\/[^/]+\.js$/.test(file))
const engineMap = new Map(packageFiles.map((file) => [
  `site/engine/${path.posix.basename(file)}`,
  file,
]))

const textExtensions = /\.(?:js|mjs|cjs|md|yml|yaml|html|css|json|txt)$/i
const changed = []
for (const file of tracked) {
  if (!textExtensions.test(file)) continue
  if (file === 'docs/architecture/FOUNDATION_AUDIT.md') continue
  let source = fs.readFileSync(file, 'utf8')
  const original = source

  for (const [oldPath, newPath] of engineMap) {
    source = source.replaceAll(oldPath, newPath)
  }

  // Remaining old site/* references are Web-adapter paths. Protect generated
  // _site/* deployment paths from this source-tree migration.
  source = source.replace(/(?<![A-Za-z0-9_])site\//g, 'apps/web/')
  source = source.replace(/(['"])site\1\s*,\s*(['"])([^'"]+)\2/g, (_m, q1, q2, name) => `${q1}apps${q1}, ${q2}web${q2}, ${q2}${name}${q2}`)

  if (source !== original) {
    fs.writeFileSync(file, source)
    changed.push(file)
  }
}

console.log(`Updated moved-path references in ${changed.length} tracked files.`)
for (const file of changed) console.log(file)
// One-shot migration: the workflow deletes this helper after committing results.
