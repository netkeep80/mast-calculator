import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const posix = path.posix

const PACKAGE_FILES = {
  domain: [
    'catalog.js',
    'diameter-profile.js',
    'connection-catalog.js',
    'guy-wire-catalog.js',
    'joint-hardware-catalog.js',
    'metric-thread-catalog.js',
    'weather.js',
    'weld-service-degradation.js',
  ],
  numerics: ['linear-algebra.js', 'banded.js', 'vector.js'],
  'structural-analysis': [
    'geometry.js',
    'loads.js',
    'solver.js',
    'reference-frame.js',
    'module-stack.js',
    'module-verification.js',
    'buckling.js',
    'guy-wire-system.js',
    'weld-zone-stiffness.js',
  ],
  engineering: [
    'bolt-check.js',
    'bolt-preload.js',
    'connection-check.js',
    'crane-boom-capacity.js',
    'joint-configurator.js',
    'joint-demand.js',
    'joint-section-check.js',
    'joint-strength-parameters.js',
    'lateral-capacity.js',
    'static-payload-capacity.js',
    'verification.js',
    'mixed-diameter-verification.js',
    'weld-check.js',
  ],
  application: ['calculate.js', 'complete-calculation.js', 'optimize.js', 'reference-data.js'],
  design: [
    'assembly-mass.js',
    'procurement-estimate.js',
    'design-package.js',
    'detailed-mast-model.js',
    'joint-visual-geometry.js',
    'technical-projection.js',
    'obj-export.js',
  ],
  reporting: [
    'report.js',
    'calculation-note.js',
    'calculation-project.js',
    'fabrication-project-appendix.js',
    'eskd-construction-documentation.js',
  ],
}

const normalize = (value) => value.split(path.sep).join('/')
const absolute = (relative) => path.join(root, ...relative.split('/'))
const exists = (relative) => fs.existsSync(absolute(relative))

function walk(relative) {
  const target = absolute(relative)
  if (!fs.existsSync(target)) return []
  const result = []
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = normalize(path.join(relative, entry.name))
    if (entry.isDirectory()) result.push(...walk(child))
    else result.push(child)
  }
  return result
}

const mapping = new Map()
const packageByOldPath = new Map()
for (const [packageName, files] of Object.entries(PACKAGE_FILES)) {
  for (const file of files) {
    const oldPath = `site/engine/${file}`
    const newPath = `packages/${packageName}/src/${file}`
    if (!exists(oldPath)) throw new Error(`Missing expected engine file: ${oldPath}`)
    mapping.set(oldPath, newPath)
    packageByOldPath.set(oldPath, packageName)
  }
}

for (const oldPath of walk('site')) {
  if (oldPath.startsWith('site/engine/')) continue
  const relative = oldPath.slice('site/'.length)
  mapping.set(oldPath, `apps/web/${relative}`)
}

const sourceExtensions = new Set(['.js', '.mjs', '.cjs'])
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.sh', '.txt'])
const allFilesBefore = walk('.').filter((file) => !file.startsWith('.git/'))
const sources = new Map()
for (const file of allFilesBefore) {
  if (!textExtensions.has(posix.extname(file).toLowerCase())) continue
  sources.set(file, fs.readFileSync(absolute(file), 'utf8'))
}

// Split project parameter resolution out of the orchestration file so lower
// structural layers do not depend on application/calculate.js.
{
  const file = 'site/engine/calculate.js'
  let source = sources.get(file)
  const start = source.indexOf('export const DEFAULT_PARAMETERS = Object.freeze({')
  const end = source.indexOf('\nconst canonicalSymmetryAngle')
  if (start < 0 || end < 0 || end <= start) throw new Error('Cannot locate parameter block in calculate.js')
  const parameterBlock = source.slice(start, end).trim()
  const projectParameters = `import {\n  applyReinforcementClass,\n  regularOctahedronHeightMm,\n  theoreticalCutLengthMm,\n} from './catalog.js'\nimport { resolveWindParameters, windSpeedFromPressurePa } from './weather.js'\n\nexport const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15\n\n${parameterBlock}\n`
  sources.set('__new_project_parameters__', projectParameters)

  source = source.slice(0, start) + source.slice(end + 1)
  source = source.replace(
    "import {\n  applyReinforcementClass,\n  regularOctahedronHeightMm,\n  theoreticalCutLengthMm,\n} from './catalog.js'\n",
    '',
  )
  source = source.replace(
    "import { resolveWindParameters, windSpeedFromPressurePa } from './weather.js'\n",
    '',
  )
  source = source.replace('  DEFAULT_LATERAL_CAPACITY_STEP_DEG,\n', '')
  sources.set(file, source)
}

