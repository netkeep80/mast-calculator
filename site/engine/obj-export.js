import { metricInternalThreadMinorDiameterMm } from './joint-hardware-catalog.js'

const DEFAULT_RADIAL_SEGMENTS = 12
const DEFAULT_JOINT_GAP_MM = 2
const EPS = 1e-9

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale3 = (v, k) => [v[0] * k, v[1] * k, v[2] * k]
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm3 = (v) => Math.hypot(v[0], v[1], v[2])
const unit3 = (v) => {
  const length = norm3(v)
  if (!(length > EPS)) throw new Error('Невозможно построить mesh по нулевому отрезку')
  return scale3(v, 1 / length)
}

function cleanNumber(value) {
  const number = Math.abs(Number(value)) < 5e-10 ? 0 : Number(value)
  if (!Number.isFinite(number)) throw new Error('OBJ содержит нечисловую координату')
  return number.toFixed(6).replace(/\.?0+$/, '') || '0'
}

function objectName(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'object'
}

function polygonRadiusFromAcrossFlats(acrossFlatsMm, angle, rotation = 0) {
  const apothem = Number(acrossFlatsMm) / 2
  let maximumProjection = -Infinity
  for (let index = 0; index < 6; index += 1) {
    const normalAngle = rotation + index * Math.PI / 3
    maximumProjection = Math.max(maximumProjection, Math.cos(angle - normalAngle))
  }
  return apothem / maximumProjection
}

function ringBasis(start, end) {
  const axis = unit3(sub3(end, start))
  const helper = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = unit3(cross3(axis, helper))
  const v = unit3(cross3(axis, u))
  return { u, v }
}

class ObjBuilder {
  constructor() {
    this.lines = []
    this.vertexCount = 0
    this.faceCount = 0
    this.objectCount = 0
  }

  comment(text) {
    this.lines.push(`# ${String(text).replace(/\r?\n/g, ' ')}`)
  }

  group(name) {
    this.lines.push(`g ${objectName(name)}`)
  }

  object(name) {
    this.objectCount += 1
    this.lines.push(`o ${objectName(name)}`)
  }

  vertex(point) {
    this.vertexCount += 1
    this.lines.push(`v ${point.map(cleanNumber).join(' ')}`)
    return this.vertexCount
  }

  face(indices) {
    if (indices.length < 3) return
    this.faceCount += 1
    this.lines.push(`f ${indices.join(' ')}`)
  }

  addCylinder(name, start, end, radiusMm, segments = DEFAULT_RADIAL_SEGMENTS) {
    const radius = Number(radiusMm)
    if (!(radius > 0)) throw new Error(`Радиус ${name} должен быть положительным`)
    const count = Math.max(6, Math.floor(Number(segments) || DEFAULT_RADIAL_SEGMENTS))
    const { u, v } = ringBasis(start, end)
    this.object(name)
    const startRing = []
    const endRing = []
    for (let index = 0; index < count; index += 1) {
      const angle = 2 * Math.PI * index / count
      const radial = add3(scale3(u, Math.cos(angle) * radius), scale3(v, Math.sin(angle) * radius))
      startRing.push(this.vertex(add3(start, radial)))
      endRing.push(this.vertex(add3(end, radial)))
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count
      this.face([startRing[index], startRing[next], endRing[next], endRing[index]])
    }
    this.face([...startRing].reverse())
    this.face(endRing)
  }

  addPrism(name, centerX, centerY, z0, z1, acrossFlatsMm, sides = 6, rotation = 0) {
    const count = Math.max(3, Math.floor(sides))
    const radius = Number(acrossFlatsMm) / (2 * Math.cos(Math.PI / count))
    this.object(name)
    const bottom = []
    const top = []
    for (let index = 0; index < count; index += 1) {
      const angle = rotation + 2 * Math.PI * index / count
      const x = Number(centerX) + radius * Math.cos(angle)
      const y = Number(centerY) + radius * Math.sin(angle)
      bottom.push(this.vertex([x, y, z0]))
      top.push(this.vertex([x, y, z1]))
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count
      this.face([bottom[index], bottom[next], top[next], top[index]])
    }
    this.face([...bottom].reverse())
    this.face(top)
  }

