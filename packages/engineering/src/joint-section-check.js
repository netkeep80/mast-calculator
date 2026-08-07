import { metricInternalThreadMinorDiameterMm } from '../../domain/index.js'

export const DEFAULT_NUT_TO_RIB_AREA_RATIO = 2

const positive = (value, name) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${name} должен быть положительным числом`)
  return numeric
}

export const circleAreaMm2 = (diameterMm) => Math.PI * positive(diameterMm, 'Диаметр') ** 2 / 4
export const hexAreaAcrossFlatsMm2 = (acrossFlatsMm) => Math.sqrt(3) * positive(acrossFlatsMm, 'Размер под ключ') ** 2 / 2

export function calculateNutNetSection(nut, barDiameterMm, options = {}) {
  const requiredRatio = positive(
    options.requiredRatio ?? DEFAULT_NUT_TO_RIB_AREA_RATIO,
    'Требуемое отношение сечения гайки к ребру',
  )
  const ribAreaMm2 = circleAreaMm2(barDiameterMm)
  const holeDiameterMm = positive(
    nut.basicMinorDiameterMm
      ?? metricInternalThreadMinorDiameterMm(nut.threadDiameterMm, nut.pitchMm),
    'Базовый внутренний диаметр гайки',
  )
  const grossHexAreaMm2 = hexAreaAcrossFlatsMm2(nut.acrossFlatsMm)
  const holeAreaMm2 = circleAreaMm2(holeDiameterMm)
  const netAreaMm2 = Math.max(0, grossHexAreaMm2 - holeAreaMm2)
  const ratioToSingleRib = netAreaMm2 / ribAreaMm2
  const attachedRibCount = Math.max(1, Math.floor(Number(nut.ribCount) || 1))
  const ratioToAttachedRibs = netAreaMm2 / (ribAreaMm2 * attachedRibCount)
  const requiredNetAreaMm2 = requiredRatio * ribAreaMm2
  const utilization = requiredNetAreaMm2 / Math.max(netAreaMm2, Number.EPSILON)

  return {
    threadDiameterMm: nut.threadDiameterMm,
    pitchMm: nut.pitchMm,
    acrossFlatsMm: nut.acrossFlatsMm,
    holeDiameterMm,
    grossHexAreaMm2,
    holeAreaMm2,
    netAreaMm2,
    barDiameterMm: Number(barDiameterMm),
    ribAreaMm2,
    attachedRibCount,
    ratioToSingleRib,
    ratioToAttachedRibs,
    requiredRatio,
    requiredNetAreaMm2,
    utilization,
    passes: ratioToSingleRib + 1e-12 >= requiredRatio,
    criterion: 'Anut,net / Arib >= ksection',
    note: 'Дополнительная геометрическая проверка issue #33. Она не заменяет проверку резьбы, смятия, локального изгиба грани или prying.',
  }
}

export function checkJointNutSections(geometry, barDiameterMm, options = {}) {
  if (!geometry?.topCouplingNut || !geometry?.bottomClearanceNut) {
    throw new Error('Для проверки сечения гаек нужна полная геометрия соединительного узла')
  }
  const requiredRatio = Number(options.requiredRatio ?? DEFAULT_NUT_TO_RIB_AREA_RATIO)
  const coupling = calculateNutNetSection(geometry.topCouplingNut, barDiameterMm, { requiredRatio })
  const clearance = calculateNutNetSection(geometry.bottomClearanceNut, barDiameterMm, { requiredRatio })
  const governing = coupling.utilization >= clearance.utilization ? coupling : clearance
  return {
    method: 'hex-net-section-v1',
    requiredRatio,
    barDiameterMm: Number(barDiameterMm),
    ribAreaMm2: coupling.ribAreaMm2,
    couplingNut: coupling,
    clearanceNut: clearance,
    governingNut: governing === coupling ? 'coupling' : 'clearance',
    utilization: governing.utilization,
    minimumRatio: Math.min(coupling.ratioToSingleRib, clearance.ratioToSingleRib),
    passes: coupling.passes && clearance.passes,
  }
}
