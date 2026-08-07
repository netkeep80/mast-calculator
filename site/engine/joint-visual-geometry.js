const DEG = 180 / Math.PI
const SQRT3 = Math.sqrt(3)

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale3 = (v, k) => v.map((value) => value * k)
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm3 = (v) => Math.hypot(...v)
const unit3 = (v) => {
  const n = norm3(v)
  if (!(n > Number.EPSILON)) throw new Error('Нулевой вектор направления ребра')
  return scale3(v, 1 / n)
}
const pointAt = (radius, angleDeg, z) => {
  const angle = angleDeg / DEG
  return [radius * Math.cos(angle), radius * Math.sin(angle), z]
}

export const OCTAHEDRON_LEG_ANGLE_TO_BOLT_DEG = Math.acos(Math.sqrt(2 / 3)) * DEG
export const JOINT_HEX_FACE_ROTATION_DEG = 0

export function representativeOctahedronJointDirections() {
  const edge = 1
  const radius = edge / Math.sqrt(3)
  const height = edge * Math.sqrt(2 / 3)
  const joint = pointAt(radius, 60, 0)
  const vectors = [
    {
      id: 'coupling-ring-left',
      group: 'coupling',
      role: 'top-ring',
      label: 'верхний треугольник A',
      vector: sub3(pointAt(radius, 180, 0), joint),
    },
    {
      id: 'coupling-ring-right',
      group: 'coupling',
      role: 'top-ring',
      label: 'верхний треугольник B',
      vector: sub3(pointAt(radius, 300, 0), joint),
    },
    {
      id: 'coupling-leg-left',
      group: 'coupling',
      role: 'leg-down',
      label: 'ножка нижнего модуля A',
      vector: sub3(pointAt(radius, 0, -height), joint),
    },
    {
      id: 'coupling-leg-right',
      group: 'coupling',
      role: 'leg-down',
      label: 'ножка нижнего модуля B',
      vector: sub3(pointAt(radius, 120, -height), joint),
    },
    {
      id: 'clearance-leg-left',
      group: 'clearance',
      role: 'leg-up',
      label: 'ножка верхнего модуля A',
      vector: sub3(pointAt(radius, 0, height), joint),
    },
    {
      id: 'clearance-leg-right',
      group: 'clearance',
      role: 'leg-up',
      label: 'ножка верхнего модуля B',
      vector: sub3(pointAt(radius, 120, height), joint),
    },
  ]
  return vectors.map((item) => ({ ...item, direction: unit3(item.vector) }))
}

export function hexFaceNormals(rotationDeg = JOINT_HEX_FACE_ROTATION_DEG) {
  return Array.from({ length: 6 }, (_, index) => {
    const angleDeg = rotationDeg + index * 60
    const angle = angleDeg / DEG
    return {
      index,
      angleDeg,
      normal: [Math.cos(angle), Math.sin(angle), 0],
    }
  })
}

export function nearestHexFace(direction, rotationDeg = JOINT_HEX_FACE_ROTATION_DEG) {
  const horizontal = unit3([direction[0], direction[1], 0])
  return hexFaceNormals(rotationDeg).reduce((best, face) => (
    dot3(horizontal, face.normal) > dot3(horizontal, best.normal) ? face : best
  ))
}

export function ribFaceContact(direction, acrossFlatsMm, barDiameterMm, zMm, rotationDeg = JOINT_HEX_FACE_ROTATION_DEG) {
  const unitDirection = unit3(direction)
  const face = nearestHexFace(unitDirection, rotationDeg)
  const faceOffsetMm = Number(acrossFlatsMm) / 2
  const barRadiusMm = Number(barDiameterMm) / 2
  const contactPoint = [
    face.normal[0] * (faceOffsetMm + barRadiusMm),
    face.normal[1] * (faceOffsetMm + barRadiusMm),
    Number(zMm),
  ]
  const angleToBoltAxisDeg = Math.acos(Math.min(1, Math.abs(unitDirection[2]))) * DEG
  const normalProjection = Math.min(1, Math.abs(dot3(unitDirection, face.normal)))
  const angleToFacePlaneDeg = Math.asin(normalProjection) * DEG
  return {
    faceIndex: face.index,
    faceAngleDeg: face.angleDeg,
    faceNormal: [...face.normal],
    contactPoint,
    direction: unitDirection,
    angleToBoltAxisDeg,
    angleToFacePlaneDeg,
  }
}

