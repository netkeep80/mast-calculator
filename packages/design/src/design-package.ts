import type { DesignPackageV1 } from './contracts.js'
import { DESIGN_PACKAGE_SCHEMA } from './contracts.js'
import { calculateAssemblyMass } from './assembly-mass.js'

type AssemblyMassInput = Parameters<typeof calculateAssemblyMass>[0]
type AssemblyMass = ReturnType<typeof calculateAssemblyMass>

interface MemberResultLike {
  memberId?: unknown
  utilization?: unknown
}

interface AnalysisLike {
  memberResults?: readonly MemberResultLike[]
}

interface ConnectionConfiguratorLike {
  mode?: unknown
  modeLabel?: unknown
  explanation?: unknown
  geometry?: unknown
  selected?: { boltClass?: unknown } | null
  resolvedParameters?: unknown
}

interface ConnectionSourceLike {
  configurator?: ConnectionConfiguratorLike | null
  geometry?: unknown
  resolvedGeometry?: unknown
  resolvedParameters?: unknown
  weld?: {
    configuredConsumableId?: unknown
    configuredLegMm?: unknown
    segmentsPerEnd?: unknown
    critical?: {
      memberId?: unknown
      end?: unknown
      nodeId?: unknown
      check?: {
        requiredPhysicalLengthMm?: unknown
        requiredEffectiveLengthMm?: unknown
        consumableId?: unknown
        consumableLabel?: unknown
      } | null
    } | null
  } | null
}

type DesignSourceResult = AssemblyMassInput & {
  analysis?: AssemblyMassInput['analysis'] & AnalysisLike
  envelope?: {
    governing?: {
      analysis?: AnalysisLike
    }
  }
  connections: AssemblyMassInput['connections'] & ConnectionSourceLike
  assemblyMass?: AssemblyMass
}

export interface DesignPackageMetadata {
  createdAt?: string
  repository?: string
  ref?: string | null
  sha?: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const jsonClone = <T>(value: T): T => (
  value == null ? value : JSON.parse(JSON.stringify(value)) as T
)

function compactMemberResults(result: DesignSourceResult) {
  const analysis = result.envelope?.governing?.analysis ?? result.analysis
  if (!Array.isArray(analysis?.memberResults)) return []
  return analysis.memberResults.map((member, index) => ({
    memberId: Number(member?.memberId ?? index),
    utilization: Number(member?.utilization ?? 0),
  }))
}

function compactConnections(result: DesignSourceResult) {
  const source: ConnectionSourceLike | undefined = result.connections
  if (!source) return null
  return jsonClone({
    configurator: source.configurator ? {
      mode: source.configurator.mode,
      modeLabel: source.configurator.modeLabel,
      explanation: source.configurator.explanation,
      geometry: source.configurator.geometry,
      selected: source.configurator.selected ? {
        boltClass: source.configurator.selected.boltClass,
      } : null,
      resolvedParameters: source.configurator.resolvedParameters,
    } : null,
    geometry: source.geometry,
    resolvedGeometry: source.resolvedGeometry,
    resolvedParameters: source.resolvedParameters,
    weld: source.weld ? {
      configuredConsumableId: source.weld.configuredConsumableId,
      configuredLegMm: source.weld.configuredLegMm,
      segmentsPerEnd: source.weld.segmentsPerEnd,
      critical: source.weld.critical ? {
        memberId: source.weld.critical.memberId,
        end: source.weld.critical.end,
        nodeId: source.weld.critical.nodeId,
        check: source.weld.critical.check ? {
          requiredPhysicalLengthMm: source.weld.critical.check.requiredPhysicalLengthMm,
          requiredEffectiveLengthMm: source.weld.critical.check.requiredEffectiveLengthMm,
          consumableId: source.weld.critical.check.consumableId,
          consumableLabel: source.weld.critical.check.consumableLabel,
        } : null,
      } : null,
    } : null,
  })
}

export function buildDesignPackage(
  result: DesignSourceResult,
  metadata: DesignPackageMetadata = {},
): DesignPackageV1 {
  if (!result?.model?.nodes?.length || !result?.model?.members?.length || !result?.parameters) {
    throw new Error('Для 3D/КД требуется выполненный расчёт мачты')
  }
  const assemblyMass = result.assemblyMass ?? calculateAssemblyMass(result)
  return {
    schema: DESIGN_PACKAGE_SCHEMA,
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    source: {
      repository: metadata.repository ?? 'netkeep80/mast-calculator',
      ref: metadata.ref ?? null,
      sha: metadata.sha ?? null,
    },
    result: {
      parameters: jsonClone(result.parameters),
      model: jsonClone(result.model),
      analysis: {
        memberResults: compactMemberResults(result),
      },
      connections: compactConnections(result),
      assemblyMass: jsonClone(assemblyMass),
    },
  }
}

export function assertDesignPackage(value: unknown): DesignPackageV1 {
  if (!isRecord(value) || value.schema !== DESIGN_PACKAGE_SCHEMA) {
    throw new Error(`Неподдерживаемый пакет 3D/КД: ожидается ${DESIGN_PACKAGE_SCHEMA}`)
  }
  const result = value.result
  if (!isRecord(result)) throw new Error('Пакет 3D/КД не содержит геометрию мачты')
  const model = result.model
  if (!isRecord(model) || !Array.isArray(model.nodes) || model.nodes.length === 0 || !Array.isArray(model.members) || model.members.length === 0) {
    throw new Error('Пакет 3D/КД не содержит геометрию мачты')
  }
  if (!result.parameters) throw new Error('Пакет 3D/КД не содержит параметры конструкции')
  return value as unknown as DesignPackageV1
}

export function designResultFromPackage(value: unknown): DesignPackageV1['result'] {
  return assertDesignPackage(value).result
}

export function serializeDesignPackage(value: unknown): string {
  return `${JSON.stringify(assertDesignPackage(value), null, 2)}\n`
}

export function parseDesignPackage(text: unknown): DesignPackageV1 {
  let value: unknown
  try {
    value = JSON.parse(String(text)) as unknown
  } catch (error) {
    throw new Error(`Не удалось прочитать JSON-пакет 3D/КД: ${error instanceof Error ? error.message : String(error)}`)
  }
  return assertDesignPackage(value)
}
