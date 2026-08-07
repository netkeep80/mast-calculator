import { getBoltSize } from './connection-catalog.js'
import {
  HARDWARE_STEEL_DENSITY_KG_M3,
  metricInternalThreadMinorDiameterMm,
} from './joint-hardware-catalog.js'

export const ASSEMBLY_MASS_METHOD = 'fabrication-mass-estimate-v1'
export const FILLET_WELD_AREA_FACTOR = 0.5
export const PHYSICAL_MODULE_RIB_COUNT = 9
export const PHYSICAL_MODULE_JOINT_COUNT = 3
export const RIB_ENDS_PER_MODULE = PHYSICAL_MODULE_RIB_COUNT * 2
export const RIB_ENDS_PER_INTERMODULE_JOINT = 6

const mm3ToM3 = (volumeMm3) => volumeMm3 * 1e-9
const massFromMm3 = (volumeMm3, densityKgM3) => mm3ToM3(volumeMm3) * densityKgM3
const hexAreaFromAcrossFlatsMm = (acrossFlatsMm) => Math.sqrt(3) * acrossFlatsMm ** 2 / 2
const circleAreaMm2 = (diameterMm) => Math.PI * diameterMm ** 2 / 4

export function reinforcementMassPerMeterKg(diameterMm, densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3) {
  const diameterM = Number(diameterMm) / 1000
  if (!(diameterM > 0)) throw new Error('Диаметр арматуры должен быть положительным')
  return densityKgM3 * Math.PI * diameterM ** 2 / 4
}

export function estimateBoltMassKg(boltGeometry, densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3) {
  const size = getBoltSize(boltGeometry.diameterMm)
  const lengthMm = Number(boltGeometry.lengthMm)
  if (!(lengthMm > 0)) throw new Error('Длина болта должна быть положительной')
  const headAcrossFlatsMm = Number(boltGeometry.headAcrossFlatsMm ?? size.headAcrossFlatsMm)
  const headHeightMm = Number(boltGeometry.headHeightMm ?? size.headHeightMm)
  const shaftVolumeMm3 = circleAreaMm2(size.diameterMm) * lengthMm
  const headVolumeMm3 = hexAreaFromAcrossFlatsMm(headAcrossFlatsMm) * headHeightMm
  const massKg = massFromMm3(shaftVolumeMm3 + headVolumeMm3, densityKgM3)
  return {
    method: 'cylindrical-shank-plus-hex-head',
    massKg,
    shaftVolumeMm3,
    headVolumeMm3,
    densityKgM3,
    note: 'Геометрическая оценка: стержень болта принят цилиндром номинального диаметра; профиль резьбы и фаски не вычитаются.',
  }
}

export function estimateNutMassKg(nutGeometry, densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3) {
  const heightMm = Number(nutGeometry.heightMm ?? nutGeometry.lengthMm)
  const acrossFlatsMm = Number(nutGeometry.acrossFlatsMm)
  const pitchMm = Number(nutGeometry.pitchMm)
  const threadDiameterMm = Number(nutGeometry.threadDiameterMm)
  if (![heightMm, acrossFlatsMm, pitchMm, threadDiameterMm].every((value) => value > 0)) {
    throw new Error('Для оценки массы гайки требуется положительная геометрия')
  }
  const minorDiameterMm = Number(
    nutGeometry.basicMinorDiameterMm
      ?? metricInternalThreadMinorDiameterMm(threadDiameterMm, pitchMm),
  )
  const outsideVolumeMm3 = hexAreaFromAcrossFlatsMm(acrossFlatsMm) * heightMm
  const holeVolumeMm3 = circleAreaMm2(minorDiameterMm) * heightMm
  const materialVolumeMm3 = Math.max(0, outsideVolumeMm3 - holeVolumeMm3)
  return {
    method: 'hex-prism-minus-basic-minor-diameter-hole',
    massKg: massFromMm3(materialVolumeMm3, densityKgM3),
    outsideVolumeMm3,
    holeVolumeMm3,
    materialVolumeMm3,
    minorDiameterMm,
    densityKgM3,
    note: 'Геометрическая оценка по базовому внутреннему диаметру резьбы; фаски и реальный винтовой профиль не моделируются.',
  }
}

export function estimateFilletWeldMassKg({
  weldLegMm,
  physicalLengthMm,
  densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3,
}) {
  const leg = Number(weldLegMm)
  const length = Number(physicalLengthMm)
  if (!(leg > 0) || !(length >= 0)) throw new Error('Катет и длина шва должны быть неотрицательными')
  const areaMm2 = FILLET_WELD_AREA_FACTOR * leg ** 2
  const volumeMm3 = areaMm2 * length
  return {
    method: 'ideal-triangular-fillet-weld',
    massKg: massFromMm3(volumeMm3, densityKgM3),
    areaMm2,
    volumeMm3,
    physicalLengthMm: length,
    weldLegMm: leg,
    densityKgM3,
    note: 'Оценка наплавленного металла: площадь поперечного сечения углового шва принята k²/2.',
  }
}

function selectedGeometry(result) {
  const geometry = result?.connections?.configurator?.geometry
    ?? result?.connections?.bolt?.selected?.geometry
  if (!geometry) throw new Error('Для оценки массы сборки отсутствует выбранная геометрия соединительного узла')
  return geometry
}

function criticalWeldLengthMm(result) {
  return Number(result?.connections?.weld?.critical?.check?.requiredPhysicalLengthMm ?? 0)
}

