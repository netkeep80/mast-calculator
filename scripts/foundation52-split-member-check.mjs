import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const write = (file, content) => fs.writeFileSync(file, content)
const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Missing ${label}`)
  return source.replace(from, to)
}

// 1. Extract the existing member-strength formula verbatim from the structural solver.
const solverFile = 'packages/structural-analysis/src/solver.js'
let solver = read(solverFile)
const strengthStart = solver.indexOf('function memberStrengthResult(')
const strengthEnd = solver.indexOf('function buildFreeDofs(', strengthStart)
if (strengthStart < 0 || strengthEnd < 0) throw new Error('Cannot locate memberStrengthResult in structural solver')
const strengthFunction = solver.slice(strengthStart, strengthEnd).trimEnd()
const rawActionHelper = `function memberActionResult(localEndForces) {\n  const axialA = -localEndForces[0]\n  const axialB = localEndForces[6]\n  return {\n    axialForceAtAN: axialA,\n    axialForceAtBN: axialB,\n  }\n}\n\n`
solver = `${solver.slice(0, strengthStart)}${rawActionHelper}${solver.slice(strengthEnd)}`
solver = replaceRequired(
  solver,
  '    const strength = memberStrengthResult(member, geometry, localEndForces, parameters, load.distributedLocal)\n',
  '',
  'member strength calculation',
)
solver = replaceRequired(
  solver,
  '      ...strength,\n',
  '      ...memberActionResult(localEndForces),\n',
  'member strength result spread',
)
solver = replaceRequired(
  solver,
  `  const critical = memberResults.reduce((current, candidate) => (\n    candidate.utilization > current.utilization ? candidate : current\n  ), memberResults[0])\n\n`,
  '',
  'structural critical member summary',
)
solver = replaceRequired(
  solver,
  '    maxUtilization: critical.utilization,\n    criticalMemberId: critical.memberId,\n',
  '    maxUtilization: null,\n    criticalMemberId: null,\n',
  'structural utilization summary',
)
write(solverFile, solver)

// 2. Engineering owns the exact formula and decorates a raw structural response.
const memberCheck = `import { analyzeFrame, compileFrameSystem } from '../../structural-analysis/index.js'\n\n${strengthFunction}\n\nexport function applyMemberChecksToAnalysis(model, analysis, parameters, frameSystem) {\n  if (!frameSystem?.memberGeometry) throw new Error('Для engineering member checks требуется compiled frame system')\n  const memberResults = analysis.memberResults.map((raw) => {\n    const member = model.members[raw.memberId]\n    const geometry = frameSystem.memberGeometry[raw.memberId]\n    if (!member || !geometry) throw new Error(\`Не найдены member/geometry для engineering check \${raw.memberId}\`)\n    return {\n      ...raw,\n      ...memberStrengthResult(\n        member,\n        geometry,\n        raw.localEndForces,\n        parameters,\n        raw.distributedLoadLocalNPerM ?? [0, 0, 0],\n      ),\n    }\n  })\n  const criticalMember = memberResults.reduce((best, candidate) => (\n    candidate.utilization > best.utilization ? candidate : best\n  ), memberResults[0])\n  return {\n    ...analysis,\n    memberResults,\n    maxUtilization: criticalMember?.utilization ?? 0,\n    criticalMemberId: criticalMember?.memberId ?? null,\n  }\n}\n\nexport function analyzeCheckedFrame(model, loads, parameters, frameSystem = null) {\n  const system = frameSystem ?? compileFrameSystem(model, parameters)\n  const analysis = analyzeFrame(model, loads, parameters, system)\n  return applyMemberChecksToAnalysis(model, analysis, parameters, system)\n}\n`
write('packages/engineering/src/member-check.js', memberCheck)

// 3. Production orchestration and capacity checks call the engineering wrapper.
{
  const file = 'packages/application/src/calculate.js'
  let source = read(file)
  source = replaceRequired(
    source,
    "import { calculateConnectionChecks } from '../../engineering/index.js'",
    "import { analyzeCheckedFrame, calculateConnectionChecks } from '../../engineering/index.js'",
    'application engineering import',
  )
  source = replaceRequired(
    source,
    "import { analyzeFrame, compileFrameSystem } from '../../structural-analysis/index.js'",
    "import { compileFrameSystem } from '../../structural-analysis/index.js'",
    'application structural solver import',
  )
  source = source.replaceAll('analyzeFrame(', 'analyzeCheckedFrame(')
  write(file, source)
}

for (const file of [
  'packages/engineering/src/lateral-capacity.js',
  'packages/engineering/src/static-payload-capacity.js',
  'packages/engineering/src/crane-boom-capacity.js',
]) {
  let source = read(file)
  source = replaceRequired(
    source,
    "import { analyzeFrame, compileFrameSystem } from '../../structural-analysis/index.js'",
    "import { compileFrameSystem } from '../../structural-analysis/index.js'\nimport { analyzeCheckedFrame } from './member-check.js'",
    `${file} structural solver import`,
  )
  source = source.replaceAll('analyzeFrame(', 'analyzeCheckedFrame(')
  write(file, source)
}

// 4. Guy-wire solver includes engineering acceptance checks, so it moves up one layer.
const oldGuy = 'packages/structural-analysis/src/guy-wire-system.js'
const newGuy = 'packages/engineering/src/guy-wire-system.js'
let guy = read(oldGuy)
guy = replaceRequired(guy, "import { generateMastModel } from './geometry.js'\n", '', 'guy geometry import')
guy = replaceRequired(guy, "import { buildLoadCase } from './loads.js'\n", '', 'guy loads import')
guy = replaceRequired(guy, "import { analyzeFrame, compileFrameSystem } from './solver.js'\n", '', 'guy solver import')
guy = `import {\n  buildLoadCase,\n  compileFrameSystem,\n  generateMastModel,\n} from '../../structural-analysis/index.js'\nimport { analyzeCheckedFrame } from './member-check.js'\n${guy}`
guy = guy.replaceAll('analyzeFrame(', 'analyzeCheckedFrame(')
write(newGuy, guy)
fs.rmSync(oldGuy)

let structuralIndex = read('packages/structural-analysis/index.js')
structuralIndex = structuralIndex.replace("export * from './src/guy-wire-system.js'\n", '')
write('packages/structural-analysis/index.js', structuralIndex)

let engineeringIndex = read('packages/engineering/index.js')
if (!engineeringIndex.includes("./src/member-check.js")) engineeringIndex += "export * from './src/member-check.js'\n"
if (!engineeringIndex.includes("./src/guy-wire-system.js")) engineeringIndex += "export * from './src/guy-wire-system.js'\n"
write('packages/engineering/index.js', engineeringIndex)

// 5. Application and consumers use the new owner/public API.
{
  const file = 'packages/application/src/use-cases.js'
  let source = read(file)
  source = replaceRequired(
    source,
    "import { calculateGuyedMast, augmentVerificationWithModuleChecks } from '../../structural-analysis/index.js'",
    "import { augmentVerificationWithModuleChecks } from '../../structural-analysis/index.js'\nimport { calculateGuyedMast } from '../../engineering/index.js'",
    'application guy use-case import',
  )
  write(file, source)
}

{
  const file = 'scripts/generate-canonical-baseline.mjs'
  let source = read(file)
  source = replaceRequired(
    source,
    "import { calculateGuyedMast } from '../packages/structural-analysis/index.js'",
    "import { calculateGuyedMast } from '../packages/engineering/index.js'",
    'canonical guy import',
  )
  write(file, source)
}

{
  const file = 'tests/guy-wires-issue23.test.js'
  let source = read(file)
  source = replaceRequired(
    source,
    "} from '../packages/structural-analysis/index.js'\n\nconst approximately",
    "} from '../packages/engineering/index.js'\n\nconst approximately",
    'guy test owner import',
  )
  write(file, source)
}

{
  const file = 'apps/web/guys-app.js'
  let source = read(file)
  source = replaceRequired(
    source,
    "import { DEFAULT_PARAMETERS, calculateMast, resolveCalculationParameters } from '../../packages/application/index.js'",
    "import { DEFAULT_PARAMETERS, calculateGuyedProject, calculateMast, resolveCalculationParameters } from '../../packages/application/index.js'",
    'guys web application import',
  )
  source = replaceRequired(
    source,
    "import { calculateGuyedMast } from '../../packages/structural-analysis/index.js'\n",
    '',
    'guys web structural import',
  )
  source = source.replaceAll('calculateGuyedMast(', 'calculateGuyedProject(')
  write(file, source)
}

{
  const file = 'tests/package-entrypoints.test.js'
  let source = read(file)
  source = source.replace(
    "['structural-analysis', structural, ['generateMastModel', 'analyzeFrame', 'calculateGuyedMast']],",
    "['structural-analysis', structural, ['generateMastModel', 'analyzeFrame', 'compileFrameSystem']],",
  )
  source = source.replace(
    "['engineering', engineering, ['calculateConnectionChecks', 'calculateLateralCapacity', 'buildVerificationPassport']],",
    "['engineering', engineering, ['analyzeCheckedFrame', 'calculateConnectionChecks', 'calculateGuyedMast', 'calculateLateralCapacity', 'buildVerificationPassport']],",
  )
  write(file, source)
}

console.log('Moved member acceptance checks and guy-wire engineering out of structural-analysis without changing formulas.')