import type { ResolvedProject } from '../../domain/contracts.js'
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
import {
  DEFAULT_WELD_ANNUAL_STIFFNESS_LOSS_RATE,
  DEFAULT_WELD_INITIAL_STIFFNESS_RETENTION,
  DEFAULT_WELD_MINIMUM_STIFFNESS_RETENTION,
  DEFAULT_WELD_SERVICE_YEARS,
} from '../../domain/index.js'

type JointStrengthParameterInput = Partial<Pick<ResolvedProject,
  | 'jointTighteningTorqueNm'
  | 'jointNutFactor'
  | 'jointPreloadVariation'
  | 'jointNutSectionAreaRatio'
  | 'weldToRibAreaRatio'
  | 'weldServiceYears'
  | 'weldInitialStiffnessRetention'
  | 'weldAnnualStiffnessLossRate'
  | 'weldMinimumStiffnessRetention'
>>

const finiteOr = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback

export function resolveJointStrengthParameters(parameters: JointStrengthParameterInput = {}) {
  const tighteningTorqueNm = Math.max(0, finiteOr(parameters.jointTighteningTorqueNm, DEFAULT_TIGHTENING_TORQUE_NM))
  const nutFactor = finiteOr(parameters.jointNutFactor, DEFAULT_NUT_FACTOR)
  if (!(nutFactor > 0)) throw new Error('Коэффициент гайки K должен быть положительным')
  const preloadVariation = finiteOr(parameters.jointPreloadVariation, DEFAULT_PRELOAD_VARIATION)
  if (!(preloadVariation >= 0 && preloadVariation < 1)) {
    throw new Error('Разброс преднатяга должен быть от 0 до 1')
  }
  const nutSectionRatio = finiteOr(parameters.jointNutSectionAreaRatio, DEFAULT_NUT_TO_RIB_AREA_RATIO)
  if (nutSectionRatio < DEFAULT_NUT_TO_RIB_AREA_RATIO) {
    throw new Error(`Запас сечения гайки не может быть меньше ${DEFAULT_NUT_TO_RIB_AREA_RATIO}× сечения ребра`)
  }
  const weldAreaRatio = finiteOr(parameters.weldToRibAreaRatio, DEFAULT_WELD_TO_RIB_AREA_RATIO)
  if (weldAreaRatio < MIN_WELD_TO_RIB_AREA_RATIO || weldAreaRatio > MAX_WELD_TO_RIB_AREA_RATIO) {
    throw new Error(`Запас эффективной площади шва должен быть ${MIN_WELD_TO_RIB_AREA_RATIO}…${MAX_WELD_TO_RIB_AREA_RATIO}× сечения ребра`)
  }

  const weldServiceYears = Math.max(0, finiteOr(parameters.weldServiceYears, DEFAULT_WELD_SERVICE_YEARS))
  const weldInitialStiffnessRetention = finiteOr(
    parameters.weldInitialStiffnessRetention,
    DEFAULT_WELD_INITIAL_STIFFNESS_RETENTION,
  )
  const weldAnnualStiffnessLossRate = finiteOr(
    parameters.weldAnnualStiffnessLossRate,
    DEFAULT_WELD_ANNUAL_STIFFNESS_LOSS_RATE,
  )
  const weldMinimumStiffnessRetention = finiteOr(
    parameters.weldMinimumStiffnessRetention,
    DEFAULT_WELD_MINIMUM_STIFFNESS_RETENTION,
  )

  return {
    jointTighteningTorqueNm: tighteningTorqueNm,
    jointNutFactor: nutFactor,
    jointPreloadVariation: preloadVariation,
    jointNutSectionAreaRatio: nutSectionRatio,
    weldToRibAreaRatio: weldAreaRatio,
    weldServiceYears,
    weldInitialStiffnessRetention,
    weldAnnualStiffnessLossRate,
    weldMinimumStiffnessRetention,
  }
}
