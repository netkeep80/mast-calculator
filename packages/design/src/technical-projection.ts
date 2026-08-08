export const TECHNICAL_PROJECTION_SCHEMA = 'mast-calculator/technical-projection/v1'

const EPS = 1e-9
const SHARP_EDGE_COS = Math.cos(40 * Math.PI / 180)

type Vector3 = [number, number, number]
type Point2 = [number, number]

export interface TechnicalMeshObject {
  vertices: readonly Vector3[]
  faces: readonly (readonly number[])[]
  readonly [key: string]: unknown
}

export interface TechnicalMeshScene {
  objects?: readonly TechnicalMeshObject[]
}

interface ProjectionDefinition {
  project: (point: readonly number[]) => Point2
  depth: (point: readonly number[]) => number
  viewDirection: Vector3
}

interface ProjectionOptions {
  view?: string
  x?: unknown
  y?: unknown
  width?: unknown
  height?: unknown
  padding?: unknown
  objectFilter?: (object: TechnicalMeshObject) => boolean
  label?: unknown
}

interface DimensionOptions {
  tick?: unknown
}

interface MeshEdge {
  a: number
  b: number
  faces: number[]
  hidden: boolean
}

const sub3 = (a: readonly number[], b: readonly number[]): Vector3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
const dot3 = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
const cross3 = (a: readonly number[], b: readonly number[]): Vector3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
]
const norm3 = (v: readonly number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!)
const unit3 = (v: readonly number[]): Vector3 => {
  const length = norm3(v)
  return length > EPS
    ? [v[0]! / length, v[1]! / length, v[2]! / length]
    : [0, 0, 0]
}

const escapeXml = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

function rotateIso(point: readonly number[]): Vector3 {
  const yaw = -Math.PI / 4
  const pitch = Math.atan(1 / Math.sqrt(2))
  const [x = 0, y = 0, z = 0] = point
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x1 = cy * x - sy * y
  const y1 = sy * x + cy * y
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return [x1, cp * z - sp * y1, sp * z + cp * y1]
}

function projectionFor(view: string): ProjectionDefinition {
  if (view === 'front') {
    return { project: (p) => [p[0]!, p[2]!], depth: (p) => p[1]!, viewDirection: [0, -1, 0] }
  }
  if (view === 'right') {
    return { project: (p) => [p[1]!, p[2]!], depth: (p) => p[0]!, viewDirection: [1, 0, 0] }
  }
  if (view === 'top') {
    return { project: (p) => [p[0]!, p[1]!], depth: (p) => p[2]!, viewDirection: [0, 0, 1] }
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

function faceNormal(vertices: readonly Vector3[], face: readonly number[]): Vector3 {
  if (face.length < 3) return [0, 0, 0]
  const v0 = vertices[face[0]!]
  const v1 = vertices[face[1]!]
  const v2 = vertices[face[2]!]
  if (!v0 || !v1 || !v2) return [0, 0, 0]
  return unit3(cross3(sub3(v1, v0), sub3(v2, v0)))
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function objectEdges(object: TechnicalMeshObject, viewDirection: readonly number[]): MeshEdge[] {
  const adjacency = new Map<string, Omit<MeshEdge, 'hidden'>>()
  const normals = object.faces.map((face) => faceNormal(object.vertices, face))
  const facing = normals.map((normal) => dot3(normal, viewDirection))
  object.faces.forEach((face, faceIndex) => {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index]!
      const b = face[(index + 1) % face.length]!
      const key = edgeKey(a, b)
      if (!adjacency.has(key)) adjacency.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] })
      adjacency.get(key)!.faces.push(faceIndex)
    }
  })

  const edges: MeshEdge[] = []
  for (const edge of adjacency.values()) {
    if (edge.faces.length <= 1) {
      edges.push({ ...edge, hidden: false })
      continue
    }
    const first = edge.faces[0]!
    const second = edge.faces[1]!
    const n1 = normals[first]!
    const n2 = normals[second]!
    const f1 = facing[first]!
    const f2 = facing[second]!
    const silhouette = f1 * f2 <= 0
    const sharp = dot3(n1, n2) < SHARP_EDGE_COS
    const visibleSharp = sharp && (f1 <= EPS || f2 <= EPS)
    if (silhouette || visibleSharp) edges.push({ ...edge, hidden: false })
    else if (sharp) edges.push({ ...edge, hidden: true })
  }
  return edges
}

