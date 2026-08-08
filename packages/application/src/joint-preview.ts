import type { ProjectInput } from '../../domain/contracts.js'
import {
  JOINT_BOLT_LENGTHS_MM,
  THREAD_ENGAGEMENT_FACTORS,
  WELD_LEG_SIZES_MM,
  WELD_SEGMENT_COUNTS,
  buildJointHardwareGeometry,
  clearanceNutOptionsForBolt,
  resolveProjectInput,
  validateProjectInput,
} from '../../domain/index.js'
import {
  DEFAULT_NUT_FACTOR,
  DEFAULT_NUT_TO_RIB_AREA_RATIO,
  DEFAULT_PRELOAD_VARIATION,
  DEFAULT_TIGHTENING_TORQUE_NM,
  DEFAULT_WELD_TO_RIB_AREA_RATIO,
  JOINT_CONFIGURATOR_MODES,
  MAX_WELD_TO_RIB_AREA_RATIO,
  MIN_WELD_TO_RIB_AREA_RATIO,
  calculateBoltCapacity,
  checkJointNutSections,
  resolveJointStrengthParameters,
} from '../../engineering/index.js'
import { toApplicationError } from './errors.js'
import { immutablePublicResult } from './immutability.js'

const NUT_SECTION_AREA_RATIOS = Object.freeze([
  DEFAULT_NUT_TO_RIB_AREA_RATIO,
  2.5,
  3,
])

/** Presentation-neutral option catalogue for connection-configuration adapters. */
export function getJointConfigurationOptions() {
  return immutablePublicResult({
    modes: JOINT_CONFIGURATOR_MODES.map((item) => ({ id: item.id, label: item.label })),
    boltLengthsMm: [...JOINT_BOLT_LENGTHS_MM],
    threadEngagementFactors: [...THREAD_ENGAGEMENT_FACTORS],
    weldLegSizesMm: [...WELD_LEG_SIZES_MM],
    weldSegmentCounts: [...WELD_SEGMENT_COUNTS],
    nutSectionAreaRatios: [...NUT_SECTION_AREA_RATIOS],
    weldToRibAreaRatios: [
      MIN_WELD_TO_RIB_AREA_RATIO,
      DEFAULT_WELD_TO_RIB_AREA_RATIO,
      MAX_WELD_TO_RIB_AREA_RATIO,
    ],
    defaults: {
      tighteningTorqueNm: DEFAULT_TIGHTENING_TORQUE_NM,
      nutFactor: DEFAULT_NUT_FACTOR,
      preloadVariation: DEFAULT_PRELOAD_VARIATION,
      nutSectionAreaRatio: DEFAULT_NUT_TO_RIB_AREA_RATIO,
      weldToRibAreaRatio: DEFAULT_WELD_TO_RIB_AREA_RATIO,
    },
  })
}

/** Valid pass-through nut choices for a selected physical bolt diameter. */
export function getJointClearanceNutOptions(boltDiameterMm: number) {
  try {
    return immutablePublicResult(clearanceNutOptionsForBolt(boltDiameterMm).map((item) => ({
      threadDiameterMm: item.threadDiameterMm,
      basicMinorDiameterMm: item.basicMinorDiameterMm,
      diametralClearanceMm: item.diametralClearanceMm,
    })))
  } catch (error) {
    throw toApplicationError(error)
  }
}

/**
 * Resolve one canonical ProjectInput and return the physical connection geometry
 * plus lightweight strength/preload values needed for configuration previews.
 */
export function previewJointConfiguration(input: ProjectInput) {
  try {
    const parameters = resolveProjectInput(validateProjectInput(input))
    const strength = resolveJointStrengthParameters(parameters)
    const manual = parameters.jointConfiguratorMode === 'manual'
    const geometry = buildJointHardwareGeometry({
      boltDiameterMm: parameters.jointBoltDiameterMm,
      boltClass: parameters.jointBoltClass,
      ...(manual ? {
        clearanceNutThreadMm: parameters.jointClearanceNutThreadMm,
        boltLengthMm: parameters.jointBoltLengthMm,
      } : {}),
      threadEngagementFactor: parameters.jointThreadEngagementFactor,
    })
    const nutSections = checkJointNutSections(geometry, parameters.barDiameterMm, {
      requiredRatio: strength.jointNutSectionAreaRatio,
    })
    const bolt = calculateBoltCapacity({
      diameterMm: geometry.bolt.diameterMm,
      boltClass: parameters.jointBoltClass,
      tighteningTorqueNm: strength.jointTighteningTorqueNm,
      nutFactor: strength.jointNutFactor,
      preloadVariation: strength.jointPreloadVariation,
    })

    return immutablePublicResult({
      geometry,
      strength: {
        minimumNutSectionRatio: nutSections.minimumRatio,
        requiredNutSectionRatio: nutSections.requiredRatio,
        tighteningTorqueNm: strength.jointTighteningTorqueNm,
        nutFactor: strength.jointNutFactor,
        maximumPreloadN: bolt.preload.maximumPreloadN,
        externalTensionReserveN: bolt.externalTensionReserveN,
        weldToRibAreaRatio: strength.weldToRibAreaRatio,
      },
    })
  } catch (error) {
    throw toApplicationError(error)
  }
}
