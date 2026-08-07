import { metricInternalThreadMinorDiameterMm } from '../../domain/index.js'

export const DETAILED_MAST_MODEL_SCHEMA = 'mast-calculator/detailed-mast-model/v1'

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

class MeshBuilder {
  constructor() {
    this.objects = []
  }

  createObject(metadata) {
    const object = {
      ...metadata,
      vertices: [],
      faces: [],
    }
    this.objects.push(object)
    return object
  }

  vertex(object, point) {
    const value = point.map(Number)
    if (value.length !== 3 || value.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error(`Mesh ${object.name} содержит нечисловую координату`)
    }
    object.vertices.push(value)
    return object.vertices.length - 1
  }

  face(object, indices) {
    if (indices.length >= 3) object.faces.push(indices)
  }

  addCylinder(metadata, start, end, radiusMm, segments = DEFAULT_RADIAL_SEGMENTS) {
    const radius = Number(radiusMm)
    if (!(radius > 0)) throw new Error(`Радиус ${metadata.name} должен быть положительным`)
    const count = Math.max(6, Math.floor(Number(segments) || DEFAULT_RADIAL_SEGMENTS))
    const { u, v } = ringBasis(start, end)
    const object = this.createObject({ ...metadata, shape: 'cylinder', radiusMm: radius })
    const startRing = []
    const endRing = []
    for (let index = 0; index < count; index += 1) {
      const angle = 2 * Math.PI * index / count
      const radial = add3(scale3(u, Math.cos(angle) * radius), scale3(v, Math.sin(angle) * radius))
      startRing.push(this.vertex(object, add3(start, radial)))
      endRing.push(this.vertex(object, add3(end, radial)))
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count
      this.face(object, [startRing[index], startRing[next], endRing[next], endRing[index]])
    }
    this.face(object, [...startRing].reverse())
    this.face(object, endRing)
  }

  addPrism(metadata, centerX, centerY, z0, z1, acrossFlatsMm, sides = 6, rotation = 0) {
    const count = Math.max(3, Math.floor(sides))
    const radius = Number(acrossFlatsMm) / (2 * Math.cos(Math.PI / count))
    const object = this.createObject({
      ...metadata,
      shape: 'prism',
      acrossFlatsMm: Number(acrossFlatsMm),
    })
    const bottom = []
    const top = []
    for (let index = 0; index < count; index += 1) {
      const angle = rotation + 2 * Math.PI * index / count
      const x = Number(centerX) + radius * Math.cos(angle)
      const y = Number(centerY) + radius * Math.sin(angle)
      bottom.push(this.vertex(object, [x, y, z0]))
      top.push(this.vertex(object, [x, y, z1]))
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count
      this.face(object, [bottom[index], bottom[next], top[next], top[index]])
    }
    this.face(object, [...bottom].reverse())
    this.face(object, top)
  }

  addHollowHexPrism(metadata, centerX, centerY, z0, z1, acrossFlatsMm, holeDiameterMm, segments = DEFAULT_RADIAL_SEGMENTS) {
    const count = Math.max(12, Math.ceil((Number(segments) || DEFAULT_RADIAL_SEGMENTS) / 6) * 6)
    const holeRadius = Number(holeDiameterMm) / 2
    const acrossFlats = Number(acrossFlatsMm)
    if (!(acrossFlats > 0) || !(holeRadius > 0) || holeRadius >= acrossFlats / 2) {
      throw new Error(`Некорректная геометрия полой гайки ${metadata.name}`)
    }
    const object = this.createObject({
      ...metadata,
      shape: 'hollow-hex-prism',
      acrossFlatsMm: acrossFlats,
      holeDiameterMm: Number(holeDiameterMm),
    })
    const outerBottom = []
    const outerTop = []
    const innerBottom = []
    const innerTop = []
    for (let index = 0; index < count; index += 1) {
      const angle = 2 * Math.PI * index / count
      const outerRadius = polygonRadiusFromAcrossFlats(acrossFlats, angle)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      outerBottom.push(this.vertex(object, [centerX + outerRadius * cos, centerY + outerRadius * sin, z0]))
      outerTop.push(this.vertex(object, [centerX + outerRadius * cos, centerY + outerRadius * sin, z1]))
      innerBottom.push(this.vertex(object, [centerX + holeRadius * cos, centerY + holeRadius * sin, z0]))
      innerTop.push(this.vertex(object, [centerX + holeRadius * cos, centerY + holeRadius * sin, z1]))
    }
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count
      this.face(object, [outerBottom[index], outerBottom[next], outerTop[next], outerTop[index]])
      this.face(object, [innerBottom[next], innerBottom[index], innerTop[index], innerTop[next]])
      this.face(object, [outerTop[index], outerTop[next], innerTop[next], innerTop[index]])
      this.face(object, [outerBottom[next], outerBottom[index], innerBottom[index], innerBottom[next]])
    }
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
  for (const member of model.members) {
    const start = modelPointMm(model.nodes[member.nodeA])
    const end = modelPointMm(model.nodes[member.nodeB])
    const diameterMm = Number(member.diameterM) * 1000 || Number(result.parameters?.barDiameterMm)
    const moduleNumber = Number.isInteger(member.moduleIndex) ? member.moduleIndex + 1 : 0
    builder.addCylinder({
      name: `member_${member.id}_module_${moduleNumber}_${member.role ?? 'bar'}`,
      group: 'structural_members',
      kind: 'member',
      memberId: member.id,
      moduleIndex: Number.isInteger(member.moduleIndex) ? member.moduleIndex : null,
      moduleIndices: Number.isInteger(member.moduleIndex) ? [member.moduleIndex] : [],
      role: member.role ?? 'bar',
      diameterMm,
    }, start, end, diameterMm / 2, radialSegments)
  }
}

