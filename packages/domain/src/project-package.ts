import type { ProjectInput, ProjectPackageV1 } from './contracts.js'
import { PROJECT_PACKAGE_SCHEMA } from './contracts.js'
import { assertProjectInput } from './project-parameters.js'

export { PROJECT_PACKAGE_SCHEMA }

export class ProjectSchemaError extends Error {
  readonly code: string
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ProjectSchemaError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (!Number.isFinite(value)) throw new ProjectSchemaError('invalid-number', `${path} должен быть конечным числом`, { path })
}

function assertProjectValueTypes(project: ProjectInput): ProjectInput {
  const numberPaths: Array<readonly [string, unknown]> = [
    ['geometry.moduleCount', project.geometry.moduleCount],
    ['geometry.stockBarLengthMm', project.geometry.stockBarLengthMm],
    ['geometry.stockBarPieces', project.geometry.stockBarPieces],
    ['geometry.barDiameterMm', project.geometry.barDiameterMm],
    ['material.materialSafetyFactor', project.material.materialSafetyFactor],
    ['environment.deadLoadFactor', project.environment.deadLoadFactor],
    ['environment.windLoadFactor', project.environment.windLoadFactor],
    ['environment.dragCoefficient', project.environment.dragCoefficient],
    ['environment.windDirectionDeg', project.environment.windDirectionDeg],
    ['environment.windEnvelopeStepDeg', project.environment.windEnvelopeStepDeg],
    ['environment.lateralCapacityStepDeg', project.environment.lateralCapacityStepDeg],
    ['environment.iceThicknessMm', project.environment.iceThicknessMm],
    ['environment.iceDensityKgM3', project.environment.iceDensityKgM3],
    ['equipment.massKg', project.equipment.massKg],
    ['equipment.windAreaM2', project.equipment.windAreaM2],
    ['equipment.dragCoefficient', project.equipment.dragCoefficient],
    ['equipment.loadFactor', project.equipment.loadFactor],
    ['connection.boltDiameterMm', project.connection.boltDiameterMm],
    ['connection.clearanceNutThreadMm', project.connection.clearanceNutThreadMm],
    ['connection.boltLengthMm', project.connection.boltLengthMm],
    ['connection.threadEngagementFactor', project.connection.threadEngagementFactor],
    ['connection.boltShearPlanes', project.connection.boltShearPlanes],
    ['connection.conditionFactor', project.connection.conditionFactor],
    ['connection.weldLegMm', project.connection.weldLegMm],
    ['connection.weldSegmentsPerEnd', project.connection.weldSegmentsPerEnd],
    ['connection.weldBetaF', project.connection.weldBetaF],
    ['connection.weldBetaZ', project.connection.weldBetaZ],
    ['criteria.displacementLimitMm', project.criteria.displacementLimitMm],
    ['criteria.minimumBucklingFactor', project.criteria.minimumBucklingFactor],
    ['criteria.heightSearchMaxModules', project.criteria.heightSearchMaxModules],
  ]
  if (project.environment.windPressurePa !== undefined) numberPaths.push(['environment.windPressurePa', project.environment.windPressurePa])

  const optionalConnectionFields: ReadonlyArray<keyof ProjectInput['connection']> = [
    'tighteningTorqueNm',
    'nutFactor',
    'preloadVariation',
    'nutSectionAreaRatio',
    'weldToRibAreaRatio',
    'weldServiceYears',
    'weldInitialStiffnessRetention',
    'weldAnnualStiffnessLossRate',
    'weldMinimumStiffnessRetention',
  ]
  for (const field of optionalConnectionFields) {
    const value = project.connection[field]
    if (value !== undefined) numberPaths.push([`connection.${field}`, value])
  }
  for (const [path, value] of numberPaths) assertFiniteNumber(value, `ProjectInput.${path}`)

  if (!Number.isInteger(project.geometry.moduleCount) || project.geometry.moduleCount < 1) {
    throw new ProjectSchemaError('invalid-module-count', 'ProjectInput.geometry.moduleCount должен быть положительным целым числом')
  }
  if (!Number.isInteger(project.geometry.stockBarPieces) || project.geometry.stockBarPieces < 1 || project.geometry.stockBarPieces > 48) {
    throw new ProjectSchemaError('invalid-stock-division', 'ProjectInput.geometry.stockBarPieces должен быть целым числом 1…48')
  }
  if (project.geometry.moduleDiametersMm !== undefined) {
    if (project.geometry.moduleDiametersMm.length === 0) {
      throw new ProjectSchemaError('invalid-diameter-profile', 'ProjectInput.geometry.moduleDiametersMm должен быть непустым массивом')
    }
    project.geometry.moduleDiametersMm.forEach((value, index) => {
      assertFiniteNumber(value, `ProjectInput.geometry.moduleDiametersMm[${index}]`)
      if (!(value > 0)) throw new ProjectSchemaError('invalid-diameter-profile', 'Диаметры модулей должны быть положительными')
    })
  }

  const stringPaths: Array<readonly [string, unknown]> = [
    ['material.reinforcementClass', project.material.reinforcementClass],
    ['environment.windPresetId', project.environment.windPresetId],
    ['connection.configuratorMode', project.connection.configuratorMode],
    ['connection.boltClass', project.connection.boltClass],
    ['connection.weldConsumableId', project.connection.weldConsumableId],
  ]
  for (const [path, value] of stringPaths) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ProjectSchemaError('invalid-string', `ProjectInput.${path} должен быть непустой строкой`, { path })
    }
  }
  if (typeof project.environment.windEnvelopeEnabled !== 'boolean') {
    throw new ProjectSchemaError('invalid-boolean', 'ProjectInput.environment.windEnvelopeEnabled должен быть boolean')
  }
  return project
}

