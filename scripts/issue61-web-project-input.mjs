import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const write = (file, content) => fs.writeFileSync(file, content)
const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Missing ${label}`)
  return source.replace(from, to)
}

// apps/web/app.js: form stays flat HTML, but the Worker boundary receives grouped ProjectInput.
{
  const file = 'apps/web/app.js'
  let source = read(file)
  source = replaceRequired(
    source,
    "import { DEFAULT_PARAMETERS, resolveCalculationParameters } from '../../packages/application/index.js'",
    "import { DEFAULT_PROJECT_INPUT, createProjectInput } from '../../packages/application/index.js'",
    'app application import',
  )
  source = replaceRequired(
    source,
    "  getReinforcementClass,\n  regularOctahedronHeightMm,",
    "  flattenProjectInput,\n  getReinforcementClass,\n  regularOctahedronHeightMm,",
    'app domain flatten import',
  )
  source = replaceRequired(
    source,
    `const numericFieldNames = [\n  'moduleCount', 'stockBarLengthMm', 'stockBarPieces', 'barDiameterMm',\n  'materialSafetyFactor', 'deadLoadFactor', 'windLoadFactor', 'equipmentLoadFactor',\n  'windPressurePa', 'dragCoefficient', 'windDirectionDeg', 'windEnvelopeStepDeg',\n  'lateralCapacityStepDeg', 'heightSearchMaxModules', 'equipmentMassKg',\n  'equipmentWindAreaM2', 'equipmentDragCoefficient', 'extraHorizontalLoadN',\n  'extraVerticalLoadN', 'iceThicknessMm', 'iceDensityKgM3', 'displacementLimitMm',\n  'minimumBucklingFactor', 'jointBoltDiameterMm', 'jointBoltShearPlanes',\n  'jointEffectiveRadiusMm', 'connectionConditionFactor', 'jointBaseMetalTensileStrengthMPa',\n  'weldLegMm', 'weldSegmentsPerEnd', 'weldBetaF', 'weldBetaZ',\n]\n`,
    `const DEFAULT_FORM_PARAMETERS = Object.freeze(flattenProjectInput(DEFAULT_PROJECT_INPUT))\nconst numericFieldNames = [\n  'moduleCount', 'stockBarLengthMm', 'stockBarPieces', 'barDiameterMm',\n  'materialSafetyFactor', 'deadLoadFactor', 'windLoadFactor', 'equipmentLoadFactor',\n  'windPressurePa', 'dragCoefficient', 'windDirectionDeg', 'windEnvelopeStepDeg',\n  'lateralCapacityStepDeg', 'heightSearchMaxModules', 'equipmentMassKg',\n  'equipmentWindAreaM2', 'equipmentDragCoefficient', 'iceThicknessMm', 'iceDensityKgM3',\n  'displacementLimitMm', 'minimumBucklingFactor', 'jointBoltDiameterMm',\n  'jointBoltShearPlanes', 'connectionConditionFactor', 'weldLegMm',\n  'weldSegmentsPerEnd', 'weldBetaF', 'weldBetaZ',\n]\n`,
    'app numeric user field list',
  )
  source = replaceRequired(
    source,
    `for (const name of numericFieldNames) {\n  const input = form.elements.namedItem(name)\n  if (input && DEFAULT_PARAMETERS[name] != null) input.value = DEFAULT_PARAMETERS[name]\n}\nform.elements.namedItem('reinforcementClass').value = DEFAULT_PARAMETERS.reinforcementClass\nform.elements.namedItem('jointBoltClass').value = DEFAULT_PARAMETERS.jointBoltClass\nform.elements.namedItem('weldConsumableId').value = DEFAULT_PARAMETERS.weldConsumableId\nform.elements.namedItem('windPresetId').value = DEFAULT_PARAMETERS.windPresetId\nform.elements.namedItem('windEnvelopeEnabled').checked = DEFAULT_PARAMETERS.windEnvelopeEnabled\n`,
    `for (const name of numericFieldNames) {\n  const input = form.elements.namedItem(name)\n  if (input && DEFAULT_FORM_PARAMETERS[name] != null) input.value = DEFAULT_FORM_PARAMETERS[name]\n}\nform.elements.namedItem('reinforcementClass').value = DEFAULT_PROJECT_INPUT.material.reinforcementClass\nform.elements.namedItem('jointBoltClass').value = DEFAULT_PROJECT_INPUT.connection.boltClass\nform.elements.namedItem('weldConsumableId').value = DEFAULT_PROJECT_INPUT.connection.weldConsumableId\nform.elements.namedItem('windPresetId').value = DEFAULT_PROJECT_INPUT.environment.windPresetId\nform.elements.namedItem('windEnvelopeEnabled').checked = DEFAULT_PROJECT_INPUT.environment.windEnvelopeEnabled\n`,
    'app grouped default initialization',
  )
  const oldRead = `function readParameters() {\n  const parameters = { ...DEFAULT_PARAMETERS }\n  for (const name of numericFieldNames) {\n    const element = form.elements.namedItem(name)\n    if (!element) continue\n    const value = Number(element.value)\n    if (!Number.isFinite(value)) throw new Error(\`Поле «\${element.labels?.[0]?.textContent ?? name}» заполнено неверно\`)\n    parameters[name] = value\n  }\n  parameters.moduleCount = Math.floor(parameters.moduleCount)\n  parameters.stockBarPieces = Math.floor(parameters.stockBarPieces)\n  parameters.heightSearchMaxModules = Math.floor(parameters.heightSearchMaxModules)\n  parameters.jointBoltShearPlanes = Math.floor(parameters.jointBoltShearPlanes)\n  parameters.weldSegmentsPerEnd = Math.floor(parameters.weldSegmentsPerEnd)\n  parameters.reinforcementClass = form.elements.namedItem('reinforcementClass').value\n  parameters.jointBoltClass = form.elements.namedItem('jointBoltClass').value\n  parameters.weldConsumableId = form.elements.namedItem('weldConsumableId').value\n  parameters.windPresetId = form.elements.namedItem('windPresetId').value\n  parameters.windEnvelopeEnabled = form.elements.namedItem('windEnvelopeEnabled').checked\n  return resolveCalculationParameters(parameters)\n}\n`
  const newRead = `function numericFormValue(name, fallback) {\n  const element = form.elements.namedItem(name)\n  if (!element) return fallback\n  const value = Number(element.value)\n  if (!Number.isFinite(value)) throw new Error(\`Поле «\${element.labels?.[0]?.textContent ?? name}» заполнено неверно\`)\n  return value\n}\n\nfunction readParameters() {\n  const defaults = DEFAULT_PROJECT_INPUT\n  return createProjectInput({\n    geometry: {\n      moduleCount: Math.floor(numericFormValue('moduleCount', defaults.geometry.moduleCount)),\n      stockBarLengthMm: numericFormValue('stockBarLengthMm', defaults.geometry.stockBarLengthMm),\n      stockBarPieces: Math.floor(numericFormValue('stockBarPieces', defaults.geometry.stockBarPieces)),\n      barDiameterMm: numericFormValue('barDiameterMm', defaults.geometry.barDiameterMm),\n    },\n    material: {\n      reinforcementClass: form.elements.namedItem('reinforcementClass').value,\n      materialSafetyFactor: numericFormValue('materialSafetyFactor', defaults.material.materialSafetyFactor),\n    },\n    environment: {\n      deadLoadFactor: numericFormValue('deadLoadFactor', defaults.environment.deadLoadFactor),\n      windLoadFactor: numericFormValue('windLoadFactor', defaults.environment.windLoadFactor),\n      windPresetId: form.elements.namedItem('windPresetId').value,\n      windPressurePa: numericFormValue('windPressurePa', defaults.environment.windPressurePa),\n      dragCoefficient: numericFormValue('dragCoefficient', defaults.environment.dragCoefficient),\n      windDirectionDeg: numericFormValue('windDirectionDeg', defaults.environment.windDirectionDeg),\n      windEnvelopeEnabled: form.elements.namedItem('windEnvelopeEnabled').checked,\n      windEnvelopeStepDeg: numericFormValue('windEnvelopeStepDeg', defaults.environment.windEnvelopeStepDeg),\n      lateralCapacityStepDeg: numericFormValue('lateralCapacityStepDeg', defaults.environment.lateralCapacityStepDeg),\n      iceThicknessMm: numericFormValue('iceThicknessMm', defaults.environment.iceThicknessMm),\n      iceDensityKgM3: numericFormValue('iceDensityKgM3', defaults.environment.iceDensityKgM3),\n    },\n    equipment: {\n      massKg: numericFormValue('equipmentMassKg', defaults.equipment.massKg),\n      windAreaM2: numericFormValue('equipmentWindAreaM2', defaults.equipment.windAreaM2),\n      dragCoefficient: numericFormValue('equipmentDragCoefficient', defaults.equipment.dragCoefficient),\n      loadFactor: numericFormValue('equipmentLoadFactor', defaults.equipment.loadFactor),\n    },\n    connection: {\n      configuratorMode: form.elements.namedItem('jointConfiguratorMode')?.value ?? defaults.connection.configuratorMode,\n      boltDiameterMm: numericFormValue('jointBoltDiameterMm', defaults.connection.boltDiameterMm),\n      boltClass: form.elements.namedItem('jointBoltClass').value,\n      clearanceNutThreadMm: numericFormValue('jointClearanceNutThreadMm', defaults.connection.clearanceNutThreadMm),\n      boltLengthMm: numericFormValue('jointBoltLengthMm', defaults.connection.boltLengthMm),\n      threadEngagementFactor: numericFormValue('jointThreadEngagementFactor', defaults.connection.threadEngagementFactor),\n      boltShearPlanes: Math.floor(numericFormValue('jointBoltShearPlanes', defaults.connection.boltShearPlanes)),\n      conditionFactor: numericFormValue('connectionConditionFactor', defaults.connection.conditionFactor),\n      weldConsumableId: form.elements.namedItem('weldConsumableId').value,\n      weldLegMm: numericFormValue('weldLegMm', defaults.connection.weldLegMm),\n      weldSegmentsPerEnd: Math.floor(numericFormValue('weldSegmentsPerEnd', defaults.connection.weldSegmentsPerEnd)),\n      weldBetaF: numericFormValue('weldBetaF', defaults.connection.weldBetaF),\n      weldBetaZ: numericFormValue('weldBetaZ', defaults.connection.weldBetaZ),\n      tighteningTorqueNm: numericFormValue('jointTighteningTorqueNm', undefined),\n      nutFactor: numericFormValue('jointNutFactor', undefined),\n      preloadVariation: numericFormValue('jointPreloadVariation', undefined),\n      nutSectionAreaRatio: numericFormValue('jointNutSectionAreaRatio', undefined),\n      weldToRibAreaRatio: numericFormValue('weldToRibAreaRatio', undefined),\n    },\n    criteria: {\n      displacementLimitMm: numericFormValue('displacementLimitMm', defaults.criteria.displacementLimitMm),\n      minimumBucklingFactor: numericFormValue('minimumBucklingFactor', defaults.criteria.minimumBucklingFactor),\n      heightSearchMaxModules: Math.floor(numericFormValue('heightSearchMaxModules', defaults.criteria.heightSearchMaxModules)),\n    },\n  })\n}\n`
  source = replaceRequired(source, oldRead, newRead, 'app readParameters')
  write(file, source)
}

// app-bootstrap.js: the joint decorator may enrich only the connection group, never the root contract.
{
  const file = 'apps/web/app-bootstrap.js'
  let source = read(file)
  source = replaceRequired(
    source,
    `function readJointUiParameters() {\n  const geometry = currentGeometry()\n  return {\n    jointConfiguratorMode: modeSelect.value,\n    jointClearanceNutThreadMm: selectedNumber(clearanceNut, geometry.bottomClearanceNut.threadDiameterMm),\n    jointBoltLengthMm: selectedNumber(boltLength, geometry.bolt.lengthMm),\n    jointThreadEngagementFactor: selectedNumber(engagement, geometry.threadEngagementFactor),\n    jointEffectiveRadiusMm: geometry.effectiveRadiusMm,\n    ...strengthParametersFromUi(),\n  }\n}\n`,
    `function readJointUiParameters() {\n  const geometry = currentGeometry()\n  const strength = strengthParametersFromUi()\n  return {\n    configuratorMode: modeSelect.value,\n    clearanceNutThreadMm: selectedNumber(clearanceNut, geometry.bottomClearanceNut.threadDiameterMm),\n    boltLengthMm: selectedNumber(boltLength, geometry.bolt.lengthMm),\n    threadEngagementFactor: selectedNumber(engagement, geometry.threadEngagementFactor),\n    tighteningTorqueNm: strength.jointTighteningTorqueNm,\n    nutFactor: strength.jointNutFactor,\n    preloadVariation: strength.jointPreloadVariation,\n    nutSectionAreaRatio: strength.jointNutSectionAreaRatio,\n    weldToRibAreaRatio: strength.weldToRibAreaRatio,\n  }\n}\n`,
    'bootstrap joint ProjectInput mapping',
  )
  source = replaceRequired(
    source,
    `        parameters: {\n          ...message.parameters,\n          ...readJointUiParameters(),\n          jointConfiguratorMode: message.action === 'optimize' ? 'auto' : modeSelect.value,\n        },\n`,
    `        parameters: {\n          ...message.parameters,\n          connection: {\n            ...message.parameters.connection,\n            ...readJointUiParameters(),\n            configuratorMode: message.action === 'optimize' ? 'auto' : modeSelect.value,\n          },\n        },\n`,
    'bootstrap Worker grouped merge',
  )
  write(file, source)
}

// calculation-worker.js: optimization edits geometry/connection groups, never a flat parameter bag.
{
  const file = 'apps/web/calculation-worker.js'
  let source = read(file)
  source = replaceRequired(
    source,
    `  const optimizationShare = 0.78\n  const { moduleDiametersMm: _ignoredMixedProfile, ...uniformParameters } = parameters\n  const automaticParameters = { ...uniformParameters, jointConfiguratorMode: 'auto' }\n`,
    `  const optimizationShare = 0.78\n  const { moduleDiametersMm: _ignoredMixedProfile, ...uniformGeometry } = parameters.geometry\n  const automaticParameters = {\n    ...parameters,\n    geometry: uniformGeometry,\n    connection: { ...parameters.connection, configuratorMode: 'auto' },\n  }\n`,
    'worker grouped optimization setup',
  )
  source = replaceRequired(
    source,
    `  const result = calculateProject({\n    ...automaticParameters,\n    barDiameterMm: diameter,\n  }, {\n`,
    `  const result = calculateProject({\n    ...automaticParameters,\n    geometry: { ...automaticParameters.geometry, barDiameterMm: diameter },\n  }, {\n`,
    'worker grouped final diameter',
  )
  write(file, source)
}

console.log('Migrated Web/Worker/bootstrap boundary to grouped ProjectInput without derived fields.')