function nodesAtLevel(model, level) {
  return model.nodes.filter((node) => Number(node.level) === Number(level))
}

function moduleIndices(values, moduleCount) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value < moduleCount))]
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

  for (let level = 0; level <= moduleCount; level += 1) {
    for (const node of nodesAtLevel(model, level)) {
      const [x, y, z] = modelPointMm(node)
      const suffix = `level_${level}_node_${node.id}`

      let couplingBottom = null
      let couplingTop = null
      if (level > 0) {
        couplingTop = z - gapMm / 2
        couplingBottom = couplingTop - Number(coupling.lengthMm)
        builder.addHollowHexPrism({
          name: `coupling_nut_${suffix}`,
          group: 'joint_hardware',
          kind: 'coupling-nut',
          level,
          nodeId: node.id,
          moduleIndices: moduleIndices([level - 1], moduleCount),
        }, x, y, couplingBottom, couplingTop, coupling.acrossFlatsMm, couplingHoleMm, radialSegments)
        hardwareObjects += 1
      }

      let clearanceTop = null
      if (level < moduleCount) {
        const clearanceBottom = z + gapMm / 2
        clearanceTop = clearanceBottom + Number(clearance.heightMm)
        builder.addHollowHexPrism({
          name: `clearance_nut_${suffix}`,
          group: 'joint_hardware',
          kind: 'clearance-nut',
          level,
          nodeId: node.id,
          moduleIndices: moduleIndices([level], moduleCount),
        }, x, y, clearanceBottom, clearanceTop, clearance.acrossFlatsMm, clearanceHoleMm, radialSegments)
        hardwareObjects += 1
      }

      if (level > 0 && level < moduleCount && couplingBottom != null && clearanceTop != null) {
        const shaftTop = clearanceTop
        const shaftBottom = Math.max(couplingBottom, shaftTop - Number(bolt.lengthMm))
        const adjacentModules = moduleIndices([level - 1, level], moduleCount)
        builder.addCylinder({
          name: `bolt_shaft_${suffix}`,
          group: 'joint_hardware',
          kind: 'bolt-shaft',
          level,
          nodeId: node.id,
          moduleIndices: adjacentModules,
          diameterMm: Number(bolt.diameterMm),
        }, [x, y, shaftBottom], [x, y, shaftTop], Number(bolt.diameterMm) / 2, radialSegments)
        builder.addPrism({
          name: `bolt_head_${suffix}`,
          group: 'joint_hardware',
          kind: 'bolt-head',
          level,
          nodeId: node.id,
          moduleIndices: adjacentModules,
        }, x, y, shaftTop, shaftTop + Number(bolt.headHeightMm ?? Math.max(8, bolt.diameterMm * 0.6)),
        Number(bolt.headAcrossFlatsMm ?? bolt.diameterMm * 1.5), 6, Math.PI / 6)
        hardwareObjects += 2
      }
    }
  }
  return hardwareObjects
}

function modelBounds(objects) {
  const minimum = [Infinity, Infinity, Infinity]
  const maximum = [-Infinity, -Infinity, -Infinity]
  for (const object of objects) {
    for (const vertex of object.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        minimum[axis] = Math.min(minimum[axis], vertex[axis])
        maximum[axis] = Math.max(maximum[axis], vertex[axis])
      }
    }
  }
  if (!objects.length || minimum.some((value) => !Number.isFinite(value))) {
    return { minimum: [0, 0, 0], maximum: [0, 0, 0], size: [0, 0, 0] }
  }
  return {
    minimum,
    maximum,
    size: maximum.map((value, axis) => value - minimum[axis]),
  }
}

export function buildDetailedMastModel(result, options = {}) {
  if (!result?.model?.nodes?.length || !result?.model?.members?.length) {
    throw new Error('Для подробной 3D-модели нужен выполненный расчёт с model.nodes и model.members')
  }
  const radialSegments = Math.max(6, Math.min(48, Math.floor(Number(options.radialSegments) || DEFAULT_RADIAL_SEGMENTS)))
  const builder = new MeshBuilder()
  addStructuralMembers(builder, result, radialSegments)
  const hardwareObjects = options.includeJointHardware === false
    ? 0
    : addJointHardware(builder, result, { ...options, radialSegments })
  const vertices = builder.objects.reduce((sum, object) => sum + object.vertices.length, 0)
  const faces = builder.objects.reduce((sum, object) => sum + object.faces.length, 0)
  return {
    schema: DETAILED_MAST_MODEL_SCHEMA,
    units: 'mm',
    radialSegments,
    includeJointHardware: options.includeJointHardware !== false,
    objects: builder.objects,
    bounds: modelBounds(builder.objects),
    statistics: {
      vertices,
      faces,
      objects: builder.objects.length,
      structuralMembers: result.model.members.length,
      hardwareObjects,
    },
  }
}
