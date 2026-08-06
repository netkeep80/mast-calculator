const levelNodeId = (level, corner) => level * 3 + corner

export function generateMastModel(parameters) {
  const moduleCount = Math.max(1, Math.floor(parameters.moduleCount))
  const sideM = parameters.triangleSideMm / 1000
  const heightM = parameters.moduleHeightMm / 1000
  const diameterM = parameters.barDiameterMm / 1000
  const youngModulusPa = parameters.youngModulusGPa * 1e9
  const yieldStrengthPa = parameters.yieldStrengthMPa * 1e6

  if (![sideM, heightM, diameterM, youngModulusPa, yieldStrengthPa].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Геометрические и механические параметры должны быть положительными числами')
  }

  const radius = sideM / Math.sqrt(3)
  const nodes = []
  for (let level = 0; level <= moduleCount; level += 1) {
    const rotation = level % 2 === 0 ? 0 : Math.PI / 3
    for (let corner = 0; corner < 3; corner += 1) {
      const angle = rotation + corner * (2 * Math.PI / 3)
      nodes.push({
        id: levelNodeId(level, corner),
        position: [radius * Math.cos(angle), radius * Math.sin(angle), level * heightM],
        restrained: level === 0 ? [true, true, true] : [false, false, false],
      })
    }
  }

  const members = []
  const addMember = (nodeA, nodeB) => {
    members.push({
      id: members.length,
      nodeA,
      nodeB,
      diameterM,
      youngModulusPa,
      yieldStrengthPa,
      densityKgM3: parameters.densityKgM3,
      effectiveLengthFactor: parameters.effectiveLengthFactor,
    })
  }

  for (let module = 0; module < moduleCount; module += 1) {
    // Три ребра горизонтального треугольника модуля.
    for (let corner = 0; corner < 3; corner += 1) {
      addMember(levelNodeId(module, corner), levelNodeId(module, (corner + 1) % 3))
    }

    // Шесть наклонных рёбер к следующему уровню, повёрнутому на 60°.
    for (let corner = 0; corner < 3; corner += 1) {
      addMember(levelNodeId(module, corner), levelNodeId(module + 1, corner))
      addMember(levelNodeId(module, corner), levelNodeId(module + 1, (corner + 2) % 3))
    }
  }

  if (parameters.closeTopRing) {
    for (let corner = 0; corner < 3; corner += 1) {
      addMember(levelNodeId(moduleCount, corner), levelNodeId(moduleCount, (corner + 1) % 3))
    }
  }

  return {
    nodes,
    members,
    moduleCount,
    topNodeIds: [0, 1, 2].map((corner) => levelNodeId(moduleCount, corner)),
  }
}