function selectedObjects(
  scene: TechnicalMeshScene | null | undefined,
  filter?: (object: TechnicalMeshObject) => boolean,
): readonly TechnicalMeshObject[] {
  const objects = scene?.objects ?? []
  return typeof filter === 'function' ? objects.filter(filter) : objects
}

function projectedBounds(
  objects: readonly TechnicalMeshObject[],
  projector: (point: readonly number[]) => Point2,
) {
  const minimum: Point2 = [Infinity, Infinity]
  const maximum: Point2 = [-Infinity, -Infinity]
  for (const object of objects) {
    for (const vertex of object.vertices) {
      const point = projector(vertex)
      minimum[0] = Math.min(minimum[0], point[0])
      minimum[1] = Math.min(minimum[1], point[1])
      maximum[0] = Math.max(maximum[0], point[0])
      maximum[1] = Math.max(maximum[1], point[1])
    }
  }
  if (!Number.isFinite(minimum[0])) return { minimum: [0, 0] as Point2, maximum: [1, 1] as Point2, size: [1, 1] as Point2 }
  return {
    minimum,
    maximum,
    size: [Math.max(EPS, maximum[0] - minimum[0]), Math.max(EPS, maximum[1] - minimum[1])] as Point2,
  }
}

export function projectMeshToSvg(scene: TechnicalMeshScene, options: ProjectionOptions = {}): string {
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
  const centerSource: Point2 = [
    (bounds.minimum[0] + bounds.maximum[0]) / 2,
    (bounds.minimum[1] + bounds.maximum[1]) / 2,
  ]
  const centerTarget: Point2 = [x + width / 2, y + height / 2]
  const mapPoint = (point: readonly number[]): Point2 => {
    const projected = projection.project(point)
    return [
      centerTarget[0] + (projected[0] - centerSource[0]) * scale,
      centerTarget[1] - (projected[1] - centerSource[1]) * scale,
    ]
  }

  const lineItems: Array<{
    a: Point2
    b: Point2
    depth: number
    hidden: boolean
    object: TechnicalMeshObject
  }> = []
  for (const object of objects) {
    const edges = objectEdges(object, projection.viewDirection)
    for (const edge of edges) {
      const vertexA = object.vertices[edge.a]
      const vertexB = object.vertices[edge.b]
      if (!vertexA || !vertexB) continue
      const a = mapPoint(vertexA)
      const b = mapPoint(vertexB)
      const depth = (projection.depth(vertexA) + projection.depth(vertexB)) / 2
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

export function dimensionHorizontalSvg(
  x1: number,
  x2: number,
  y: number,
  label: unknown,
  options: DimensionOptions = {},
): string {
  const offset = Number(options.tick ?? 2.3)
  const textY = y - 1.7
  return `<g class="tech-dimension"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - offset}" x2="${x1}" y2="${y + offset}"/><line x1="${x2}" y1="${y - offset}" x2="${x2}" y2="${y + offset}"/><text x="${(x1 + x2) / 2}" y="${textY}" text-anchor="middle">${escapeXml(label)}</text></g>`
}

export function dimensionVerticalSvg(
  x: number,
  y1: number,
  y2: number,
  label: unknown,
  options: DimensionOptions = {},
): string {
  const offset = Number(options.tick ?? 2.3)
  const textX = x - 1.7
  return `<g class="tech-dimension"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - offset}" y1="${y1}" x2="${x + offset}" y2="${y1}"/><line x1="${x - offset}" y1="${y2}" x2="${x + offset}" y2="${y2}"/><text x="${textX}" y="${(y1 + y2) / 2}" text-anchor="middle" transform="rotate(-90 ${textX} ${(y1 + y2) / 2})">${escapeXml(label)}</text></g>`
}
