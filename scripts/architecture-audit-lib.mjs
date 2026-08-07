import fs from 'node:fs'
import path from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const STATIC_IMPORT_RE = /(?:^|\n)\s*import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g
const EXPORT_FROM_RE = /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const EXPORT_DECL_RE = /(?:^|\n)\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
const EXPORT_LIST_RE = /(?:^|\n)\s*export\s*\{([^}]+)\}(?!\s*from)/g

const BROWSER_GLOBALS = [
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['self', /\bself\b/],
  ['Worker', /\bWorker\b/],
  ['localStorage', /\blocalStorage\b/],
  ['fetch', /\bfetch\s*\(/],
  ['Blob', /\bBlob\b/],
  ['URL.createObjectURL', /\bURL\s*\.\s*createObjectURL\b/],
  ['Canvas', /\b(?:HTMLCanvasElement|OffscreenCanvas|CanvasRenderingContext2D|WebGLRenderingContext)\b/],
]

const DEFAULT_ADAPTERS = new Set([
  'site/app.js',
  'site/app-bootstrap.js',
  'site/calculation-worker.js',
  'site/design-app.js',
  'site/diameter-profile-ui.js',
  'site/guy-procurement-sync.js',
  'site/guys-app.js',
  'site/joint-viewer.js',
  'site/module-viewer.js',
  'site/procurement-ui.js',
  'site/reference-catalog.js',
  'site/usage-scenarios.js',
  'site/usage-style.js',
  'site/viewer.js',
])

const normalizePath = (value) => value.split(path.sep).join('/')

function walk(root, relative = '') {
  const directory = path.join(root, relative)
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) result.push(...walk(root, child))
    else result.push(normalizePath(child))
  }
  return result
}

function stripCommentsAndStrings(source) {
  let result = ''
  let state = 'code'
  let quote = null
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code'
        result += '\n'
      } else result += ' '
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '  '
        i += 1
        state = 'code'
      } else result += char === '\n' ? '\n' : ' '
      continue
    }
    if (state === 'string') {
      if (char === '\\') {
        result += '  '
        i += 1
        continue
      }
      if (char === quote) {
        result += ' '
        state = 'code'
        quote = null
      } else result += char === '\n' ? '\n' : ' '
      continue
    }
    if (char === '/' && next === '/') {
      result += '  '
      i += 1
      state = 'line-comment'
      continue
    }
    if (char === '/' && next === '*') {
      result += '  '
      i += 1
      state = 'block-comment'
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      result += ' '
      state = 'string'
      quote = char
      continue
    }
    result += char
  }
  return result
}

function collectMatches(source, regex) {
  const values = []
  regex.lastIndex = 0
  for (let match = regex.exec(source); match; match = regex.exec(source)) values.push(match[1])
  return values
}

function parseImports(source) {
  return [...new Set([
    ...collectMatches(source, STATIC_IMPORT_RE),
    ...collectMatches(source, EXPORT_FROM_RE),
    ...collectMatches(source, DYNAMIC_IMPORT_RE),
  ])]
}

function parseExports(source) {
  const names = new Set(collectMatches(source, EXPORT_DECL_RE))
  EXPORT_LIST_RE.lastIndex = 0
  for (let match = EXPORT_LIST_RE.exec(source); match; match = EXPORT_LIST_RE.exec(source)) {
    for (const item of match[1].split(',')) {
      const token = item.trim().split(/\s+as\s+/).pop()?.trim()
      if (token) names.add(token)
    }
  }
  if (/\bexport\s+default\b/.test(source)) names.add('default')
  return [...names].sort()
}

function resolveRelativeImport(fromFile, specifier, knownFiles) {
  if (!specifier.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((ext) => `${base}${ext}`),
    ...[...SOURCE_EXTENSIONS].map((ext) => `${base}/index${ext}`),
  ]
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? base
}

function classifyLayer(file) {
  if (file.startsWith('site/engine/')) return 'engineering-current'
  if (file === 'site/calculation-worker.js') return 'transport-adapter'
  if (DEFAULT_ADAPTERS.has(file)) return 'web-adapter'
  if (file.startsWith('site/')) return 'web-static-or-unclassified'
  if (file.startsWith('scripts/')) return 'tooling'
  if (file.startsWith('tests/')) return 'test'
  return 'other'
}