function ribContactZ(item, couplingLengthMm, clearanceZ0, clearanceHeightMm) {
  if (item.group === 'clearance') return clearanceZ0 + clearanceHeightMm * 0.5
  if (item.role === 'top-ring') return couplingLengthMm * 0.68
  return couplingLengthMm * 0.30
}

export function buildJointVisualGeometry(configuration = {}) {
  const geometry = configuration.geometry
  if (!geometry?.topCouplingNut || !geometry?.bottomClearanceNut || !geometry?.bolt) {
    throw new Error('Для 3D-схемы отсутствует геометрия соединительного узла')
  }
  const barDiameterMm = Number(configuration.barDiameterMm ?? 12)
  if (!(barDiameterMm > 0)) throw new Error('Диаметр ребра для 3D-схемы должен быть положительным')
  const coupling = geometry.topCouplingNut
  const clearance = geometry.bottomClearanceNut
  const gapMm = Number(configuration.gapMm ?? 2)
  const couplingZ0 = 0
  const couplingZ1 = coupling.lengthMm
  const clearanceZ0 = couplingZ1 + gapMm
  const clearanceZ1 = clearanceZ0 + clearance.heightMm
  const boltTop = clearanceZ1 + Math.max(8, geometry.bolt.diameterMm * 0.65)
  const displayRibLengthMm = Math.max(
    55,
    coupling.acrossFlatsMm * 1.7,
    clearance.acrossFlatsMm * 1.7,
  )
  const requiredWeldPhysicalLengthMm = Math.max(0, Number(configuration.weldPhysicalLengthMm ?? 0))
  const weldDisplayLengthMm = Math.min(
    displayRibLengthMm * 0.46,
    Math.max(12, requiredWeldPhysicalLengthMm > 0 ? requiredWeldPhysicalLengthMm / 3 : 20),
  )

  const directions = representativeOctahedronJointDirections()
  const ribs = directions.map((item) => {
    const nut = item.group === 'coupling' ? coupling : clearance
    const zMm = ribContactZ(item, coupling.lengthMm, clearanceZ0, clearance.heightMm)
    const contact = ribFaceContact(item.direction, nut.acrossFlatsMm, barDiameterMm, zMm)
    const endPoint = add3(contact.contactPoint, scale3(contact.direction, displayRibLengthMm))
    const weldEndPoint = add3(contact.contactPoint, scale3(contact.direction, weldDisplayLengthMm))
    return {
      ...item,
      ...contact,
      nutThreadDiameterMm: nut.threadDiameterMm,
      barDiameterMm,
      startPoint: contact.contactPoint,
      endPoint,
      weldStartPoint: contact.contactPoint,
      weldEndPoint,
      requiredWeldPhysicalLengthMm,
      weldDisplayLengthMm,
    }
  })

  return {
    method: 'octahedron-joint-visual-geometry-v1',
    barDiameterMm,
    gapMm,
    couplingZ0,
    couplingZ1,
    clearanceZ0,
    clearanceZ1,
    boltTop,
    totalHeightMm: boltTop,
    maxAcrossFlatsMm: Math.max(coupling.acrossFlatsMm, clearance.acrossFlatsMm),
    bolt: geometry.bolt,
    couplingNut: coupling,
    clearanceNut: clearance,
    threadEngagementMm: geometry.threadEngagementMm,
    engagedThreadTurns: geometry.engagedThreadTurns,
    ribs,
    weldPhysicalLengthMm: requiredWeldPhysicalLengthMm,
    octahedronLegAngleToBoltDeg: OCTAHEDRON_LEG_ANGLE_TO_BOLT_DEG,
    note: 'Рёбра построены из геометрии правильного октаэдра; ближайшая боковая грань гайки выбирается по направлению горизонтальной проекции ребра.',
  }
}
