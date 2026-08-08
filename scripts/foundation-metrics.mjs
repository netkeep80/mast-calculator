#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { analyzeRepository, evaluatePolicy } from './architecture-audit-lib.mjs'

const root = process.cwd()
const report = analyzeRepository(root)
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'architecture', 'architecture-baseline.json'), 'utf8'))
const violations = evaluatePolicy(report, baseline)
const moduleByPath = new Map(report.modules.map((module) => [module.path, module]))
const sourceExtensions = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']
const starReexport = /(?:^|\n)\s*export\s+(?:type\s+)?\*\s+from\s+['"]([^'"]+)['"]/g
const namedReexport = /(?:^|\n)\s*export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g

function resolveSource(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  const ext = path.posix.extname(base)
  const runtimeToSource = { '.js': '.ts', '.mjs': '.mts', '.cjs': '.cts' }
  const candidates = [
    base,
    ...(runtimeToSource[ext] ? [`${base.slice(0, -ext.length)}${runtimeToSource[ext]}`] : []),
    ...sourceExtensions.map((extension) => `${base}${extension}`),
    ...sourceExtensions.map((extension) => `${base}/index${extension}`),
  ]
  return candidates.find((candidate) => moduleByPath.has(candidate)) ?? null
}

function sourceOf(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function namedReexportNames(source) {
  const names = []
  namedReexport.lastIndex = 0
  for (let match = namedReexport.exec(source); match; match = namedReexport.exec(source)) {
    for (const item of match[1].split(',')) {
      const clean = item.trim().replace(/^type\s+/, '')
      const alias = clean.split(/\s+as\s+/).pop()?.trim()
      if (alias) names.push(alias)
    }
  }
  return names
}

const effectiveCache = new Map()
function effectiveExports(file, stack = new Set()) {
  if (effectiveCache.has(file)) return effectiveCache.get(file)
  if (stack.has(file)) return new Set()
  const module = moduleByPath.get(file)
  if (!module) return new Set()
  const nextStack = new Set(stack).add(file)
  const names = new Set(module.exports)
  const source = sourceOf(file)
  for (const name of namedReexportNames(source)) names.add(name)

  starReexport.lastIndex = 0
  for (let match = starReexport.exec(source); match; match = starReexport.exec(source)) {
    const target = resolveSource(file, match[1])
    if (!target) continue
    for (const name of effectiveExports(target, nextStack)) {
      if (name !== 'default') names.add(name)
    }
  }
  effectiveCache.set(file, names)
  return names
}

function isPublicEntrypoint(file) {
  return /^packages\/[^/]+\/(?:index|contracts)\.(?:js|ts|mjs|mts|cjs|cts)$/.test(file)
    || /^packages\/structural-analysis\/testing\.(?:js|ts|mjs|mts|cjs|cts)$/.test(file)
}

const publicEntrypoints = report.modules
  .filter((module) => isPublicEntrypoint(module.path))
  .map((module) => ({
    path: module.path,
    exportCount: effectiveExports(module.path).size,
    importerCount: module.importers.length,
  }))
  .sort((left, right) => left.path.localeCompare(right.path))

const largestModules = [...report.modules]
  .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
  .slice(0, 10)
const highestFanOut = [...report.modules]
  .map((module) => ({
    path: module.path,
    dependencies: module.imports.filter((item) => item.relative && item.resolved && moduleByPath.has(item.resolved)).length,
    importers: module.importers.length,
  }))
  .sort((left, right) => right.dependencies - left.dependencies || right.importers - left.importers || left.path.localeCompare(right.path))
  .slice(0, 10)
const testCategories = Object.entries(report.testCategoryCounts)
  .sort(([left], [right]) => left.localeCompare(right))
const unclassifiedTests = report.tests.filter((item) => item.category === 'unclassified')

const lines = [
  '# Architecture Foundation metrics',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `- production modules: **${report.productionModuleCount}**`,
  `- production LOC: **${report.productionLineCount}**`,
  `- tests: **${report.tests.length}**`,
  `- production cycles: **${report.cycles.length}**`,
  `- environment exceptions: **${baseline.environmentExceptions?.length ?? 0}**`,
  `- policy violations: **${violations.length}**`,
  `- unclassified test files: **${unclassifiedTests.length}**`,
  '',
  '## Test responsibility inventory',
  '',
  '| role | test files |',
  '|---|---:|',
  ...testCategories.map(([category, count]) => `| ${category} | ${count} |`),
  ...(unclassifiedTests.length ? [
    '',
    'Unclassified tests:',
    ...unclassifiedTests.map((item) => `- \`${item.path}\``),
  ] : []),
  '',
  '## Public entrypoints',
  '',
  '| entrypoint | effective exports | importers |',
  '|---|---:|---:|',
  ...publicEntrypoints.map((item) => `| \`${item.path}\` | ${item.exportCount} | ${item.importerCount} |`),
  '',
  '## Largest production modules',
  '',
  '| module | LOC | importers | relative dependencies |',
  '|---|---:|---:|---:|',
  ...largestModules.map((module) => `| \`${module.path}\` | ${module.lines} | ${module.importers.length} | ${module.imports.filter((item) => item.relative && item.resolved && moduleByPath.has(item.resolved)).length} |`),
  '',
  '## Highest dependency fan-out',
  '',
  '| module | relative dependencies | importers |',
  '|---|---:|---:|',
  ...highestFanOut.map((item) => `| \`${item.path}\` | ${item.dependencies} | ${item.importers} |`),
  '',
]

process.stdout.write(`${lines.join('\n')}\n`)
