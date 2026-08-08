import type { ResolvedProject } from '../../domain/contracts.js'
import {
  getBoltSize,
  HARDWARE_STEEL_DENSITY_KG_M3,
  metricInternalThreadMinorDiameterMm,
  resolveModuleDiameters,
} from '../../domain/index.js'
import type { calculateConnectionChecks } from '../../engineering/index.js'
import type { GeneratedMastModel } from '../../structural-analysis/index.js'

export const ASSEMBLY_MASS_METHOD = 'fabrication-mass-estimate-v1'
export const FILLET_WELD_AREA_FACTOR = 0.5
export const PHYSICAL_MODULE_RIB_COUNT = 9
export const PHYSICAL_MODULE_JOINT_COUNT = 3
export const RIB_ENDS_PER_MODULE = PHYSICAL_MODULE_RIB_COUNT * 2
export const RIB_ENDS_PER_INTERMODULE_JOINT = 6

type ConnectionChecks = ReturnType<typeof calculateConnectionChecks>
type SelectedGeometry = ConnectionChecks['configurator']['geometry']

interface BoltGeometryLike {
  diameterMm: unknown
  lengthMm: unknown
  headAcrossFlatsMm?: unknown
  headHeightMm?: unknown
}

interface NutGeometryLike {
  heightMm?: unknown
  lengthMm?: unknown
  acrossFlatsMm: unknown
  pitchMm: unknown
  threadDiameterMm: unknown
  basicMinorDiameterMm?: unknown
}

interface WeldEnvelopeItem {
  check?: {
    requiredPhysicalLengthMm?: unknown
  }
}

interface AssemblyMassInput {
  parameters: ResolvedProject
  model: GeneratedMastModel
  analysis?: {
    totalMassKg?: number
  }
  connections: ConnectionChecks
}

const mm3ToM3 = (volumeMm3: number): number => volumeMm3 * 1e-9
const massFromMm3 = (volumeMm3: number, densityKgM3: number): number => mm3ToM3(volumeMm3) * densityKgM3
const hexAreaFromAcrossFlatsMm = (acrossFlatsMm: number): number => Math.sqrt(3) * acrossFlatsMm ** 2 / 2
const circleAreaMm2 = (diameterMm: number): number => Math.PI * diameterMm ** 2 / 4

export function reinforcementMassPerMeterKg(
  diameterMm: unknown,
  densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3,
): number {
  const diameterM = Number(diameterMm) / 1000
  if (!(diameterM > 0)) throw new Error('Диаметр арматуры должен быть положительным')
  return densityKgM3 * Math.PI * diameterM ** 2 / 4
}

export function estimateBoltMassKg(
  boltGeometry: BoltGeometryLike,
  densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3,
) {
  const size = getBoltSize(boltGeometry.diameterMm)
  const lengthMm = Number(boltGeometry.lengthMm)
  if (!(lengthMm > 0)) throw new Error('Длина болта должна быть положительной')
  const headAcrossFlatsMm = Number(boltGeometry.headAcrossFlatsMm ?? size.headAcrossFlatsMm)
  const headHeightMm = Number(boltGeometry.headHeightMm ?? size.headHeightMm)
  const shaftVolumeMm3 = circleAreaMm2(size.diameterMm) * lengthMm
  const headVolumeMm3 = hexAreaFromAcrossFlatsMm(headAcrossFlatsMm) * headHeightMm
  const massKg = massFromMm3(shaftVolumeMm3 + headVolumeMm3, densityKgM3)
  return {
    method: 'cylindrical-shank-plus-hex-head' as const,
    massKg,
    shaftVolumeMm3,
    headVolumeMm3,
    densityKgM3,
    note: 'Геометрическая оценка: стержень болта принят цилиндром номинального диаметра; профиль резьбы и фаски не вычитаются.',
  }
}