// Browser persistence is an adapter, not part of the portable design package.
{
  const file = 'site/engine/design-package.js'
  let source = sources.get(file)
  source = source.replace("export const DESIGN_PACKAGE_STORAGE_KEY = 'mast-calculator:last-design-package:v1'\n", '')
  source = source.replace('const MAX_LOCAL_STORAGE_BYTES = 4_500_000\n', '')
  const storageStart = source.indexOf('\nexport function saveDesignPackage(')
  if (storageStart < 0) throw new Error('Cannot locate design package storage functions')
  source = `${source.slice(0, storageStart).trimEnd()}\n`
  sources.set(file, source)

  sources.set('__new_design_storage__', `import {\n  buildDesignPackage,\n  parseDesignPackage,\n  serializeDesignPackage,\n} from '../../packages/design/index.js'\n\nexport const DESIGN_PACKAGE_STORAGE_KEY = 'mast-calculator:last-design-package:v1'\nconst MAX_LOCAL_STORAGE_BYTES = 4_500_000\n\nexport function saveDesignPackage(value, storage = globalThis.localStorage) {\n  const text = serializeDesignPackage(value)\n  const bytes = new TextEncoder().encode(text).length\n  if (bytes > MAX_LOCAL_STORAGE_BYTES) {\n    throw new Error(\`Пакет 3D/КД слишком велик для localStorage (\${Math.round(bytes / 1024)} КиБ)\`)\n  }\n  if (!storage?.setItem) throw new Error('localStorage недоступен')\n  storage.setItem(DESIGN_PACKAGE_STORAGE_KEY, text)\n  return { bytes, text }\n}\n\nexport function saveDesignResult(result, metadata = {}, storage = globalThis.localStorage) {\n  const designPackage = buildDesignPackage(result, metadata)\n  return { designPackage, ...saveDesignPackage(designPackage, storage) }\n}\n\nexport function loadDesignPackage(storage = globalThis.localStorage) {\n  if (!storage?.getItem) return null\n  const text = storage.getItem(DESIGN_PACKAGE_STORAGE_KEY)\n  return text ? parseDesignPackage(text) : null\n}\n`)

  const splitPersistenceImport = (filePath) => {
    let text = sources.get(filePath)
    if (!text) return
    const marker = "} from './engine/design-package.js'"
    const markerIndex = text.indexOf(marker)
    if (markerIndex < 0) return
    const importStart = text.lastIndexOf('import {', markerIndex)
    if (importStart < 0) return
    const importText = text.slice(importStart, markerIndex + marker.length)
    if (!/loadDesignPackage|saveDesignPackage|DESIGN_PACKAGE_STORAGE_KEY/.test(importText)) return
    const names = importText
      .slice(importText.indexOf('{') + 1, importText.lastIndexOf('}'))
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const browserNames = names.filter((name) => ['loadDesignPackage', 'saveDesignPackage', 'saveDesignResult', 'DESIGN_PACKAGE_STORAGE_KEY'].includes(name))
    const pureNames = names.filter((name) => !browserNames.includes(name))
    const replacement = [
      pureNames.length ? `import {\n  ${pureNames.join(',\n  ')},\n} from './engine/design-package.js'` : '',
      browserNames.length ? `import {\n  ${browserNames.join(',\n  ')},\n} from './design-storage.js'` : '',
    ].filter(Boolean).join('\n')
    text = text.slice(0, importStart) + replacement + text.slice(markerIndex + marker.length)
    sources.set(filePath, text)
  }
  splitPersistenceImport('site/design-app.js')
}

// Tests deliberately exercise the browser storage adapter separately from the
// portable codec.
{
  const file = 'tests/design-workspace.test.js'
  let source = sources.get(file)
  const marker = "} from '../site/engine/design-package.js'"
  const markerIndex = source.indexOf(marker)
  const importStart = source.lastIndexOf('import {', markerIndex)
  if (markerIndex >= 0 && importStart >= 0) {
    const importText = source.slice(importStart, markerIndex + marker.length)
    const names = importText
      .slice(importText.indexOf('{') + 1, importText.lastIndexOf('}'))
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const browserNames = names.filter((name) => ['loadDesignPackage', 'saveDesignPackage', 'saveDesignResult', 'DESIGN_PACKAGE_STORAGE_KEY'].includes(name))
    const pureNames = names.filter((name) => !browserNames.includes(name))
    const replacement = [
      `import {\n  ${pureNames.join(',\n  ')},\n} from '../site/engine/design-package.js'`,
      `import {\n  ${browserNames.join(',\n  ')},\n} from '../site/design-storage.js'`,
    ].join('\n')
    source = source.slice(0, importStart) + replacement + source.slice(markerIndex + marker.length)
    sources.set(file, source)
  }
}

