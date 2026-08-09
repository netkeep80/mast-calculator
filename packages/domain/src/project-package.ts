import type {
  GuyTierInput,
  ProjectErectionInput,
  ProjectErectionSamplingInput,
  ProjectGuysInput,
  ProjectInput,
  ProjectPackageMetadata,
  ProjectPackageV1,
  ProjectTiltUpErectionInput,
} from './contracts.js'
import { PROJECT_PACKAGE_SCHEMA } from './contracts.js'
import { assertProjectInput } from './project-parameters.js'
import {
  SP20_BASIC_WIND_PRESSURE_PA,
  SP20_TERRAIN_PARAMETERS,
  WIND_ACTION_MODE_MANUAL,
  WIND_ACTION_MODE_SP20_MEAN_V1,
} from './wind-action.js'

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

function assertOptionalWindActionFields(project: ProjectInput): void {
  const mode = project.environment.windActionMode
  const region = project.environment.windRegion
  const terrain = project.environment.windTerrainType
  if (mode !== undefined && mode !== WIND_ACTION_MODE_MANUAL && mode !== WIND_ACTION_MODE_SP20_MEAN_V1) {
    throw new ProjectSchemaError('invalid-wind-action-mode', `ProjectInput.environment.windActionMode не поддерживается: ${String(mode)}`)
  }
  if (region !== undefined && !(region in SP20_BASIC_WIND_PRESSURE_PA)) {
    throw new ProjectSchemaError('invalid-wind-region', `ProjectInput.environment.windRegion не поддерживается: ${String(region)}`)
  }
  if (terrain !== undefined && !(terrain in SP20_TERRAIN_PARAMETERS)) {
    throw new ProjectSchemaError('invalid-wind-terrain', `ProjectInput.environment.windTerrainType не поддерживается: ${String(terrain)}`)
  }
  if (mode === WIND_ACTION_MODE_SP20_MEAN_V1 && (region === undefined || terrain === undefined)) {
    throw new ProjectSchemaError(
      'incomplete-sp20-wind-input',
      'Для ProjectInput.environment.windActionMode=sp20-mean-v1 требуются windRegion и windTerrainType',
    )
  }
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
  assertOptionalWindActionFields(project)
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

function topologyIndex(value: unknown, path: string): 0 | 1 | 2 {
  if (!Number.isInteger(value) || (value !== 0 && value !== 1 && value !== 2)) {
    throw new ProjectSchemaError('invalid-erection-topology', `${path} должен быть целым 0…2`, { path })
  }
  return value
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || !(Number(value) > 0)) {
    throw new ProjectSchemaError('invalid-erection-sampling', `${path} должен быть положительным целым числом`, { path })
  }
  return Number(value)
}

function validateErectionSampling(value: unknown): ProjectErectionSamplingInput {
  if (!isRecord(value)) throw new ProjectSchemaError('invalid-erection-sampling', 'ProjectPackage.erection.sampling должен быть объектом')
  assertKnownFields(
    value,
    ['initialSegments', 'relativeTolerance', 'minimumAngleStepDeg', 'maximumEvaluations', 'maximumDepth'],
    'ProjectPackage.erection.sampling',
  )
  const initialSegments = positiveInteger(value.initialSegments, 'ProjectPackage.erection.sampling.initialSegments')
  const maximumEvaluations = positiveInteger(value.maximumEvaluations, 'ProjectPackage.erection.sampling.maximumEvaluations')
  const maximumDepth = positiveInteger(value.maximumDepth, 'ProjectPackage.erection.sampling.maximumDepth')
  assertFiniteNumber(value.relativeTolerance, 'ProjectPackage.erection.sampling.relativeTolerance')
  assertFiniteNumber(value.minimumAngleStepDeg, 'ProjectPackage.erection.sampling.minimumAngleStepDeg')
  if (!(value.relativeTolerance > 0)) {
    throw new ProjectSchemaError('invalid-erection-sampling', 'ProjectPackage.erection.sampling.relativeTolerance должен быть > 0')
  }
  if (!(value.minimumAngleStepDeg > 0)) {
    throw new ProjectSchemaError('invalid-erection-sampling', 'ProjectPackage.erection.sampling.minimumAngleStepDeg должен быть > 0')
  }
  if (maximumEvaluations < initialSegments + 1) {
    throw new ProjectSchemaError(
      'invalid-erection-sampling',
      'ProjectPackage.erection.sampling.maximumEvaluations должен вмещать полную начальную сетку',
    )
  }
  return Object.freeze({
    initialSegments,
    relativeTolerance: value.relativeTolerance,
    minimumAngleStepDeg: value.minimumAngleStepDeg,
    maximumEvaluations,
    maximumDepth,
  })
}

