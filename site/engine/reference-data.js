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
import {
  DEFAULT_NUT_FACTOR,
  DEFAULT_PRELOAD_VARIATION,
  DEFAULT_TIGHTENING_TORQUE_NM,
} from './bolt-preload.js'
import { DEFAULT_NUT_TO_RIB_AREA_RATIO } from './joint-section-check.js'
import {
  DEFAULT_WELD_TO_RIB_AREA_RATIO,
  MAX_WELD_TO_RIB_AREA_RATIO,
  MIN_WELD_TO_RIB_AREA_RATIO,
} from './weld-check.js'

export const REFERENCE_DATA_SCHEMA = 'mast-calculator/reference-data/v2'

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
    jointDesign: {
      boltPreload: {
        relation: 'T = K*F0*d',
        defaultTighteningTorqueNm: DEFAULT_TIGHTENING_TORQUE_NM,
        defaultNutFactor: DEFAULT_NUT_FACTOR,
        defaultPreloadVariation: DEFAULT_PRELOAD_VARIATION,
        source: 'NASA-STD-5020A Appendix A / NASA Fastener Design Manual; K должен уточняться для фактической резьбы, покрытия и смазки',
      },
      nutNetSection: {
        minimumAreaRatioToSingleRib: DEFAULT_NUT_TO_RIB_AREA_RATIO,
        relation: 'Anut,net / Arib >= ksection',
        source: 'Дополнительный геометрический критерий проекта issue #33, не нормативная замена проверки резьбы/смятия',
      },
      weldEffectiveArea: {
        relation: 'Aweld,eff = beta_f*kf*leff',
        minimumAreaRatioToRib: MIN_WELD_TO_RIB_AREA_RATIO,
        defaultAreaRatioToRib: DEFAULT_WELD_TO_RIB_AREA_RATIO,
        maximumSelectableAreaRatioToRib: MAX_WELD_TO_RIB_AREA_RATIO,
        source: 'Эффективная площадь = effective throat × effective length; коэффициент 2–3× является дополнительным критерием issue #33',
      },
    },
  }
}
