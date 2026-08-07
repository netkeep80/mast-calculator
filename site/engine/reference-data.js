import {
  REINFORCEMENT_CLASSES,
  STANDARD_DIAMETERS_MM,
} from './catalog.js'
import {
  BOLT_PROPERTY_CLASSES,
  BOLT_SIZES,
  CONNECTION_STANDARD,
  FASTENER_GEOMETRY_STANDARD,
  FASTENER_STANDARD,
  THREAD_STANDARD,
  WELD_CONSUMABLES,
} from './connection-catalog.js'
import {
  COUPLING_NUTS,
  REGULAR_NUTS,
  WELD_LEG_SIZES_MM,
} from './joint-hardware-catalog.js'
import { reinforcementMassPerMeterKg } from './assembly-mass.js'

export const REFERENCE_DATA_SCHEMA = 'mast-calculator/reference-data/v1'

export function buildReferenceData() {
  const reinforcementClasses = Object.values(REINFORCEMENT_CLASSES).map((item) => ({ ...item }))
  const reinforcementDiameters = STANDARD_DIAMETERS_MM.map((diameterMm) => ({
    diameterMm,
    areaMm2: Math.PI * diameterMm ** 2 / 4,
    massPerMeterKg: reinforcementMassPerMeterKg(diameterMm),
  }))
  const boltClasses = Object.values(BOLT_PROPERTY_CLASSES).map((item) => ({ ...item }))
  const boltSizes = BOLT_SIZES.map((item) => ({
    ...item,
    strengthStandard: CONNECTION_STANDARD,
    materialStandard: FASTENER_STANDARD,
    geometryStandard: FASTENER_GEOMETRY_STANDARD,
    threadStandard: THREAD_STANDARD,
  }))
  const regularNuts = REGULAR_NUTS.map((item) => ({ ...item }))
  const couplingNuts = COUPLING_NUTS.map((item) => ({ ...item }))
  const weldConsumables = WELD_CONSUMABLES.map((item) => ({
    ...item,
    resistanceStandard: CONNECTION_STANDARD,
  }))

  return {
    schema: REFERENCE_DATA_SCHEMA,
    reinforcement: {
      classes: reinforcementClasses,
      diameters: reinforcementDiameters,
    },
    fasteners: {
      classes: boltClasses,
      sizes: boltSizes,
      regularNuts,
      couplingNuts,
    },
    welding: {
      consumables: weldConsumables,
      filletLegSizesMm: [...WELD_LEG_SIZES_MM],
    },
  }
}
