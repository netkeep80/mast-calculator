import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const write = (file, content) => fs.writeFileSync(file, content)
const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Missing ${label}`)
  return source.replace(from, to)
}

const calculateFile = 'packages/application/src/calculate.js'
let source = read(calculateFile)

source = replaceRequired(
  source,
  `function attachModularAnalysis(model, frameSystem, moduleStack, analysis, loads, parameters) {\n  if (!moduleStack) return\n  const modular = solveModuleStack(model, moduleStack, loads)\n  const globalVector = analysisDofVector(analysis)\n  const difference = modular.displacementVector.map((value, index) => value - globalVector[index])\n  modular.relativeDisplacementDifference = vectorNorm(difference) / Math.max(1e-12, vectorNorm(globalVector))\n  modular.modules = enrichModuleStates(model, analysis, modular, parameters)\n  modular.interfaceFactorizationCount = moduleStack.interfaceFactorizationCount\n  modular.referenceSolver = frameSystem.method\n  analysis.modular = modular\n  analysis.moduleResults = modular.modules\n}\n`,
  `function withModularAnalysis(model, frameSystem, moduleStack, analysis, loads, parameters) {\n  if (!moduleStack) return analysis\n  const solved = solveModuleStack(model, moduleStack, loads)\n  const globalVector = analysisDofVector(analysis)\n  const difference = solved.displacementVector.map((value, index) => value - globalVector[index])\n  const modules = enrichModuleStates(model, analysis, solved, parameters)\n  const modular = {\n    ...solved,\n    relativeDisplacementDifference: vectorNorm(difference) / Math.max(1e-12, vectorNorm(globalVector)),\n    modules,\n    interfaceFactorizationCount: moduleStack.interfaceFactorizationCount,\n    referenceSolver: frameSystem.method,\n  }\n  return { ...analysis, modular, moduleResults: modules }\n}\n`,
  'modular analysis mutation block',
)

source = replaceRequired(
  source,
  `    const analysis = analyzeCheckedFrame(model, loads, caseParameters, frameSystem)\n    attachModularAnalysis(model, frameSystem, moduleStack, analysis, loads, caseParameters)\n    cases.push({ windDirectionDeg: direction, loads, analysis })\n`,
  `    const rawAnalysis = analyzeCheckedFrame(model, loads, caseParameters, frameSystem)\n    const analysis = withModularAnalysis(model, frameSystem, moduleStack, rawAnalysis, loads, caseParameters)\n    cases.push({ windDirectionDeg: direction, loads, analysis })\n`,
  'operational modular enrichment',
)

source = replaceRequired(
  source,
  `export function calculateMast(inputParameters, options = {}) {\n  const parameters = resolveCalculationParameters(inputParameters)\n`,
  `export function calculateMast(inputParameters, options = {}) {\n  const parameters = options.resolvedProject ?? resolveCalculationParameters(inputParameters)\n`,
  'calculateMast resolver',
)

source = replaceRequired(
  source,
  `  const result = buildMastResult(parameters, model, cases)\n  result.connections = calculateConnectionChecks(result)\n  return result\n}\n`,
  `  const result = buildMastResult(parameters, model, cases)\n  const connections = calculateConnectionChecks(result)\n  return { ...result, connections }\n}\n`,
  'calculateMast connection mutation',
)

source = replaceRequired(
  source,
  `export function calculateMaximumHeight(inputParameters, options = {}) {\n  const parameters = resolveCalculationParameters(inputParameters)\n`,
  `export function calculateMaximumHeight(inputParameters, options = {}) {\n  const parameters = options.resolvedProject ?? resolveCalculationParameters(inputParameters)\n`,
  'height resolver',
)

source = replaceRequired(
  source,
  `      result = calculateMast({ ...parameters, moduleCount })\n`,
  `      const trialParameters = { ...parameters, moduleCount }\n      result = calculateMast(trialParameters, { resolvedProject: trialParameters })\n`,
  'height trial resolve',
)

const completeStart = source.indexOf('export function calculateCompleteMast(inputParameters, options = {}) {')
if (completeStart < 0) throw new Error('Missing calculateCompleteMast')
source = `${source.slice(0, completeStart)}export function calculateCompleteMast(inputParameters, options = {}) {
  const parameters = options.resolvedProject ?? resolveCalculationParameters(inputParameters)
  const model = generateMastModel(parameters)
  const directions = windDirections(parameters)
  const lateral = lateralDirections(parameters.lateralCapacityStepDeg)
  const total = 1 + directions.length + lateral.length + STATIC_PAYLOAD_PROGRESS_STEPS + HEIGHT_SEARCH_PROGRESS_STEPS

  options.onProgress?.({
    phase: 'compile',
    label: \`Подготовка \${parameters.moduleCount} модулей: глобальная и помодульная системы\`,
    completed: 0,
    total,
  })
  const frameSystem = compileFrameSystem(model, parameters)
  const moduleStack = compileModuleStack(model, frameSystem.memberGeometry)
  options.onProgress?.({
    phase: 'compile',
    label: \`Готово: \${frameSystem.freeDofs.length} свободных DOF; \${moduleStack?.interfaceFactorizationCount ?? 0} модульных интерфейсов\`,
    completed: 1,
    total,
  })

  const cases = calculateOperationalCases(parameters, model, frameSystem, moduleStack, directions, (event) => {
    options.onProgress?.({
      phase: 'wind',
      label: \`Ветровая огибающая: \${event.completed}/\${event.total}, направление \${event.directionDeg.toFixed(0)}°\`,
      completed: 1 + event.completed,
      total,
    })
  })
  const baseResult = buildMastResult(parameters, model, cases)

  // Select physical hardware once from operational demand, then carry the same
  // resolved configuration through every capacity calculation without mutating
  // the base result or changing the requested public mode.
  const selectedConnections = calculateConnectionChecks(baseResult)
  const { requestedMode, fixed } = fixedPhysicalJointParameters(parameters, selectedConnections)
  const finalParameters = { ...fixed, jointConfiguratorMode: requestedMode }
  const connections = {
    ...selectedConnections,
    requestedMode,
    capacityChecksUseFixedSelectedJoint: true,
  }
  const configuredResult = {
    ...baseResult,
    parameters: finalParameters,
    connections,
  }

  const lateralOffset = 1 + directions.length
  const lateralCapacity = calculateLateralCapacity(model, fixed, {
    frameSystem,
    onProgress: (event) => options.onProgress?.({
      phase: 'lateral',
      label: \`Боковая нагрузка: \${event.completed}/\${event.total}, направление \${event.directionDeg.toFixed(0)}°\`,
      completed: lateralOffset + event.completed,
      total,
    }),
  })

  const staticPayloadOffset = lateralOffset + lateral.length
  const staticPayloadCapacity = calculateStaticPayloadCapacity(model, fixed, {
    frameSystem,
    onProgress: (event) => options.onProgress?.({
      phase: 'static-payload',
      label: event.label,
      completed: staticPayloadOffset + event.completed,
      total,
    }),
  })

  const heightOffset = staticPayloadOffset + STATIC_PAYLOAD_PROGRESS_STEPS
  const rawHeightCapacity = calculateMaximumHeight(fixed, {
    resolvedProject: fixed,
    knownResult: configuredResult,
    onProgress: (event) => options.onProgress?.({
      phase: 'height-capacity',
      label: event.label,
      completed: heightOffset + event.completed,
      total,
    }),
  })
  const heightCapacity = {
    ...rawHeightCapacity,
    fixedJointConfiguration: {
      diameterMm: fixed.jointBoltDiameterMm,
      boltClass: fixed.jointBoltClass,
      boltLengthMm: fixed.jointBoltLengthMm,
      clearanceNutThreadMm: fixed.jointClearanceNutThreadMm,
      threadEngagementFactor: fixed.jointThreadEngagementFactor,
    },
  }

  const resultBeforeVerification = {
    ...configuredResult,
    lateralCapacity,
    staticPayloadCapacity,
    heightCapacity,
  }
  const verification = buildVerificationPassport(resultBeforeVerification)
  const performance = {
    linearSystemSolver: frameSystem.method,
    modularStaticSolver: moduleStack?.method ?? null,
    modularInterfaceFactorizationCount: moduleStack?.interfaceFactorizationCount ?? 0,
    modularRelativeDisplacementDifference: configuredResult.analysis.modular?.relativeDisplacementDifference ?? null,
    modularInterfaceEquilibriumResidual: configuredResult.analysis.modular?.interfaceEquilibriumResidual ?? null,
    freeDofCount: frameSystem.freeDofs.length,
    stiffnessBandwidth: frameSystem.bandwidth,
    stiffnessFactorizationCount: frameSystem.factorizationCount,
    operationalCaseCount: directions.length,
    lateralCaseCount: lateral.length,
    staticPayloadEvaluationCount: STATIC_PAYLOAD_PROGRESS_STEPS,
    heightSearchEvaluationCount: heightCapacity.evaluationCount,
    verificationInternalCheckCount: verification.counts.internal,
    rotationalSymmetryDeg: ROTATIONAL_SYMMETRY_DEG,
    jointConfiguratorMode: requestedMode,
  }
  options.onProgress?.({
    phase: 'done',
    label: 'Расчёт, конфигурация физического узла, предельные проверки и верификация завершены',
    completed: total,
    total,
  })
  return {
    ...resultBeforeVerification,
    verification,
    performance,
  }
}
`
write(calculateFile, source)

const guyFile = 'packages/engineering/src/guy-wire-system.js'
let guy = read(guyFile)
guy = replaceRequired(
  guy,
  `export function calculateGuyedMast(inputParameters, tiers = [], inputOptions = {}) {\n  const parameters = resolveCalculationParameters(inputParameters)\n`,
  `export function calculateGuyedMast(inputParameters, tiers = [], inputOptions = {}) {\n  const parameters = inputOptions.resolvedProject ?? resolveCalculationParameters(inputParameters)\n`,
  'guy resolver',
)
write(guyFile, guy)

console.log('Applied issue #61 immutable lifecycle and single-resolution public path.')
