const levelNodeId = (level, corner) => level * 3 + corner

const levelNodeIds = (level) => [0, 1, 2].map((corner) => levelNodeId(level, corner))

export function generateMastModel(parameters) {
  const moduleCount = Math.max(1, Math.floor(parameters.moduleCount))
  const sideM = parameters.triangleSideMm / 1000
  const heightM = parameters.moduleHeightMm / 1000
  const diameterM = parameters.barDiameterMm / 1000
  const youngModulusPa = parameters.youngModulusGPa * 1e9
  const yieldStrengthPa = parameters.yieldStrengthMPa * 1e6
  const poissonRatio = parameters.poissonRatio

  if (![sideM, heightM, diameterM, youngModulusPa, yieldStrengthPa].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Геометрические и механические параметры должны быть положительными числами')
  }
  if (!Number.isFinite(poissonRatio) || poissonRatio <= -1 || poissonRatio >= 0.5) {
    throw new Error('Коэффициент Пуассона должен быть в диапазоне (-1; 0,5)')
  }

  const radius = sideM / Math.sqrt(3)
  const nodes = []
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

  const members = []
  const modules = []
  const addMember = (nodeA, nodeB, moduleIndex, role) => {
    const member = {
      id: members.length,
      nodeA,
      nodeB,
      moduleIndex,
      role,
      diameterM,
      youngModulusPa,
      yieldStrengthPa,
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
    const memberIds = []

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
      ))
      memberIds.push(addMember(
        levelNodeId(bottomLevel, corner),
        levelNodeId(topLevel, (corner + adjacentCornerOffset) % 3),
        moduleIndex,
        'leg',
      ))
    }

    modules.push({
      index: moduleIndex,
      number: moduleIndex + 1,
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
    baseNodeIds: levelNodeIds(0),
    topNodeIds: levelNodeIds(moduleCount),
  }
}