function resolveOldRelative(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier))
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.js`]
  return candidates.find((candidate) => mapping.has(candidate) || sources.has(candidate)) ?? base
}

function publicTarget(newTarget, oldTarget, newSource) {
  if (!newTarget.startsWith('packages/')) return newTarget
  const targetPackage = newTarget.split('/')[1]
  const sourcePackage = newSource.startsWith('packages/') ? newSource.split('/')[1] : null
  if (sourcePackage === targetPackage) return newTarget
  if (oldTarget === 'site/engine/reference-frame.js') return 'packages/structural-analysis/testing.js'
  return `packages/${targetPackage}/index.js`
}

function relativeSpecifier(fromFile, toFile) {
  let value = posix.relative(posix.dirname(fromFile), toFile)
  if (!value.startsWith('.')) value = `./${value}`
  return value
}

const importPatterns = [
  /((?:^|\n)\s*import\s+(?:[^'";]+?\s+from\s+)?)(['"])([^'"]+)(\2)/g,
  /((?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"]+)(\2)/g,
  /(\bimport\s*\(\s*)(['"])([^'"]+)(\2)(\s*\))/g,
]

function rewriteImports(oldFile, newFile, source) {
  let result = source
  for (const pattern of importPatterns) {
    pattern.lastIndex = 0
    result = result.replace(pattern, (...args) => {
      const full = args[0]
      const prefix = args[1]
      const quote = args[2]
      const specifier = args[3]
      const suffix = pattern === importPatterns[2] ? args[5] : ''
      if (!specifier.startsWith('.')) return full
      const oldTarget = resolveOldRelative(oldFile, specifier)
      if (!oldTarget || !mapping.has(oldTarget)) return full
      const movedTarget = mapping.get(oldTarget)
      const target = publicTarget(movedTarget, oldTarget, newFile)
      return `${prefix}${quote}${relativeSpecifier(newFile, target)}${quote}${suffix}`
    })
  }
  return result
}

const finalFiles = new Map()
for (const [oldFile, source] of sources) {
  if (oldFile.startsWith('__new_')) continue
  const newFile = mapping.get(oldFile) ?? oldFile
  finalFiles.set(newFile, sourceExtensions.has(posix.extname(oldFile))
    ? rewriteImports(oldFile, newFile, source)
    : source)
}

// Add the extracted lower-layer parameter resolver.
finalFiles.set('packages/domain/src/project-parameters.js', sources.get('__new_project_parameters__'))

// Application orchestration consumes the canonical parameter resolver from domain.
{
  const file = 'packages/application/src/calculate.js'
  let source = finalFiles.get(file)
  source = `import { DEFAULT_PARAMETERS, resolveCalculationParameters } from '../../domain/index.js'\n${source}`
  finalFiles.set(file, source)
}

// Guy analysis is lower than application and therefore resolves parameters from domain.
{
  const file = 'packages/structural-analysis/src/guy-wire-system.js'
  let source = finalFiles.get(file)
  source = source.replace(
    "import { resolveCalculationParameters } from '../../application/index.js'",
    "import { resolveCalculationParameters } from '../../domain/index.js'",
  )
  finalFiles.set(file, source)
}

// One canonical default for lateral search step lives with project parameter semantics.
{
  const file = 'packages/engineering/src/lateral-capacity.js'
  let source = finalFiles.get(file)
  source = source.replace('export const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15\n', '')
  source = `import { DEFAULT_LATERAL_CAPACITY_STEP_DEG } from '../../domain/index.js'\nexport { DEFAULT_LATERAL_CAPACITY_STEP_DEG } from '../../domain/index.js'\n${source}`
  finalFiles.set(file, source)
}

finalFiles.set('apps/web/design-storage.js', sources.get('__new_design_storage__'))

for (const [packageName, files] of Object.entries(PACKAGE_FILES)) {
  const exports = files
    .filter((file) => !(packageName === 'structural-analysis' && file === 'reference-frame.js'))
    .map((file) => `export * from './src/${file}'`)
  if (packageName === 'domain') exports.push("export * from './src/project-parameters.js'")
  if (packageName === 'application') {
    exports.push("export { DEFAULT_PARAMETERS, resolveCalculationParameters, DEFAULT_LATERAL_CAPACITY_STEP_DEG } from '../domain/index.js'")
  }
  finalFiles.set(`packages/${packageName}/index.js`, `${exports.join('\n')}\n`)
}
finalFiles.set(
  'packages/structural-analysis/testing.js',
  "// Verification/test-support entrypoint. Not part of the production FEM API.\nexport * from './src/reference-frame.js'\n",
)

// Remove moved originals first, then write canonical paths.
for (const oldFile of mapping.keys()) {
  if (fs.existsSync(absolute(oldFile))) fs.rmSync(absolute(oldFile), { force: true })
}
if (fs.existsSync(absolute('site/engine'))) fs.rmSync(absolute('site/engine'), { recursive: true, force: true })
if (fs.existsSync(absolute('site')) && fs.readdirSync(absolute('site')).length === 0) fs.rmdirSync(absolute('site'))

for (const [file, content] of finalFiles) {
  fs.mkdirSync(path.dirname(absolute(file)), { recursive: true })
  fs.writeFileSync(absolute(file), content)
}

// Source-path assertions: the old implementation must be gone.
if (fs.existsSync(absolute('site/engine'))) throw new Error('Legacy site/engine still exists after migration')
for (const oldFile of mapping.keys()) {
  if (fs.existsSync(absolute(oldFile))) throw new Error(`Legacy moved path still exists: ${oldFile}`)
}

console.log(`Moved ${mapping.size} tracked source files into packages/ and apps/web/.`)
console.log(`Packages: ${Object.entries(PACKAGE_FILES).map(([name, list]) => `${name}=${list.length}`).join(', ')}`)