export function estimateNutMassKg(
  nutGeometry: NutGeometryLike,
  densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3,
) {
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
    method: 'hex-prism-minus-basic-minor-diameter-hole' as const,
    massKg: massFromMm3(materialVolumeMm3, densityKgM3),
    outsideVolumeMm3,
    holeVolumeMm3,
    materialVolumeMm3,
    minorDiameterMm,
    densityKgM3,
    note: 'Геометрическая оценка по базовому внутреннему диаметру резьбы; фаски и реальный винтовой профиль не моделируются.',
  }
}

export interface FilletWeldMassInput {
  weldLegMm: unknown
  physicalLengthMm: unknown
  densityKgM3?: number
}

export function estimateFilletWeldMassKg({
  weldLegMm,
  physicalLengthMm,
  densityKgM3 = HARDWARE_STEEL_DENSITY_KG_M3,
}: FilletWeldMassInput) {
  const leg = Number(weldLegMm)
  const length = Number(physicalLengthMm)
  if (!(leg > 0) || !(length >= 0)) throw new Error('Катет и длина шва должны быть неотрицательными')
  const areaMm2 = FILLET_WELD_AREA_FACTOR * leg ** 2
  const volumeMm3 = areaMm2 * length
  return {
    method: 'ideal-triangular-fillet-weld' as const,
    massKg: massFromMm3(volumeMm3, densityKgM3),
    areaMm2,
    volumeMm3,
    physicalLengthMm: length,
    weldLegMm: leg,
    densityKgM3,
    note: 'Оценка наплавленного металла: площадь поперечного сечения углового шва принята k²/2.',
  }
}

function selectedGeometry(result: AssemblyMassInput): SelectedGeometry {
  const geometry = result.connections?.configurator?.geometry
    ?? result.connections?.bolt?.selected?.geometry
  if (!geometry) throw new Error('Для оценки массы сборки отсутствует выбранная геометрия соединительного узла')
  return geometry
}

function criticalWeldLengthMm(result: AssemblyMassInput): number {
  return Number(result.connections?.weld?.critical?.check?.requiredPhysicalLengthMm ?? 0)
}

function optimizedWeldLengthMm(result: AssemblyMassInput): number {
  return ((result.connections?.weld?.envelope ?? []) as readonly WeldEnvelopeItem[]).reduce(
    (sum, item) => sum + Number(item?.check?.requiredPhysicalLengthMm ?? 0),
    0,
  )
}

