export const TECHNICAL_PROJECTION_SCHEMA = 'mast-calculator/technical-projection/v1'

const EPS = 1e-9
const SHARP_EDGE_COS = Math.cos(40 * Math.PI / 180)

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm3 = (v) => Math.hypot(v[0], v[1], v[2])
const unit3 = (v) => {
  const length = norm3(v)
  return length > EPS ? v.map((value) => value / length) : [0, 0, 0]
}

const escapeXml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

function rotateIso(point) {
  const yaw = -Math.PI / 4
  const pitch = Math.atan(1 / Math.sqrt(2))
  const [x, y, z] = point
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x1 = cy * x - sy * y
  const y1 = sy * x + cy * y
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return [x1, cp * z - sp * y1, sp * z + cp * y1]
}

function projectionFor(view) {
  if (view === 'front') {
    return { project: (p) => [p[0], p[2]], depth: (p) => p[1], viewDirection: [0, -1, 0] }
  }
  if (view === 'right') {
    return { project: (p) => [p[1], p[2]], depth: (p) => p[0], viewDirection: [1, 0, 0] }
  }
  if (view === 'top') {
    return { project: (p) => [p[0], p[1]], depth: (p) => p[2], viewDirection: [0, 0, 1] }
  }
  return {
    project: (p) => {
      const r = rotateIso(p)
      return [r[0], r[1]]
    },
    depth: (p) => rotateIso(p)[2],
    viewDirection: unit3([1, 1, -1]),
  }
}

function faceNormal(vertices, face) {
  if (face.length < 3) return [0, 0, 0]
  return unit3(cross3(
    sub3(vertices[face[1]], vertices[face[0]]),
    sub3(vertices[face[2]], vertices[face[0]]),
  ))
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function objectEdges(object, viewDirection) {
  const adjacency = new Map()
  const normals = object.faces.map((face) => faceNormal(object.vertices, face))
  const facing = normals.map((normal) => dot3(normal, viewDirection))
  object.faces.forEach((face, faceIndex) => {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index]
      const b = face[(index + 1) % face.length]
      const key = edgeKey(a, b)
      if (!adjacency.has(key)) adjacency.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] })
      adjacency.get(key).faces.push(faceIndex)
    }
  })

  const edges = []
  for (const edge of adjacency.values()) {
    if (edge.faces.length <= 1) {
      edges.push({ ...edge, hidden: false })
      continue
    }
    const [first, second] = edge.faces
    const n1 = normals[first]
    const n2 = normals[second]
    const f1 = facing[first]
    const f2 = facing[second]
    const silhouette = f1 * f2 <= 0
    const sharp = dot3(n1, n2) < SHARP_EDGE_COS
    const visibleSharp = sharp && (f1 <= EPS || f2 <= EPS)
    if (silhouette || visibleSharp) edges.push({ ...edge, hidden: false })
    else if (sharp) edges.push({ ...edge, hidden: true })
  }
  return edges
}

function selectedObjects(scene, filter) {
  const objects = scene?.objects ?? []
  return typeof filter === 'function' ? objects.filter(filter) : objects
}

function projectedBounds(objects, projector) {
  const minimum = [Infinity, Infinity]
  const maximum = [-Infinity, -Infinity]
  for (const object of objects) {
    for (const vertex of object.vertices) {
      const point = projector(vertex)
      minimum[0] = Math.min(minimum[0], point[0])
      minimum[1] = Math.min(minimum[1], point[1])
      maximum[0] = Math.max(maximum[0], point[0])
      maximum[1] = Math.max(maximum[1], point[1])
    }
  }
  if (!Number.isFinite(minimum[0])) return { minimum: [0, 0], maximum: [1, 1], size: [1, 1] }
  return {
    minimum,
    maximum,
    size: [Math.max(EPS, maximum[0] - minimum[0]), Math.max(EPS, maximum[1] - minimum[1])],
  }
}

export function projectMeshToSvg(scene, options = {}) {
  const view = options.view ?? 'front'
  const x = Number(options.x ?? 0)
  const y = Number(options.y ?? 0)
  const width = Math.max(1, Number(options.width ?? 100))
  const height = Math.max(1, Number(options.height ?? 100))
  const padding = Math.max(0, Number(options.padding ?? 5))
  const objects = selectedObjects(scene, options.objectFilter)
  const projection = projectionFor(view)
  const bounds = projectedBounds(objects, projection.project)
  const scale = Math.min(
    (width - 2 * padding) / bounds.size[0],
    (height - 2 * padding) / bounds.size[1],
  )
  const centerSource = [
    (bounds.minimum[0] + bounds.maximum[0]) / 2,
    (bounds.minimum[1] + bounds.maximum[1]) / 2,
  ]
  const centerTarget = [x + width / 2, y + height / 2]
  const mapPoint = (point) => {
    const projected = projection.project(point)
    return [
      centerTarget[0] + (projected[0] - centerSource[0]) * scale,
      centerTarget[1] - (projected[1] - centerSource[1]) * scale,
    ]
  }

  const lineItems = []
  for (const object of objects) {
    const edges = objectEdges(object, projection.viewDirection)
    for (const edge of edges) {
      const a = mapPoint(object.vertices[edge.a])
      const b = mapPoint(object.vertices[edge.b])
      const depth = (projection.depth(object.vertices[edge.a]) + projection.depth(object.vertices[edge.b])) / 2
      lineItems.push({ a, b, depth, hidden: edge.hidden, object })
    }
  }
  lineItems.sort((left, right) => left.depth - right.depth)

  const lines = lineItems.map((item) => {
    const css = item.hidden ? 'tech-hidden' : 'tech-visible'
    return `<line class="${css}" x1="${item.a[0].toFixed(3)}" y1="${item.a[1].toFixed(3)}" x2="${item.b[0].toFixed(3)}" y2="${item.b[1].toFixed(3)}"/>`
  }).join('')
  const label = options.label
    ? `<text class="tech-view-label" x="${(x + 2).toFixed(2)}" y="${(y + 5).toFixed(2)}">${escapeXml(options.label)}</text>`
    : ''
  return `<g data-tech-view="${escapeXml(view)}">${lines}${label}</g>`
}

export function dimensionHorizontalSvg(x1, x2, y, label, options = {}) {
  const offset = Number(options.tick ?? 2.3)
  const textY = y - 1.7
  return `<g class="tech-dimension"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - offset}" x2="${x1}" y2="${y + offset}"/><line x1="${x2}" y1="${y - offset}" x2="${x2}" y2="${y + offset}"/><text x="${(x1 + x2) / 2}" y="${textY}" text-anchor="middle">${escapeXml(label)}</text></g>`
}

export function dimensionVerticalSvg(x, y1, y2, label, options = {}) {
  const offset = Number(options.tick ?? 2.3)
  const textX = x - 1.7
  return `<g class="tech-dimension"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - offset}" y1="${y1}" x2="${x + offset}" y2="${y1}"/><line x1="${x - offset}" y1="${y2}" x2="${x + offset}" y2="${y2}"/><text x="${textX}" y="${(y1 + y2) / 2}" text-anchor="middle" transform="rotate(-90 ${textX} ${(y1 + y2) / 2})">${escapeXml(label)}</text></g>`
}
