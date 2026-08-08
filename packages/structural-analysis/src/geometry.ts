import type { ResolvedProject } from '../../domain/contracts.js'
import { resolveModuleDiameters } from '../../domain/index.js'
import { calculateEquivalentMemberWeldZoneStiffness } from './weld-zone-stiffness.js'

const levelNodeId = (level: number, corner: number): number => level * 3 + corner

const levelNodeIds = (level: number): number[] => [0, 1, 2].map((corner) => levelNodeId(level, corner))

type Position3 = [number, number, number]
type Restraint6 = [boolean, boolean, boolean, boolean, boolean, boolean]
type MemberRole = 'top-ring' | 'leg'
type WeldZoneStiffness = ReturnType<typeof calculateEquivalentMemberWeldZoneStiffness>

interface MastNode {
  id: number
  level: number
  corner: number
  position: Position3
  restrained: Restraint6
}

interface MastMember {
  id: number
  nodeA: number
  nodeB: number
  moduleIndex: number
  role: MemberRole
  diameterM: number
  nominalYoungModulusPa: number
  youngModulusPa: number
  weldZoneStiffness: WeldZoneStiffness
  yieldStrengthPa: number
  tensileStrengthPa: number
  poissonRatio: number
  densityKgM3: number
  effectiveLengthFactor: number
}

interface MastModule {
  index: number
  number: number
  diameterMm: number
  bottomLevel: number
  topLevel: number
  bottomNodeIds: number[]
  topNodeIds: number[]
  memberIds: number[]
}

export interface GeneratedMastModel {
  nodes: MastNode[]
  members: MastMember[]
  modules: MastModule[]
  moduleCount: number
  moduleDiametersMm: number[]
  baseNodeIds: number[]
  topNodeIds: number[]
  stiffnessModel: {
    id: 'weld-zone-equivalent-member-stiffness-v1'
    nominalYoungModulusPa: number
    representativeRetentionFactor: number
    representativeZoneRetentionFactor: number
    note: string
  }
}