export function validateProjectErectionInput(value: unknown): ProjectErectionInput | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ProjectSchemaError('invalid-erection', 'ProjectPackage.erection должен быть объектом')
  if (value.mode === 'disabled') {
    assertKnownFields(value, ['mode'], 'ProjectPackage.erection')
    return Object.freeze({ mode: 'disabled' })
  }
  if (value.mode !== 'tilt-up') {
    throw new ProjectSchemaError('invalid-erection-mode', `ProjectPackage.erection.mode не поддерживается: ${String(value.mode)}`)
  }
  assertKnownFields(
    value,
    [
      'mode',
      'hingeBaseEdgeIndex',
      'attachmentTopCornerIndex',
      'anchorPointM',
      'rotationSense',
      'startAngleDeg',
      'endAngleDeg',
      'sampling',
    ],
    'ProjectPackage.erection',
  )
  if (!Array.isArray(value.anchorPointM) || value.anchorPointM.length !== 3) {
    throw new ProjectSchemaError('invalid-erection-anchor', 'ProjectPackage.erection.anchorPointM должен быть [x, y, z]')
  }
  const anchor = value.anchorPointM.map((coordinate, index) => {
    assertFiniteNumber(coordinate, `ProjectPackage.erection.anchorPointM[${index}]`)
    return coordinate
  }) as [number, number, number]
  if (value.rotationSense !== 1 && value.rotationSense !== -1) {
    throw new ProjectSchemaError('invalid-erection-rotation', 'ProjectPackage.erection.rotationSense должен быть 1 или -1')
  }
  assertFiniteNumber(value.startAngleDeg, 'ProjectPackage.erection.startAngleDeg')
  assertFiniteNumber(value.endAngleDeg, 'ProjectPackage.erection.endAngleDeg')
  if (value.startAngleDeg < 0 || value.endAngleDeg > 90 || !(value.endAngleDeg > value.startAngleDeg)) {
    throw new ProjectSchemaError('invalid-erection-angle-range', 'Монтажный диапазон должен удовлетворять 0 <= startAngleDeg < endAngleDeg <= 90')
  }
  const erection: ProjectTiltUpErectionInput = {
    mode: 'tilt-up',
    hingeBaseEdgeIndex: topologyIndex(value.hingeBaseEdgeIndex, 'ProjectPackage.erection.hingeBaseEdgeIndex'),
    attachmentTopCornerIndex: topologyIndex(value.attachmentTopCornerIndex, 'ProjectPackage.erection.attachmentTopCornerIndex'),
    anchorPointM: Object.freeze(anchor),
    rotationSense: value.rotationSense,
    startAngleDeg: value.startAngleDeg,
    endAngleDeg: value.endAngleDeg,
    sampling: validateErectionSampling(value.sampling),
  }
  return Object.freeze(erection)
}

function assertProjectPackageV1(value: Record<string, unknown>): ProjectPackageV1 {
  if (value.schema !== PROJECT_PACKAGE_SCHEMA) {
    throw new ProjectSchemaError(
      'unsupported-schema',
      `Неподдерживаемая схема проекта: ${String(value.schema ?? 'не указана')}`,
      { supported: SUPPORTED_PROJECT_PACKAGE_SCHEMAS, actual: value.schema ?? null },
    )
  }
  assertKnownFields(value, ['schema', 'metadata', 'project', 'guys', 'erection'], 'ProjectPackage')
  if (!('project' in value)) throw new ProjectSchemaError('missing-project', 'Пакет проекта не содержит поле project')
  const project = validateProjectInput(value.project)
  const metadata = validateMetadata(value.metadata)
  const guys = validateGuys(value.guys)
  const erection = validateProjectErectionInput(value.erection)
  return Object.freeze({
    schema: PROJECT_PACKAGE_SCHEMA,
    ...(metadata === undefined ? {} : { metadata }),
    project,
    ...(guys === undefined ? {} : { guys }),
    ...(erection === undefined ? {} : { erection }),
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
  readonly erection?: ProjectErectionInput
}

export function createProjectPackage(project: unknown, options: CreateProjectPackageOptions = {}): ProjectPackageV1 {
  return assertProjectPackage({
    schema: PROJECT_PACKAGE_SCHEMA,
    project,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    ...(options.guys === undefined ? {} : { guys: options.guys }),
    ...(options.erection === undefined ? {} : { erection: options.erection }),
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