  addHollowHexPrism(name, centerX, centerY, z0, z1, acrossFlatsMm, holeDiameterMm, segments = DEFAULT_RADIAL_SEGMENTS) {
    const count = Math.max(12, Math.ceil((Number(segments) || DEFAULT_RADIAL_SEGMENTS) / 6) * 6)
    const holeRadius = Number(holeDiameterMm) / 2
    const acrossFlats = Number(acrossFlatsMm)
    if (!(acrossFlats > 0) || !(holeRadius > 0) || holeRadius >= acrossFlats / 2) {
      throw new Error(`Некорректная геометрия полой гайки ${name}`)
    }
    const rotation = 0
    this.object(name)
    const outerBottom = []
    const outerTop = []
    const innerBottom = []
    const innerTop = []
    for (let index = 0; index < count; index += 1) {
      const angle = 2 * Math.PI * index / count
      const outerRadius = polygonRadiusFromAcrossFlats(acrossFlats, angle, rotation)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      outerBottom.push(this.vertex([centerX + outerRadius * cos, centerY + outerRadius * sin, z0]))
      outerTop.push(this.vertex([centerX + outerRadius * cos, centerY + outerRadius * sin, z1]))
      innerBottom.push(this.vertex([centerX + holeRadius * cos, centerY + holeRadius * sin, z0]))
      innerTop.push(this.vertex([centerX + holeRadius * cos, centerY + holeRadius * sin, z1]))
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count
      this.face([outerBottom[index], outerBottom[next], outerTop[next], outerTop[index]])
      this.face([innerBottom[next], innerBottom[index], innerTop[index], innerTop[next]])
      this.face([outerTop[index], outerTop[next], innerTop[next], innerTop[index]])
      this.face([outerBottom[next], outerBottom[index], innerBottom[index], innerBottom[next]])
    }
  }

  finish(statistics = {}) {
    this.lines.push('s off')
    this.comment(`summary: vertices=${this.vertexCount}, faces=${this.faceCount}, objects=${this.objectCount}`)
    if (statistics.members != null) this.comment(`structural members=${statistics.members}`)
    if (statistics.hardwareObjects != null) this.comment(`joint hardware objects=${statistics.hardwareObjects}`)
    return `${this.lines.join('\n')}\n`
  }
}

function resolvedJointGeometry(result) {
  return result?.connections?.configurator?.geometry
    ?? result?.connections?.geometry
    ?? result?.connections?.resolvedGeometry
    ?? null
}

function modelPointMm(node) {
  if (!Array.isArray(node?.position) || node.position.length !== 3) {
    throw new Error('Узел расчётной модели не содержит трёхмерную координату')
  }
  return node.position.map((value) => Number(value) * 1000)
}

function addStructuralMembers(builder, result, radialSegments) {
  const { model } = result
  builder.group('structural_members')
  for (const member of model.members) {
    const start = modelPointMm(model.nodes[member.nodeA])
    const end = modelPointMm(model.nodes[member.nodeB])
    const diameterMm = Number(member.diameterM) * 1000 || Number(result.parameters?.barDiameterMm)
    const moduleNumber = Number.isInteger(member.moduleIndex) ? member.moduleIndex + 1 : 0
    builder.addCylinder(
      `member_${member.id}_module_${moduleNumber}_${member.role ?? 'bar'}`,
      start,
      end,
      diameterMm / 2,
      radialSegments,
    )
  }
}

function nodesAtLevel(model, level) {
  return model.nodes.filter((node) => Number(node.level) === Number(level))
}