function optimizedWeldLengthMm(result) {
  return (result?.connections?.weld?.envelope ?? []).reduce(
    (sum, item) => sum + Number(item?.check?.requiredPhysicalLengthMm ?? 0),
    0,
  )
}

export function calculateAssemblyMass(result) {
  if (!result?.model?.members?.length || !result?.parameters) {
    throw new Error('Для оценки сборочной массы требуется готовый расчёт мачты')
  }
  const parameters = result.parameters
  const geometry = selectedGeometry(result)
  const densityKgM3 = Number(parameters.densityKgM3 ?? HARDWARE_STEEL_DENSITY_KG_M3)
  const ribMassPerMeterKg = reinforcementMassPerMeterKg(parameters.barDiameterMm, densityKgM3)
  const ribLengthM = Number(parameters.ribCutLengthMm) / 1000
  const ribMassKg = ribMassPerMeterKg * ribLengthM
  const ribWeightN = ribMassKg * 9.80665

  const bolt = estimateBoltMassKg(geometry.bolt, densityKgM3)
  const clearanceNut = estimateNutMassKg(geometry.bottomClearanceNut, densityKgM3)
  const couplingNut = estimateNutMassKg(geometry.topCouplingNut, densityKgM3)
  const weldLegMm = Number(result.connections?.weld?.configuredLegMm ?? parameters.weldLegMm)
  const designWeldLengthPerEndMm = criticalWeldLengthMm(result)
  const weldPerEnd = estimateFilletWeldMassKg({
    weldLegMm,
    physicalLengthMm: designWeldLengthPerEndMm,
    densityKgM3,
  })

  const jointWeldMassKg = weldPerEnd.massKg * RIB_ENDS_PER_INTERMODULE_JOINT
  const jointHardwareMassKg = bolt.massKg + clearanceNut.massKg + couplingNut.massKg
  const jointMassKg = jointHardwareMassKg + jointWeldMassKg

  const moduleRibsMassKg = ribMassKg * PHYSICAL_MODULE_RIB_COUNT
  const moduleHardwareMassKg = jointHardwareMassKg * PHYSICAL_MODULE_JOINT_COUNT
  const moduleWeldMassKg = weldPerEnd.massKg * RIB_ENDS_PER_MODULE
  const moduleMassKg = moduleRibsMassKg + moduleHardwareMassKg + moduleWeldMassKg

  const optimizedWeldLengthTotalMm = optimizedWeldLengthMm(result)
  const optimizedWeldMassKg = estimateFilletWeldMassKg({
    weldLegMm,
    physicalLengthMm: optimizedWeldLengthTotalMm,
    densityKgM3,
  }).massKg

  return {
    method: ASSEMBLY_MASS_METHOD,
    densityKgM3,
    includesInGlobalFemSelfWeight: false,
    reasonNotInFem: 'Длина сварки получается из усилий после FEM. Чтобы не вводить скрытую обратную связь «усилия → длина шва → масса → усилия», производственная сборочная масса пока показывается отдельно от собственного веса расчётной frame-модели.',
    rib: {
      diameterMm: parameters.barDiameterMm,
      lengthMm: parameters.ribCutLengthMm,
      massPerMeterKg: ribMassPerMeterKg,
      massKg: ribMassKg,
      weightN: ribWeightN,
    },
    hardware: {
      bolt: { ...geometry.bolt, ...bolt },
      clearanceNut: { ...geometry.bottomClearanceNut, ...clearanceNut },
      couplingNut: { ...geometry.topCouplingNut, ...couplingNut },
    },
    weld: {
      legMm: weldLegMm,
      designPhysicalLengthPerEndMm: designWeldLengthPerEndMm,
      massPerEndKg: weldPerEnd.massKg,
      areaMm2: weldPerEnd.areaMm2,
      optimizedEnvelopeTotalLengthMm: optimizedWeldLengthTotalMm,
      optimizedEnvelopeMassKg: optimizedWeldMassKg,
      uniformDesignRule: 'Для массы унифицированного изделия критическая требуемая физическая длина шва применяется ко всем концам рёбер.',
    },
    intermoduleJoint: {
      ribEndCount: RIB_ENDS_PER_INTERMODULE_JOINT,
      hardwareMassKg: jointHardwareMassKg,
      weldMassKg: jointWeldMassKg,
      totalMassKg: jointMassKg,
      weightN: jointMassKg * 9.80665,
      composition: '1 болт + 1 проходная гайка + 1 длинная соединительная гайка + 6 сваренных концов рёбер',
    },
    module: {
      ribCount: PHYSICAL_MODULE_RIB_COUNT,
      jointCount: PHYSICAL_MODULE_JOINT_COUNT,
      ribEndCount: RIB_ENDS_PER_MODULE,
      ribsMassKg: moduleRibsMassKg,
      hardwareMassKg: moduleHardwareMassKg,
      weldMassKg: moduleWeldMassKg,
      totalMassKg: moduleMassKg,
      weightN: moduleMassKg * 9.80665,
      composition: '9 рёбер + 3 длинные гайки + 3 проходные гайки + 3 болта + 18 сваренных концов',
    },
    mastFabricationEstimate: {
      moduleCount: result.model.moduleCount,
      ribsOnlyFemMassKg: result.analysis?.totalMassKg ?? null,
      uniformModulesMassKg: moduleMassKg * result.model.moduleCount,
    },
  }
}