export function generateMastModel(parameters: ResolvedProject): GeneratedMastModel {
  const moduleCount = Math.max(1, Math.floor(parameters.moduleCount))
  const sideM = parameters.triangleSideMm / 1000
  const heightM = parameters.moduleHeightMm / 1000
  const moduleDiametersMm = resolveModuleDiameters({ ...parameters, moduleCount })
  const nominalYoungModulusPa = parameters.youngModulusGPa * 1e9
  const yieldStrengthPa = parameters.yieldStrengthMPa * 1e6
  const tensileStrengthPa = parameters.tensileStrengthMPa * 1e6
  const poissonRatio = parameters.poissonRatio

  if (![sideM, heightM, nominalYoungModulusPa, yieldStrengthPa, tensileStrengthPa].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Геометрические и механические параметры должны быть положительными числами')
  }
  if (!Number.isFinite(poissonRatio) || poissonRatio <= -1 || poissonRatio >= 0.5) {
    throw new Error('Коэффициент Пуассона должен быть в диапазоне (-1; 0,5)')
  }

  const radius = sideM / Math.sqrt(3)
  const nodes: MastNode[] = []
  for (let level = 0; level <= moduleCount; level += 1) {
    const rotation = level % 2 === 0 ? 0 : Math.PI / 3
    for (let corner = 0; corner < 3; corner += 1) {
      const angle = rotation + corner * (2 * Math.PI / 3)
      nodes.push({
        id: levelNodeId(level, corner),
        level,
        corner,
        position: [radius * Math.cos(angle), radius * Math.sin(angle), level * heightM],
        // Нижний модуль всегда стоит тремя ножками на идеальном жёстком
        // фундаменте. Все шесть DOF трёх нижних опор заделаны.
        restrained: level === 0
          ? [true, true, true, true, true, true]
          : [false, false, false, false, false, false],
      })
    }
  }

  const members: MastMember[] = []
  const modules: MastModule[] = []
  const addMember = (
    nodeA: number,
    nodeB: number,
    moduleIndex: number,
    role: MemberRole,
    diameterM: number,
  ): number => {
    const pointA = nodes[nodeA]?.position
    const pointB = nodes[nodeB]?.position
    if (!pointA || !pointB) throw new Error('Некорректный индекс узла при построении модели мачты')
    const memberLengthM = Math.hypot(
      pointB[0] - pointA[0],
      pointB[1] - pointA[1],
      pointB[2] - pointA[2],
    )
    const weldZoneStiffness = calculateEquivalentMemberWeldZoneStiffness({
      memberLengthM,
      memberDiameterMm: diameterM * 1000,
      ...(parameters.weldServiceYears === undefined ? {} : { serviceYears: parameters.weldServiceYears }),
      ...(parameters.weldInitialStiffnessRetention === undefined ? {} : { initialStiffnessRetention: parameters.weldInitialStiffnessRetention }),
      ...(parameters.weldAnnualStiffnessLossRate === undefined ? {} : { annualStiffnessLossRate: parameters.weldAnnualStiffnessLossRate }),
      ...(parameters.weldMinimumStiffnessRetention === undefined ? {} : { minimumStiffnessRetention: parameters.weldMinimumStiffnessRetention }),
    })
    const youngModulusPa = nominalYoungModulusPa
      * weldZoneStiffness.equivalentStiffnessRetentionFactor
    const member: MastMember = {
      id: members.length,
      nodeA,
      nodeB,
      moduleIndex,
      role,
      diameterM,
      nominalYoungModulusPa,
      youngModulusPa,
      weldZoneStiffness,
      yieldStrengthPa,
      tensileStrengthPa,
      poissonRatio,
      densityKgM3: parameters.densityKgM3,
      effectiveLengthFactor: parameters.effectiveLengthFactor,
    }
    members.push(member)
    return member.id
  }

  for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex += 1) {
    const bottomLevel = moduleIndex
    const topLevel = moduleIndex + 1
    const memberIds: number[] = []
    const diameterMm = moduleDiametersMm[moduleIndex]
    if (diameterMm === undefined) throw new Error(`Не определён диаметр модуля ${moduleIndex + 1}`)
    const diameterM = diameterMm / 1000

    // Физический модуль устанавливается «ножками вниз»: его собственный
    // горизонтальный треугольник расположен СВЕРХ, а шесть диагональных
    // рёбер идут от этого треугольника к трём нижним опорным точкам.
    // Поэтому верхний треугольник последнего модуля уже существует как
    // часть самого модуля и никакого специального closeTopRing не нужно.
    for (let corner = 0; corner < 3; corner += 1) {
      memberIds.push(addMember(
        levelNodeId(topLevel, corner),
        levelNodeId(topLevel, (corner + 1) % 3),
        moduleIndex,
        'top-ring',
        diameterM,
      ))
    }

    // Соседние уровни повёрнуты на 60°. Направление второй диагонали
    // чередуется, чтобы каждый модуль оставался правильным октаэдром и
    // физически тем же самым изделием, только повернутым в пространстве.
    const adjacentCornerOffset = moduleIndex % 2 === 0 ? 2 : 1
    for (let corner = 0; corner < 3; corner += 1) {
      memberIds.push(addMember(
        levelNodeId(bottomLevel, corner),
        levelNodeId(topLevel, corner),
        moduleIndex,
        'leg',
        diameterM,
      ))
      memberIds.push(addMember(
        levelNodeId(bottomLevel, corner),
        levelNodeId(topLevel, (corner + adjacentCornerOffset) % 3),
        moduleIndex,
        'leg',
        diameterM,
      ))
    }

    modules.push({
      index: moduleIndex,
      number: moduleIndex + 1,
      diameterMm,
      bottomLevel,
      topLevel,
      bottomNodeIds: levelNodeIds(bottomLevel),
      topNodeIds: levelNodeIds(topLevel),
      memberIds,
    })
  }

  return {
    nodes,
    members,
    modules,
    moduleCount,
    moduleDiametersMm,
    baseNodeIds: levelNodeIds(0),
    topNodeIds: levelNodeIds(moduleCount),
    stiffnessModel: {
      id: 'weld-zone-equivalent-member-stiffness-v1',
      nominalYoungModulusPa,
      representativeRetentionFactor: members[0]?.weldZoneStiffness.equivalentStiffnessRetentionFactor ?? 1,
      representativeZoneRetentionFactor: members[0]?.weldZoneStiffness.zoneStiffnessRetentionFactor ?? 1,
      note: 'FEM учитывает две короткие околошовные зоны каждого ребра через эквивалентную series-compliance жёсткость; это проектный reserve issue #19, а не утверждение об изменении E всей стали.',
    },
  }
}
