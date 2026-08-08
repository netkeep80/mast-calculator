import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const INITIAL_WEB_BUDGET_BYTES = 1024 * 1024
const WEB_CODE_BUDGET_BYTES = 6 * 1024 * 1024
const OPTIMIZATION_BUDGET_MS = 45_000
const DESIGN_OBJ_BUDGET_MS = 5_000
const OBJ_SIZE_BUDGET_BYTES = 12 * 1024 * 1024

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...walkFiles(file))
    else if (entry.isFile()) result.push(file)
  }
  return result
}

execFileSync(npmCommand, ['run', 'build:web'], { cwd: root, stdio: 'inherit' })

const webRoot = path.join(root, '_site')
const initialWebAssets = [
  'index.html',
  'apps/web/app-bootstrap.js',
  'apps/web/app.js',
  'apps/web/file-adapter.js',
  'apps/web/runtime-info.js',
].map((relative) => path.join(webRoot, relative))
for (const file of initialWebAssets) {
  if (!fs.existsSync(file)) throw new Error(`Initial Web asset is missing: ${path.relative(root, file)}`)
}
const initialWebBytes = initialWebAssets.reduce((sum, file) => sum + fs.statSync(file).size, 0)
if (initialWebBytes > INITIAL_WEB_BUDGET_BYTES) {
  throw new Error(`Initial Web shell exceeds ${INITIAL_WEB_BUDGET_BYTES} bytes: ${initialWebBytes}`)
}

const codeAssets = walkFiles(webRoot).filter((file) => /\.(?:html|js|css|json)$/i.test(file))
const webCodeBytes = codeAssets.reduce((sum, file) => sum + fs.statSync(file).size, 0)
if (webCodeBytes > WEB_CODE_BUDGET_BYTES) {
  throw new Error(`Web code assets exceed ${WEB_CODE_BUDGET_BYTES} bytes: ${webCodeBytes}`)
}

const application = await import(pathToFileURL(path.join(root, '.build', 'packages', 'application', 'index.js')).href)
const design = await import(pathToFileURL(path.join(root, '.build', 'packages', 'design', 'index.js')).href)

const input = application.createProjectInput({
  geometry: { moduleCount: 2, barDiameterMm: 12 },
  environment: {
    windPresetId: 'custom',
    windPressurePa: 250,
    windEnvelopeEnabled: false,
    lateralCapacityStepDeg: 60,
  },
  criteria: { heightSearchMaxModules: 2 },
})

const optimizationStarted = performance.now()
const optimization = application.optimizeAndCalculateProject(input, {
  diameters: [10, 12, 14, 16],
})
const optimizationElapsedMs = performance.now() - optimizationStarted
if (optimizationElapsedMs > OPTIMIZATION_BUDGET_MS) {
  throw new Error(`Representative optimization exceeded ${OPTIMIZATION_BUDGET_MS} ms: ${optimizationElapsedMs.toFixed(0)} ms`)
}

const calculation = optimization.result ?? application.calculateProject(input)
const designStarted = performance.now()
const designPackage = application.createDesignPackage(calculation, {
  createdAt: '2000-01-01T00:00:00.000Z',
  repository: 'netkeep80/mast-calculator',
  ref: 'performance-budget',
  sha: 'performance-budget',
})
const serializedDesign = design.serializeDesignPackage(designPackage)
const obj = design.createMastObj(calculation)
const designElapsedMs = performance.now() - designStarted
if (designElapsedMs > DESIGN_OBJ_BUDGET_MS) {
  throw new Error(`Design/OBJ generation exceeded ${DESIGN_OBJ_BUDGET_MS} ms: ${designElapsedMs.toFixed(0)} ms`)
}
const objBytes = Buffer.byteLength(obj)
if (objBytes > OBJ_SIZE_BUDGET_BYTES) {
  throw new Error(`Representative OBJ exceeds ${OBJ_SIZE_BUDGET_BYTES} bytes: ${objBytes}`)
}

console.info([
  `Initial Web shell: ${(initialWebBytes / 1024).toFixed(1)} KiB / ${(INITIAL_WEB_BUDGET_BYTES / 1024).toFixed(0)} KiB`,
  `Web code assets: ${(webCodeBytes / 1024).toFixed(1)} KiB / ${(WEB_CODE_BUDGET_BYTES / 1024).toFixed(0)} KiB`,
  `Optimization: ${optimizationElapsedMs.toFixed(1)} ms / ${OPTIMIZATION_BUDGET_MS} ms`,
  `Design + OBJ: ${designElapsedMs.toFixed(1)} ms / ${DESIGN_OBJ_BUDGET_MS} ms`,
  `Design JSON: ${(Buffer.byteLength(serializedDesign) / 1024).toFixed(1)} KiB`,
  `OBJ: ${(objBytes / 1024).toFixed(1)} KiB / ${(OBJ_SIZE_BUDGET_BYTES / 1024).toFixed(0)} KiB`,
].join('\n'))