export function calculateAssemblyMass(result: AssemblyMassInput) {
  if (!result?.model?.members?.length || !result?.parameters) {
    throw new Error('Для оценки сборочной массы требуется готовый расчёт мачты')
  }
  const parameters = result.parameters
  const geometry = selectedGeometry(result)
  const densityKgM3 = Number(parameters.densityKgM3 ?? HARDWARE_STEEL_DENSITY_KG_M3)
  const ribLengthM = Number(parameters.ribCutLengthMm) / 1000
  const moduleDiametersMm = resolveModuleDiameters(parameters)
  const ribProfiles = moduleDiametersMm.map((diameterMm, moduleIndex) => {
    const massPerMeterKg = reinforcementMassPerMeterKg(diameterMm, densityKgM3)
    const massKg = massPerMeterKg * ribLengthM
    return {
      moduleIndex,
      moduleNumber: moduleIndex + 1,
      diameterMm,
      massPerMeterKg,
      massKg,
      weightN: massKg * 9.80665,
    }
  })
  const firstRib = ribProfiles[0]
  if (!firstRib) throw new Error('Для оценки массы сборки не сформирован профиль ни одного модуля')
  let minimumRib = firstRib
  let maximumRib = firstRib
  for (const item of ribProfiles.slice(1)) {
    if (item.massKg < minimumRib.massKg) minimumRib = item
    if (item.massKg > maximumRib.massKg) maximumRib = item
  }

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
  const moduleHardwareMassKg = jointHardwareMassKg * PHYSICAL_MODULE_JOINT_COUNT
  const moduleWeldMassKg = weldPerEnd.massKg * RIB_ENDS_PER_MODULE
  const moduleProfiles = ribProfiles.map((rib) => {
    const ribsMassKg = rib.massKg * PHYSICAL_MODULE_RIB_COUNT
    const totalMassKg = ribsMassKg + moduleHardwareMassKg + moduleWeldMassKg
    return {
      moduleIndex: rib.moduleIndex,
      moduleNumber: rib.moduleNumber,
      diameterMm: rib.diameterMm,
      ribsMassKg,
      hardwareMassKg: moduleHardwareMassKg,
      weldMassKg: moduleWeldMassKg,
      totalMassKg,
      weightN: totalMassKg * 9.80665,
    }
  })
  const firstModule = moduleProfiles[0]
  if (!firstModule) throw new Error('Для оценки массы сборки не сформирован ни один модуль')
  let minimumModule = firstModule
  let maximumModule = firstModule
  for (const item of moduleProfiles.slice(1)) {
    if (item.totalMassKg < minimumModule.totalMassKg) minimumModule = item
    if (item.totalMassKg > maximumModule.totalMassKg) maximumModule = item
  }
  const profiledModulesMassKg = moduleProfiles.reduce((sum, item) => sum + item.totalMassKg, 0)
  const uniformMaximumDiameterMassKg = maximumModule.totalMassKg * result.model.moduleCount

  const optimizedWeldLengthTotalMm = optimizedWeldLengthMm(result)
  const optimizedWeldMassKg = estimateFilletWeldMassKg({
    weldLegMm,
    physicalLengthMm: optimizedWeldLengthTotalMm,
    densityKgM3,
  }).massKg

  return {
    method: ASSEMBLY_MASS_METHOD,
    densityKgM3,
    moduleDiametersMm,
    includesInGlobalFemSelfWeight: false,
    reasonNotInFem: 'Длина сварки получается из усилий после FEM. Чтобы не вводить скрытую обратную связь «усилия → длина шва → масса → усилия», производственная сборочная масса пока показывается отдельно от собственного веса расчётной frame-модели.',
    rib: {
      diameterMm: maximumRib.diameterMm,
      lengthMm: parameters.ribCutLengthMm,
      massPerMeterKg: maximumRib.massPerMeterKg,
      massKg: maximumRib.massKg,
      weightN: maximumRib.weightN,
      minimumDiameterMm: minimumRib.diameterMm,
      maximumDiameterMm: maximumRib.diameterMm,
      minimumMassKg: minimumRib.massKg,
      maximumMassKg: maximumRib.massKg,
      profiles: ribProfiles,
      note: 'Основные поля rib относятся к самому тяжёлому ребру; profiles содержит фактический диаметр и массу каждого яруса.',
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
      uniformDesignRule: 'Для массы производственного изделия критическая требуемая физическая длина шва применяется ко всем концам; масса рёбер при этом считается по фактическому диаметру каждого модуля.',
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
      diameterMm: maximumModule.diameterMm,
      ribsMassKg: maximumModule.ribsMassKg,
      hardwareMassKg: maximumModule.hardwareMassKg,
      weldMassKg: maximumModule.weldMassKg,
      totalMassKg: maximumModule.totalMassKg,
      weightN: maximumModule.weightN,
      minimumTotalMassKg: minimumModule.totalMassKg,
      maximumTotalMassKg: maximumModule.totalMassKg,
      profiles: moduleProfiles,
      composition: '9 рёбер + 3 длинные гайки + 3 проходные гайки + 3 болта + 18 сваренных концов',
    },
    mastFabricationEstimate: {
      moduleCount: result.model.moduleCount,
      ribsOnlyFemMassKg: result.analysis?.totalMassKg ?? null,
      profiledModulesMassKg,
      uniformModulesMassKg: profiledModulesMassKg,
      uniformMaximumDiameterMassKg,
      savingsVsUniformMaximumDiameterKg: Math.max(0, uniformMaximumDiameterMassKg - profiledModulesMassKg),
    },
  }
}
