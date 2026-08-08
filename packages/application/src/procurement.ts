import { getWeldConsumable } from '../../domain/index.js'
import { buildProcurementEstimate } from '../../design/index.js'
import type {
  calculateGuyedProject,
  calculateProject,
} from './use-cases.js'

type CalculationResult = ReturnType<typeof calculateProject>
type GuyedResult = ReturnType<typeof calculateGuyedProject>

export interface ProcurementEstimateOptions {
  readonly reservePercent?: number
}

interface GuyProcurementGroup {
  readonly id: string
  readonly wireId: string
  readonly label: string
  readonly diameterMm: number
  designLengthM: number
  readonly massKgM: number
  readonly source: 'guy-calculator'
}

function procurementGuyGroups(guyedResult: GuyedResult | null): GuyProcurementGroup[] {
  if (!guyedResult) return []
  const groups = new Map<string, GuyProcurementGroup>()
  for (const cable of guyedResult.cableSystem.cables) {
    const wire = cable.wire
    const existing = groups.get(wire.id)
    if (existing) {
      existing.designLengthM += cable.initialLengthM
      continue
    }
    groups.set(wire.id, {
      id: wire.id,
      wireId: wire.id,
      label: wire.label,
      diameterMm: wire.diameterMm,
      designLengthM: cable.initialLengthM,
      massKgM: wire.massKgM,
      source: 'guy-calculator',
    })
  }
  return [...groups.values()]
}

/**
 * Build the canonical procurement estimate from an already completed application result.
 * Adapters own only persistence/presentation; they must not reconstruct this mapping.
 */
export function createProcurementEstimateFromCalculation(
  result: CalculationResult,
  guyedResult: GuyedResult | null = null,
  options: ProcurementEstimateOptions = {},
) {
  const geometry = result.connections?.configurator?.geometry
  const criticalWeld = result.connections?.weld?.critical?.check
  const weld = getWeldConsumable(result.parameters.weldConsumableId)
  return buildProcurementEstimate({
    moduleCount: result.parameters.moduleCount,
    stockBarLengthMm: result.parameters.stockBarLengthMm,
    stockBarPieces: result.parameters.stockBarPieces,
    ribCutLengthMm: result.parameters.ribCutLengthMm,
    barDiameterMm: result.parameters.barDiameterMm,
    moduleDiametersMm: result.parameters.moduleDiametersMm,
    moduleHeightMm: result.parameters.moduleHeightMm,
    densityKgM3: result.parameters.densityKgM3,
    reservePercent: options.reservePercent ?? 0,
    geometry,
    weldConsumable: { label: weld.label, process: weld.process },
    weldLegMm: result.parameters.weldLegMm,
    weldPhysicalLengthPerEndMm: criticalWeld?.requiredPhysicalLengthMm ?? 0,
    boltClass: result.parameters.jointBoltClass,
    reinforcementLabel: result.parameters.reinforcementClass,
    guyCableGroups: procurementGuyGroups(guyedResult),
  })
}
