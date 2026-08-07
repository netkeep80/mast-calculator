import { calculateAssemblyMass } from './assembly-mass.js'

export const DESIGN_PACKAGE_SCHEMA = 'mast-calculator/design-package/v1'

const jsonClone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))

function compactMemberResults(result) {
  const analysis = result?.envelope?.governing?.analysis ?? result?.analysis
  if (!Array.isArray(analysis?.memberResults)) return []
  return analysis.memberResults.map((member, index) => ({
    memberId: Number(member?.memberId ?? index),
    utilization: Number(member?.utilization ?? 0),
  }))
}

function compactConnections(result) {
  const source = result?.connections
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

export function buildDesignPackage(result, metadata = {}) {
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

export function assertDesignPackage(value) {
  if (!value || value.schema !== DESIGN_PACKAGE_SCHEMA) {
    throw new Error(`Неподдерживаемый пакет 3D/КД: ожидается ${DESIGN_PACKAGE_SCHEMA}`)
  }
  if (!value.result?.model?.nodes?.length || !value.result?.model?.members?.length) {
    throw new Error('Пакет 3D/КД не содержит геометрию мачты')
  }
  if (!value.result?.parameters) throw new Error('Пакет 3D/КД не содержит параметры конструкции')
  return value
}

export function designResultFromPackage(value) {
  return assertDesignPackage(value).result
}

export function serializeDesignPackage(value) {
  return `${JSON.stringify(assertDesignPackage(value), null, 2)}\n`
}

export function parseDesignPackage(text) {
  let value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    throw new Error(`Не удалось прочитать JSON-пакет 3D/КД: ${error instanceof Error ? error.message : String(error)}`)
  }
  return assertDesignPackage(value)
}