export function validateProjectInput(value: unknown): ProjectInput {
  try {
    return assertProjectValueTypes(assertProjectInput(value))
  } catch (error) {
    if (error instanceof ProjectSchemaError) throw error
    throw new ProjectSchemaError('invalid-project-input', error instanceof Error ? error.message : String(error))
  }
}

export function assertProjectPackage(value: unknown): ProjectPackageV1 {
  if (!isRecord(value)) throw new ProjectSchemaError('invalid-package', 'Пакет проекта должен быть объектом')
  if (value.schema !== PROJECT_PACKAGE_SCHEMA) {
    throw new ProjectSchemaError(
      'unsupported-schema',
      `Неподдерживаемая схема проекта: ожидается ${PROJECT_PACKAGE_SCHEMA}`,
      { expected: PROJECT_PACKAGE_SCHEMA, actual: value.schema ?? null },
    )
  }
  if (!('project' in value)) throw new ProjectSchemaError('missing-project', 'Пакет проекта не содержит поле project')
  const project = validateProjectInput(value.project)
  const unknown = Object.keys(value).filter((key) => !['schema', 'project'].includes(key))
  if (unknown.length > 0) throw new ProjectSchemaError('unknown-package-field', `Неизвестные поля пакета проекта: ${unknown.join(', ')}`)
  return { schema: PROJECT_PACKAGE_SCHEMA, project }
}

export function createProjectPackage(project: unknown): ProjectPackageV1 {
  return { schema: PROJECT_PACKAGE_SCHEMA, project: validateProjectInput(project) }
}

export function serializeProjectPackage(value: unknown): string {
  return `${JSON.stringify(assertProjectPackage(value), null, 2)}\n`
}

export function parseProjectPackage(text: unknown): ProjectPackageV1 {
  let value: unknown
  try {
    value = JSON.parse(String(text)) as unknown
  } catch (error) {
    throw new ProjectSchemaError(
      'invalid-json',
      `Не удалось прочитать JSON-пакет проекта: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return assertProjectPackage(value)
}