function environmentUsage(source) {
  const code = stripCommentsAndStrings(source)
  const globals = []
  for (const [name, regex] of BROWSER_GLOBALS) if (regex.test(code)) globals.push(name)
  const nodeImports = parseImports(source).filter((specifier) => specifier.startsWith('node:'))
  if (/\bprocess\b/.test(code)) globals.push('process')
  return {
    globals: [...new Set(globals)].sort(),
    nodeImports: [...new Set(nodeImports)].sort(),
  }
}

function findCycles(graph) {
  const indexByNode = new Map()
  const lowLink = new Map()
  const stack = []
  const onStack = new Set()
  const components = []
  let index = 0

  const visit = (node) => {
    indexByNode.set(node, index)
    lowLink.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue
      if (!indexByNode.has(next)) {
        visit(next)
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(next)))
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node), indexByNode.get(next)))
      }
    }
    if (lowLink.get(node) === indexByNode.get(node)) {
      const component = []
      let item
      do {
        item = stack.pop()
        onStack.delete(item)
        component.push(item)
      } while (item !== node)
      const selfCycle = component.length === 1 && (graph.get(component[0]) ?? []).includes(component[0])
      if (component.length > 1 || selfCycle) components.push(component.sort())
    }
  }

  for (const node of [...graph.keys()].sort()) if (!indexByNode.has(node)) visit(node)
  return components.sort((a, b) => a.join('\0').localeCompare(b.join('\0')))
}

function classifyTest(file) {
  const name = file.toLowerCase()
  if (name.includes('architecture-audit')) return 'architecture'
  if (/(triple|crosscheck|equivalence|mixed-module-diameters)/.test(name)) return 'numerical equivalence'
  if (/(usage-scenarios|design-workspace|integrated-3d-viewer)/.test(name)) return 'UI contract'
  if (/(design-package|reference-data|obj-export|report|calculation-project)/.test(name)) return 'public API/contract'
  if (/issue\d+|regression/.test(name)) return 'characterization'
  if (/(loads|buckling|connection|joint|support|capacity|guy|statics|assembly-mass|geometry|solver)/.test(name)) return 'physics invariant'
  if (/(linear-algebra|banded|catalog)/.test(name)) return 'implementation-detail'
  return 'unclassified'
}

export function analyzeRepository(root) {
  const allFiles = walk(root)
  const productionFiles = allFiles
    .filter((file) => file.startsWith('site/') && SOURCE_EXTENSIONS.has(path.posix.extname(file)))
    .sort()
  const knownFiles = new Set(productionFiles)
  const modules = []
  const graph = new Map()
  const importers = new Map(productionFiles.map((file) => [file, []]))

  for (const file of productionFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const specifiers = parseImports(source)
    const resolvedImports = specifiers.map((specifier) => ({
      specifier,
      resolved: resolveRelativeImport(file, specifier, knownFiles),
      relative: specifier.startsWith('.'),
    }))
    const dependencies = resolvedImports
      .filter((item) => item.resolved && knownFiles.has(item.resolved))
      .map((item) => item.resolved)
    graph.set(file, [...new Set(dependencies)].sort())
    for (const dependency of dependencies) importers.get(dependency)?.push(file)
    modules.push({
      path: file,
      layer: classifyLayer(file),
      lines: source.length ? source.split(/\r?\n/).length : 0,
      imports: resolvedImports,
      exports: parseExports(source),
      environment: environmentUsage(source),
      sideEffectImport: /(?:^|\n)\s*import\s*['"][^'"]+['"]/.test(source),
    })
  }

  for (const module of modules) module.importers = [...(importers.get(module.path) ?? [])].sort()
  const tests = allFiles
    .filter((file) => file.startsWith('tests/') && /\.test\.(?:js|mjs|cjs)$/i.test(file))
    .sort()
    .map((file) => ({ path: file, category: classifyTest(file) }))

  return {
    generatedAt: new Date().toISOString(),
    productionModuleCount: modules.length,
    productionLineCount: modules.reduce((sum, module) => sum + module.lines, 0),
    modules,
    cycles: findCycles(graph),
    tests,
    testCategoryCounts: tests.reduce(
      (counts, item) => ({ ...counts, [item.category]: (counts[item.category] ?? 0) + 1 }),
      {},
    ),
  }
}

