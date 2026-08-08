import type {
  GuyTierInput,
  ProjectGuysInput,
  ProjectInput,
  ProjectPackageMetadata,
  ProjectPackageV1,
} from './contracts.js'
import { PROJECT_PACKAGE_SCHEMA } from './contracts.js'
import { assertProjectInput } from './project-parameters.js'

export { PROJECT_PACKAGE_SCHEMA }
export const SUPPORTED_PROJECT_PACKAGE_SCHEMAS = Object.freeze([PROJECT_PACKAGE_SCHEMA] as const)

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

function assertKnownFields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new ProjectSchemaError(
      'unknown-package-field',
      `Неизвестные поля ${path}: ${unknown.join(', ')}`,
      { path, fields: unknown },
    )
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (!Number.isFinite(value)) throw new ProjectSchemaError('invalid-number', `${path} должен быть конечным числом`, { path })
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new ProjectSchemaError('invalid-string', `${path} должен быть строкой`, { path })
  return value
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

function validateMetadata(value: unknown): ProjectPackageMetadata | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ProjectSchemaError('invalid-package-metadata', 'metadata пакета проекта должен быть объектом')
  assertKnownFields(value, ['name', 'description', 'createdAt', 'modifiedAt'], 'ProjectPackage.metadata')
  const metadata: {
    name?: string
    description?: string
    createdAt?: string
    modifiedAt?: string
  } = {}
  const name = optionalString(value.name, 'ProjectPackage.metadata.name')
  const description = optionalString(value.description, 'ProjectPackage.metadata.description')
  const createdAt = optionalString(value.createdAt, 'ProjectPackage.metadata.createdAt')
  const modifiedAt = optionalString(value.modifiedAt, 'ProjectPackage.metadata.modifiedAt')
  if (name !== undefined) metadata.name = name
  if (description !== undefined) metadata.description = description
  if (createdAt !== undefined) metadata.createdAt = createdAt
  if (modifiedAt !== undefined) metadata.modifiedAt = modifiedAt
  return Object.freeze(metadata)
}

function validateGuyTier(value: unknown, index: number): GuyTierInput {
  if (!isRecord(value)) throw new ProjectSchemaError('invalid-guy-tier', `ProjectPackage.guys.tiers[${index}] должен быть объектом`)
  const allowed = [
    'id', 'heightM', 'anchorRadiusM', 'anchorDistanceM', 'guyCount', 'azimuthOffsetDeg',
    'pretensionN', 'wireId', 'safetyFactor', 'terminationEfficiency',
  ]
  assertKnownFields(value, allowed, `ProjectPackage.guys.tiers[${index}]`)
  const tier: {
    id?: string
    heightM?: number
    anchorRadiusM?: number
    anchorDistanceM?: number
    guyCount?: number
    azimuthOffsetDeg?: number
    pretensionN?: number
    wireId?: string
    safetyFactor?: number
    terminationEfficiency?: number
  } = {}
  const id = optionalString(value.id, `ProjectPackage.guys.tiers[${index}].id`)
  const wireId = optionalString(value.wireId, `ProjectPackage.guys.tiers[${index}].wireId`)
  if (id !== undefined) tier.id = id
  if (wireId !== undefined) tier.wireId = wireId
  for (const field of ['heightM', 'anchorRadiusM', 'anchorDistanceM', 'guyCount', 'azimuthOffsetDeg', 'pretensionN', 'safetyFactor', 'terminationEfficiency'] as const) {
    const item = value[field]
    if (item === undefined) continue
    assertFiniteNumber(item, `ProjectPackage.guys.tiers[${index}].${field}`)
    tier[field] = item
  }
  if (tier.heightM !== undefined && !(tier.heightM > 0)) throw new ProjectSchemaError('invalid-guy-tier', `Ярус ${index + 1}: heightM должен быть > 0`)
  if (tier.anchorRadiusM !== undefined && !(tier.anchorRadiusM > 0)) throw new ProjectSchemaError('invalid-guy-tier', `Ярус ${index + 1}: anchorRadiusM должен быть > 0`)
  if (tier.anchorDistanceM !== undefined && !(tier.anchorDistanceM > 0)) throw new ProjectSchemaError('invalid-guy-tier', `Ярус ${index + 1}: anchorDistanceM должен быть > 0`)
  if (tier.guyCount !== undefined && (!Number.isInteger(tier.guyCount) || tier.guyCount < 3 || tier.guyCount > 6)) {
    throw new ProjectSchemaError('invalid-guy-tier', `Ярус ${index + 1}: guyCount должен быть целым 3…6`)
  }
  if (tier.pretensionN !== undefined && tier.pretensionN < 0) throw new ProjectSchemaError('invalid-guy-tier', `Ярус ${index + 1}: pretensionN не может быть отрицательным`)
  if (tier.safetyFactor !== undefined && !(tier.safetyFactor > 0)) throw new ProjectSchemaError('invalid-guy-tier', `Ярус ${index + 1}: safetyFactor должен быть > 0`)
  if (tier.terminationEfficiency !== undefined && !(tier.terminationEfficiency > 0 && tier.terminationEfficiency <= 1)) {
    throw new ProjectSchemaError('invalid-guy-tier', `Ярус ${index + 1}: terminationEfficiency должен быть в диапазоне (0, 1]`)
  }
  return Object.freeze(tier)
}

