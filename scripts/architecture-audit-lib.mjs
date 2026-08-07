import fs from 'node:fs'
import path from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
const STATIC_IMPORT_RE = /(?:^|\n)\s*import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g
const EXPORT_FROM_RE = /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const EXPORT_DECL_RE = /(?:^|\n)\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
const EXPORT_LIST_RE = /(?:^|\n)\s*export\s*\{([^}]+)\}(?!\s*from)/g
const NODE_PROCESS_ACCESS_RE = /\bprocess\s*(?:\?\.|\.|\[)/

const ENVIRONMENT_GLOBALS = [
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
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...walk(root, child))
    else files.push(normalizePath(child))
  }
  return files
}

// Environment detection does not need a full parser, but it must not scan prose
// in comments/strings. Keeping newlines preserves useful source shape for regexes.
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
      } else if (char === quote) {
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
    } else if (char === '/' && next === '*') {
      result += '  '
      i += 1
      state = 'block-comment'
    } else if (char === '\'' || char === '"' || char === '`') {
      result += ' '
      state = 'string'
      quote = char
    } else result += char
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
      const name = item.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
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
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}/index${extension}`),
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
  for (const [name, regex] of ENVIRONMENT_GLOBALS) if (regex.test(code)) globals.push(name)
  // `process` is also a legitimate domain word/property (for example a weld
  // process). Only property/index access is treated as use of the Node global.
  if (NODE_PROCESS_ACCESS_RE.test(code)) globals.push('process')
  return {
    globals: [...new Set(globals)].sort(),
    nodeImports: [...new Set(parseImports(source).filter((specifier) => specifier.startsWith('node:')))].sort(),
  }
}

function findCycles(graph) {
  const indexByNode = new Map()
  const lowLink = new Map()
  const stack = []
  const onStack = new Set()
  const cycles = []
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
      } else if (onStack.has(next)) lowLink.set(node, Math.min(lowLink.get(node), indexByNode.get(next)))
    }
    if (lowLink.get(node) !== indexByNode.get(node)) return
    const component = []
    let item
    do {
      item = stack.pop()
      onStack.delete(item)
      component.push(item)
    } while (item !== node)
    const selfCycle = component.length === 1 && (graph.get(component[0]) ?? []).includes(component[0])
    if (component.length > 1 || selfCycle) cycles.push(component.sort())
  }

  for (const node of [...graph.keys()].sort()) if (!indexByNode.has(node)) visit(node)
  return cycles.sort((left, right) => left.join('\0').localeCompare(right.join('\0')))
}

function classifyTest(file) {
  const name = file.toLowerCase()
  if (name.includes('architecture-audit')) return 'architecture'
  if (/(triple|crosscheck|equivalence|mixed-module-diameters)/.test(name)) return 'numerical equivalence'
  if (/(usage-scenarios|design-workspace|integrated-3d-viewer|ui\.test)/.test(name)) return 'UI contract'
  if (/(reference-data|obj-export|report|fabrication-project|eskd-export|procurement-estimate)/.test(name)) return 'public API/contract'
  if (/issue[-_]?\d+|issue\d+|regression/.test(name)) return 'characterization'
  if (/(loads|buckling|connection|joint|support|capacity|guy|statics|assembly-mass|geometry|solver|solid-rod)/.test(name)) return 'physics invariant'
  if (/(linear-algebra|banded|catalog|performance|module-stack|module-verification|optimization|verification|weather)/.test(name)) return 'implementation-detail'
  if (name.includes('ci-policy')) return 'obsolete/duplicate candidate'
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
    const imports = parseImports(source).map((specifier) => ({
      specifier,
      resolved: resolveRelativeImport(file, specifier, knownFiles),
      relative: specifier.startsWith('.'),
    }))
    const dependencies = [...new Set(imports
      .filter((item) => item.resolved && knownFiles.has(item.resolved))
      .map((item) => item.resolved))].sort()
    graph.set(file, dependencies)
    for (const dependency of dependencies) importers.get(dependency)?.push(file)
    modules.push({
      path: file,
      layer: classifyLayer(file),
      lines: source.length ? source.split(/\r?\n/).length : 0,
      imports,
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
    const engineering = module.path.startsWith('site/engine/')
    const adapter = adapters.has(module.path)
    for (const global of module.environment.globals) {
      if (engineering && !exceptions.has(exceptionKey(module.path, global))) {
        violations.push({ type: 'environment', path: module.path, detail: global })
      } else if (!engineering && !adapter && !exceptions.has(exceptionKey(module.path, global))) {
        violations.push({ type: 'unclassified-environment', path: module.path, detail: global })
      }
    }
    for (const nodeImport of module.environment.nodeImports) {
      if (engineering && !exceptions.has(exceptionKey(module.path, nodeImport))) {
        violations.push({ type: 'node-import', path: module.path, detail: nodeImport })
      }
    }
    for (const item of module.imports) {
      if (engineering && item.resolved && !item.resolved.startsWith('site/engine/')) {
        violations.push({ type: 'dependency-direction', path: module.path, detail: `${item.specifier} -> ${item.resolved}` })
      }
      if (item.relative && item.resolved && !modulePaths.has(item.resolved)) {
        violations.push({ type: 'unresolved-relative-import', path: module.path, detail: item.specifier })
      }
    }
  }

  const allowedCycles = new Set((baseline.allowedCycles ?? []).map((cycle) => [...cycle].sort().join('\0')))
  for (const cycle of report.cycles) {
    if (!allowedCycles.has([...cycle].sort().join('\0'))) {
      violations.push({ type: 'cycle', path: cycle[0], detail: cycle.join(' -> ') })
    }
  }
  return violations.sort((left, right) => (
    `${left.type}\0${left.path}\0${left.detail}`.localeCompare(`${right.type}\0${right.path}\0${right.detail}`)
  ))
}

export function reportToMarkdown(report, violations = []) {
  const rows = report.modules.map((module) => (
    `| \`${module.path}\` | ${module.layer} | ${module.lines} | ${module.importers.length} | ${module.imports.filter((item) => item.relative).length} | ${module.exports.length} | ${[...module.environment.globals, ...module.environment.nodeImports].join(', ') || '—'} |`
  ))
  const cycles = report.cycles.length
    ? report.cycles.map((cycle) => `- ${cycle.map((item) => `\`${item}\``).join(' → ')}`).join('\n')
    : '- none'
  const policy = violations.length
    ? violations.map((item) => `- **${item.type}** \`${item.path}\`: ${item.detail}`).join('\n')
    : '- none'
  const tests = report.tests.length
    ? report.tests.map((item) => `- \`${item.path}\` — ${item.category}`).join('\n')
    : '- none'
  return `# Generated architecture snapshot\n\nGenerated: ${report.generatedAt}\n\n- production modules: **${report.productionModuleCount}**\n- production LOC: **${report.productionLineCount}**\n- tests: **${report.tests.length}**\n- detected cycles: **${report.cycles.length}**\n- policy violations outside baseline: **${violations.length}**\n\n## Modules\n\n| module | current layer | LOC | importers | relative deps | exports | environment |\n|---|---:|---:|---:|---:|---:|---|\n${rows.join('\n')}\n\n## Cycles\n\n${cycles}\n\n## Policy violations\n\n${policy}\n\n## Test inventory\n\n${tests}\n`
}
