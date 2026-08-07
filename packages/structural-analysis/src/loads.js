import { dot3, norm3, scale3, sub3, unit3 } from '../../numerics/index.js'

const GRAVITY = 9.80665

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

function normalizedTopPointLoad(options = {}) {
  const raw = options.topPointLoadN ?? [0, 0, 0]
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error('Внутренняя точечная нагрузка вершины должна быть вектором [Fx, Fy, Fz]')
  }
  const value = raw.map(Number)
  if (!value.every(Number.isFinite)) {
    throw new Error('Компоненты внутренней точечной нагрузки вершины должны быть конечными числами')
  }
  return value
}

export function buildLoadCase(model, parameters, options = {}) {
  // В frame-модели собственный вес, лёд и ветер на стержни являются
  // распределёнными нагрузками. В nodalLoads остаются только нагрузки,
  // приложенные непосредственно к расчётным узлам: масса/парусность
  // оборудования и внутренняя test-fixture нагрузка специальных расчётов.
  //
  // Issue #36: произвольные extraHorizontal/extraVertical больше не являются
  // пользовательскими параметрами. Нормированные 1 Н проверки передают силу
  // отдельно через options.topPointLoadN, чтобы verification API не протекал в UI.
  const nodalLoads = model.nodes.map(() => [0, 0, 0])
  const nodalMoments = model.nodes.map(() => [0, 0, 0])
  const memberDistributedLoads = model.members.map(() => [0, 0, 0])
  const memberLoadDetails = model.members.map(() => null)
  const topPointLoadN = normalizedTopPointLoad(options)

  const directionRad = parameters.windDirectionDeg * Math.PI / 180
  const wind = [Math.cos(directionRad), Math.sin(directionRad), 0]
  const iceThicknessM = Math.max(0, parameters.iceThicknessMm ?? 0) / 1000
  const iceDensityKgM3 = Math.max(0, parameters.iceDensityKgM3 ?? 900)
  let selfWeightN = 0
  let iceWeightN = 0
  let memberWindN = 0
  let distributedResultant = [0, 0, 0]

  const addNodeLoad = (nodeId, load) => {
    const target = nodalLoads[nodeId]
    if (!target) throw new Error(`Не найден узел ${nodeId}`)
    target[0] += load[0]
    target[1] += load[1]
    target[2] += load[2]
  }

  for (const member of model.members) {
    const nodeA = model.nodes[member.nodeA]
    const nodeB = model.nodes[member.nodeB]
    if (!nodeA || !nodeB) throw new Error(`Некорректная ссылка в стержне ${member.id}`)

    const delta = sub3(nodeB.position, nodeA.position)
    const lengthM = norm3(delta)
    const axis = unit3(delta)
    const steelAreaM2 = Math.PI * member.diameterM ** 2 / 4
    const outerDiameterM = member.diameterM + 2 * iceThicknessM
    const iceAreaM2 = Math.PI * Math.max(0, outerDiameterM ** 2 - member.diameterM ** 2) / 4

    const steelWeightPerLengthN = member.densityKgM3
      * steelAreaM2
      * GRAVITY
      * parameters.deadLoadFactor
    const iceWeightPerLengthN = iceDensityKgM3
      * iceAreaM2
      * GRAVITY
      * parameters.deadLoadFactor

    const steelWeightN = steelWeightPerLengthN * lengthM
    const memberIceWeightN = iceWeightPerLengthN * lengthM
    selfWeightN += steelWeightN
    iceWeightN += memberIceWeightN

    // Для цилиндрического стержня учитываем только компонент скорости/давления,
    // нормальный к его оси. Вектор (wind - axis*(axis·wind)) одновременно задаёт
    // направление силы и коэффициент пространственной проекции.
    const axisWindProjection = dot3(axis, wind)
    const windNormal = sub3(wind, scale3(axis, axisWindProjection))
    const windCoefficientNPerM = parameters.windPressurePa
      * parameters.dragCoefficient
      * outerDiameterM
      * parameters.windLoadFactor
    const windPerLength = scale3(windNormal, windCoefficientNPerM)
    const windForceN = norm3(windPerLength) * lengthM
    memberWindN += windForceN

    const gravityPerLength = [0, 0, -(steelWeightPerLengthN + iceWeightPerLengthN)]
    const distributed = add3(windPerLength, gravityPerLength)
    memberDistributedLoads[member.id] = distributed
    memberLoadDetails[member.id] = {
      memberId: member.id,
      lengthM,
      steelWeightPerLengthN,
      iceWeightPerLengthN,
      windForcePerLengthN: [...windPerLength],
      resultantForcePerLengthN: [...distributed],
    }
    distributedResultant = add3(distributedResultant, scale3(distributed, lengthM))
  }

  // equipmentMassKg — единственная пользовательская вертикальная нагрузка
  // вершины. Она переводится в расчётный вес по m*g*equipmentLoadFactor.
  const equipmentMassKg = Math.max(0, Number(parameters.equipmentMassKg ?? 0))
  const equipmentWeightN = equipmentMassKg * GRAVITY * parameters.equipmentLoadFactor
  const equipmentWindN = parameters.windPressurePa
    * parameters.equipmentDragCoefficient
    * parameters.equipmentWindAreaM2
    * parameters.windLoadFactor

  const topCount = Math.max(model.topNodeIds.length, 1)
  for (const nodeId of model.topNodeIds) {
    addNodeLoad(nodeId, [
      (wind[0] * equipmentWindN + topPointLoadN[0]) / topCount,
      (wind[1] * equipmentWindN + topPointLoadN[1]) / topCount,
      (-equipmentWeightN + topPointLoadN[2]) / topCount,
    ])
  }

  const nodalResultant = nodalLoads.reduce(
    (sum, load) => add3(sum, load),
    [0, 0, 0],
  )
  const totalAppliedLoad = add3(distributedResultant, nodalResultant)

  return {
    nodalLoads,
    nodalMoments,
    memberDistributedLoads,
    memberLoadDetails,
    totalAppliedLoad,
    distributedResultant,
    nodalResultant,
    selfWeightN,
    iceWeightN,
    memberWindN,
    equipmentWeightN,
    equipmentWindN,
    topPointLoadN: [...topPointLoadN],
    topHorizontalLoadN: Math.hypot(
      equipmentWindN * wind[0] + topPointLoadN[0],
      equipmentWindN * wind[1] + topPointLoadN[1],
    ),
    topVerticalLoadN: equipmentWeightN - topPointLoadN[2],
    windDirectionDeg: parameters.windDirectionDeg,
  }
}