const exceptionKey = (file, global) => `${file}\0${global}`

export function evaluatePolicy(report, baseline = {}) {
  const adapters = new Set(baseline.appAdapters ?? [...DEFAULT_ADAPTERS])
  const exceptions = new Map(
    (baseline.environmentExceptions ?? []).map((item) => [exceptionKey(item.path, item.global), item]),
  )
  const modulePaths = new Set(report.modules.map((module) => module.path))
  const violations = []

  for (const module of report.modules) {
    const isEngineering = module.path.startsWith('site/engine/')
    const isAdapter = adapters.has(module.path)
    for (const global of module.environment.globals) {
      if (isEngineering && !exceptions.has(exceptionKey(module.path, global))) {
        violations.push({ type: 'environment', path: module.path, detail: global })
      } else if (!isEngineering && !isAdapter && !exceptions.has(exceptionKey(module.path, global))) {
        violations.push({ type: 'unclassified-environment', path: module.path, detail: global })
      }
    }
    for (const nodeImport of module.environment.nodeImports) {
      if (isEngineering && !exceptions.has(exceptionKey(module.path, nodeImport))) {
        violations.push({ type: 'node-import', path: module.path, detail: nodeImport })
      }
    }
    for (const item of module.imports) {
      if (isEngineering && item.resolved && !item.resolved.startsWith('site/engine/')) {
        violations.push({
          type: 'dependency-direction',
          path: module.path,
          detail: `${item.specifier} -> ${item.resolved}`,
        })
      }
      if (item.relative && item.resolved && !modulePaths.has(item.resolved)) {
        violations.push({ type: 'unresolved-relative-import', path: module.path, detail: item.specifier })
      }
    }
  }

  const allowedCycles = new Set(
    (baseline.allowedCycles ?? []).map((cycle) => [...cycle].sort().join('\0')),
  )
  for (const cycle of report.cycles) {
    if (!allowedCycles.has([...cycle].sort().join('\0'))) {
      violations.push({ type: 'cycle', path: cycle[0], detail: cycle.join(' -> ') })
    }
  }

  return violations.sort((a, b) => (
    `${a.type}\0${a.path}\0${a.detail}`.localeCompare(`${b.type}\0${b.path}\0${b.detail}`)
  ))
}

export function reportToMarkdown(report, violations = []) {
  const rows = report.modules.map((module) => (
    `| \`${module.path}\` | ${module.layer} | ${module.lines} | ${module.importers.length} | ${module.imports.filter((item) => item.relative).length} | ${module.exports.length} | ${[...module.environment.globals, ...module.environment.nodeImports].join(', ') || '—'} |`
  ))
  const cycleText = report.cycles.length
    ? report.cycles.map((cycle) => `- ${cycle.map((item) => `\`${item}\``).join(' → ')}`).join('\n')
    : '- none'
  const violationText = violations.length
    ? violations.map((item) => `- **${item.type}** \`${item.path}\`: ${item.detail}`).join('\n')
    : '- none'
  const testText = report.tests.length
    ? report.tests.map((item) => `- \`${item.path}\` — ${item.category}`).join('\n')
    : '- none'
  return `# Generated architecture snapshot\n\nGenerated: ${report.generatedAt}\n\n- production modules: **${report.productionModuleCount}**\n- production LOC: **${report.productionLineCount}**\n- tests: **${report.tests.length}**\n- detected cycles: **${report.cycles.length}**\n- policy violations outside baseline: **${violations.length}**\n\n## Modules\n\n| module | current layer | LOC | importers | relative deps | exports | environment |\n|---|---:|---:|---:|---:|---:|---|\n${rows.join('\n')}\n\n## Cycles\n\n${cycleText}\n\n## Policy violations\n\n${violationText}\n\n## Test inventory\n\n${testText}\n`
}
