import {
  applyReinforcementClass,
  regularOctahedronHeightMm,
  theoreticalCutLengthMm,
} from './catalog.js'
import { resolveWindParameters, windSpeedFromPressurePa } from './weather.js'

export const DEFAULT_LATERAL_CAPACITY_STEP_DEG = 15

export const DEFAULT_PARAMETERS = Object.freeze({
  moduleCount: 12,
  stockBarLengthMm: 12000,
  stockBarPieces: 16,
  ribCutLengthMm: 750,
  triangleSideMm: 750,
  moduleHeightMm: regularOctahedronHeightMm(750),
  reinforcementClass: 'A400C',
  barDiameterMm: 12,
  youngModulusGPa: 200,
  poissonRatio: 0.3,
  yieldStrengthMPa: 390,
  tensileStrengthMPa: 590,
  densityKgM3: 7850,
  reinforcementStandard: 'ГОСТ 34028-2016',
  reinforcementWeldabilityGuaranteed: true,
  effectiveLengthFactor: 0.5,
  materialSafetyFactor: 1.1,
  deadLoadFactor: 1.1,
  windLoadFactor: 1.4,
  equipmentLoadFactor: 1.1,
  windPresetId: 'custom',
  windPressurePa: 380,
  windSpeedMs: windSpeedFromPressurePa(380),
  dragCoefficient: 1.2,
  windDirectionDeg: 0,
  windEnvelopeEnabled: true,
  windEnvelopeStepDeg: 30,
  lateralCapacityStepDeg: DEFAULT_LATERAL_CAPACITY_STEP_DEG,
  equipmentMassKg: 20,
  equipmentWindAreaM2: 0.35,
  equipmentDragCoefficient: 1.4,
  extraHorizontalLoadN: 0,
  extraVerticalLoadN: 0,
  iceThicknessMm: 0,
  iceDensityKgM3: 900,
  displacementLimitMm: 65,
  minimumBucklingFactor: 2,
  heightSearchMaxModules: 200,
  jointConfiguratorMode: 'auto',
  jointBoltDiameterMm: 24,
  jointBoltClass: '8.8',
  jointClearanceNutThreadMm: 30,
  jointBoltLengthMm: 80,
  jointThreadEngagementFactor: 2,
  jointBoltShearPlanes: 1,
  jointEffectiveRadiusMm: 18,
  connectionConditionFactor: 1,
  jointBaseMetalTensileStrengthMPa: 490,
  weldConsumableId: 'electrode-e50a-uoni-13-55',
  weldLegMm: 4,
  weldSegmentsPerEnd: 3,
  weldBetaF: 0.7,
  weldBetaZ: 1,
})

export function resolveCalculationParameters(parameters = {}) {
  const merged = { ...DEFAULT_PARAMETERS, ...parameters }
  const withMaterial = applyReinforcementClass(merged)
  const withWind = resolveWindParameters(withMaterial)
  const ribCutLengthMm = theoreticalCutLengthMm(withWind.stockBarLengthMm, withWind.stockBarPieces)
  const moduleHeightMm = regularOctahedronHeightMm(ribCutLengthMm)
  const heightSearchMaxModules = Math.max(
    1,
    Math.min(500, Math.floor(Number(withWind.heightSearchMaxModules) || DEFAULT_PARAMETERS.heightSearchMaxModules)),
  )
  return {
    ...withWind,
    ribCutLengthMm,
    triangleSideMm: ribCutLengthMm,
    moduleHeightMm,
    heightSearchMaxModules,
    effectiveLengthFactor: 0.5,
  }
}