function validateGuys(value: unknown): ProjectGuysInput | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ProjectSchemaError('invalid-guys', 'ProjectPackage.guys должен быть объектом')
  assertKnownFields(value, ['tiers', 'safetyFactor', 'terminationEfficiency'], 'ProjectPackage.guys')
  if (!Array.isArray(value.tiers)) throw new ProjectSchemaError('invalid-guys', 'ProjectPackage.guys.tiers должен быть массивом')
  const tiers = Object.freeze(value.tiers.map(validateGuyTier))
  const guys: { tiers: readonly GuyTierInput[]; safetyFactor?: number; terminationEfficiency?: number } = { tiers }
  if (value.safetyFactor !== undefined) {
    assertFiniteNumber(value.safetyFactor, 'ProjectPackage.guys.safetyFactor')
    if (!(value.safetyFactor > 0)) throw new ProjectSchemaError('invalid-guys', 'ProjectPackage.guys.safetyFactor должен быть > 0')
    guys.safetyFactor = value.safetyFactor
  }
  if (value.terminationEfficiency !== undefined) {
    assertFiniteNumber(value.terminationEfficiency, 'ProjectPackage.guys.terminationEfficiency')
    if (!(value.terminationEfficiency > 0 && value.terminationEfficiency <= 1)) {
      throw new ProjectSchemaError('invalid-guys', 'ProjectPackage.guys.terminationEfficiency должен быть в диапазоне (0, 1]')
    }
    guys.terminationEfficiency = value.terminationEfficiency
  }
  return Object.freeze(guys)
}

function assertProjectPackageV1(value: Record<string, unknown>): ProjectPackageV1 {
  if (value.schema !== PROJECT_PACKAGE_SCHEMA) {
    throw new ProjectSchemaError(
      'unsupported-schema',
      `Неподдерживаемая схема проекта: ${String(value.schema ?? 'не указана')}`,
      { supported: SUPPORTED_PROJECT_PACKAGE_SCHEMAS, actual: value.schema ?? null },
    )
  }
  assertKnownFields(value, ['schema', 'metadata', 'project', 'guys'], 'ProjectPackage')
  if (!('project' in value)) throw new ProjectSchemaError('missing-project', 'Пакет проекта не содержит поле project')
  const project = validateProjectInput(value.project)
  const metadata = validateMetadata(value.metadata)
  const guys = validateGuys(value.guys)
  return Object.freeze({
    schema: PROJECT_PACKAGE_SCHEMA,
    ...(metadata === undefined ? {} : { metadata }),
    project,
    ...(guys === undefined ? {} : { guys }),
  })
}

/**
 * Version migration dispatch. v1 is the only current schema; future migrations are added here
 * and must return the canonical current ProjectPackageV1. No synthetic legacy wrapper is kept.
 */
export function migrateProjectPackage(value: unknown): ProjectPackageV1 {
  if (!isRecord(value)) throw new ProjectSchemaError('invalid-package', 'Пакет проекта должен быть объектом')
  if (value.schema === PROJECT_PACKAGE_SCHEMA) return assertProjectPackageV1(value)
  throw new ProjectSchemaError(
    'unsupported-schema',
    `Неподдерживаемая схема проекта: ${String(value.schema ?? 'не указана')}`,
    { supported: SUPPORTED_PROJECT_PACKAGE_SCHEMAS, actual: value.schema ?? null },
  )
}

export function assertProjectPackage(value: unknown): ProjectPackageV1 {
  return migrateProjectPackage(value)
}

export interface CreateProjectPackageOptions {
  readonly metadata?: ProjectPackageMetadata
  readonly guys?: ProjectGuysInput
}

export function createProjectPackage(project: unknown, options: CreateProjectPackageOptions = {}): ProjectPackageV1 {
  return assertProjectPackage({
    schema: PROJECT_PACKAGE_SCHEMA,
    project,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    ...(options.guys === undefined ? {} : { guys: options.guys }),
  })
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
  return migrateProjectPackage(value)
}