function addJointHardware(builder, result, options) {
  const geometry = resolvedJointGeometry(result)
  if (!geometry?.topCouplingNut || !geometry?.bottomClearanceNut || !geometry?.bolt) return 0

  const model = result.model
  const moduleCount = Number(model.moduleCount ?? result.parameters?.moduleCount ?? 0)
  if (!(moduleCount >= 1)) return 0

  const coupling = geometry.topCouplingNut
  const clearance = geometry.bottomClearanceNut
  const bolt = geometry.bolt
  const gapMm = Number(options.jointGapMm ?? DEFAULT_JOINT_GAP_MM)
  const radialSegments = options.radialSegments
  const couplingHoleMm = metricInternalThreadMinorDiameterMm(coupling.threadDiameterMm, coupling.pitchMm)
  const clearanceHoleMm = Number(clearance.basicMinorDiameterMm)
    || metricInternalThreadMinorDiameterMm(clearance.threadDiameterMm, clearance.pitchMm)
  let hardwareObjects = 0

  builder.group('joint_hardware')
  for (let level = 0; level <= moduleCount; level += 1) {
    for (const node of nodesAtLevel(model, level)) {
      const [x, y, z] = modelPointMm(node)
      const suffix = `level_${level}_node_${node.id}`

      let couplingBottom = null
      let couplingTop = null
      if (level > 0) {
        couplingTop = z - gapMm / 2
        couplingBottom = couplingTop - Number(coupling.lengthMm)
        builder.addHollowHexPrism(
          `coupling_nut_${suffix}`,
          x,
          y,
          couplingBottom,
          couplingTop,
          coupling.acrossFlatsMm,
          couplingHoleMm,
          radialSegments,
        )
        hardwareObjects += 1
      }

      let clearanceTop = null
      if (level < moduleCount) {
        const clearanceBottom = z + gapMm / 2
        clearanceTop = clearanceBottom + Number(clearance.heightMm)
        builder.addHollowHexPrism(
          `clearance_nut_${suffix}`,
          x,
          y,
          clearanceBottom,
          clearanceTop,
          clearance.acrossFlatsMm,
          clearanceHoleMm,
          radialSegments,
        )
        hardwareObjects += 1
      }

      if (level > 0 && level < moduleCount && couplingBottom != null && clearanceTop != null) {
        const shaftTop = clearanceTop
        const shaftBottom = Math.max(couplingBottom, shaftTop - Number(bolt.lengthMm))
        builder.addCylinder(
          `bolt_shaft_${suffix}`,
          [x, y, shaftBottom],
          [x, y, shaftTop],
          Number(bolt.diameterMm) / 2,
          radialSegments,
        )
        builder.addPrism(
          `bolt_head_${suffix}`,
          x,
          y,
          shaftTop,
          shaftTop + Number(bolt.headHeightMm ?? Math.max(8, bolt.diameterMm * 0.6)),
          Number(bolt.headAcrossFlatsMm ?? bolt.diameterMm * 1.5),
          6,
          Math.PI / 6,
        )
        hardwareObjects += 2
      }
    }
  }
  return hardwareObjects
}

export function createMastObj(result, options = {}) {
  if (!result?.model?.nodes?.length || !result?.model?.members?.length) {
    throw new Error('Для OBJ-экспорта нужен выполненный расчёт с model.nodes и model.members')
  }
  const radialSegments = Math.max(6, Math.min(48, Math.floor(Number(options.radialSegments) || DEFAULT_RADIAL_SEGMENTS)))
  const builder = new ObjBuilder()
  builder.comment('mast-calculator detailed Wavefront OBJ export')
  builder.comment('units: millimeters; Z axis: mast vertical')
  builder.comment('members use FEM centerlines with real bar diameter')
  builder.comment('joint solids use selected hardware dimensions; thread profile and weld bead are intentionally not modeled')

  addStructuralMembers(builder, result, radialSegments)
  const hardwareObjects = options.includeJointHardware === false
    ? 0
    : addJointHardware(builder, result, { ...options, radialSegments })

  return builder.finish({
    members: result.model.members.length,
    hardwareObjects,
  })
}
