import { buildDetailedMastModel } from '../../packages/design/index.js'

const LIGHT_DIRECTION = (() => {
  const vector = [-0.35, 0.45, 0.82]
  const length = Math.hypot(...vector)
  return vector.map((value) => value / length)
})()

const segmentDistance = (point, start, end) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

function faceLighting(cameraVertices, face) {
  if (face.length < 3) return 0.75
  const a = cameraVertices[face[0]]
  const b = cameraVertices[face[1]]
  const c = cameraVertices[face[2]]
  const normal = cross3(sub3(b, a), sub3(c, a))
  const length = Math.hypot(...normal)
  if (!(length > 1e-9)) return 0.75
  const dot = Math.abs(
    normal[0] / length * LIGHT_DIRECTION[0]
    + normal[1] / length * LIGHT_DIRECTION[1]
    + normal[2] / length * LIGHT_DIRECTION[2],
  )
  return 0.58 + 0.42 * dot
}

function viewerRadialSegments(result) {
  const members = Number(result?.model?.members?.length ?? 0)
  if (members > 720) return 6
  if (members > 180) return 8
  return 10
}

export class MastViewer {
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    if (!this.context) throw new Error('Браузер не поддерживает Canvas 2D для 3D-просмотрщика')
    this.result = null
    this.detailedModel = null
    this.detailedModelError = null
    this.showBucklingMode = false
    this.selectedModuleIndex = 0
    this.onModuleSelect = options.onModuleSelect ?? null
    this.yaw = -0.65
    this.pitch = 0.35
    this.zoom = 1
    this.dragging = false
    this.pointerMoved = false
    this.pointerDownAt = null
    this.lastPointer = null
    this.projectedNodes = null
    this.drawFrame = null

    if (canvas.style) canvas.style.touchAction = 'none'
    if ('tabIndex' in canvas && canvas.tabIndex < 0) canvas.tabIndex = 0

    const resize = () => {
      const ratio = Math.min(globalThis.window?.devicePixelRatio || 1, 2)
      const rectangle = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rectangle.width * ratio))
      canvas.height = Math.max(1, Math.round(rectangle.height * ratio))
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0)
      this.draw()
    }

    const ResizeObserverClass = globalThis.ResizeObserver
    if (ResizeObserverClass) new ResizeObserverClass(resize).observe(canvas)
    else resize()

    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true
      this.pointerMoved = false
      this.pointerDownAt = [event.clientX, event.clientY]
      this.lastPointer = [event.clientX, event.clientY]
      canvas.focus?.()
      canvas.setPointerCapture?.(event.pointerId)
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging || !this.lastPointer) return
      const dx = event.clientX - this.lastPointer[0]
      const dy = event.clientY - this.lastPointer[1]
      if (Math.hypot(
        event.clientX - (this.pointerDownAt?.[0] ?? event.clientX),
        event.clientY - (this.pointerDownAt?.[1] ?? event.clientY),
      ) > 4) this.pointerMoved = true
      this.yaw += dx * 0.01
      this.pitch = clamp(this.pitch + dy * 0.01, -1.2, 1.2)
      this.lastPointer = [event.clientX, event.clientY]
      this.scheduleDraw()
    })
    canvas.addEventListener('pointerup', (event) => {
      if (!this.pointerMoved) this.pickModule(event)
      this.finishPointer()
    })
    canvas.addEventListener('pointercancel', () => this.finishPointer())
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * 0.001), 0.35, 4)
      this.scheduleDraw()
    }, { passive: false })
    canvas.addEventListener('dblclick', () => {
      this.resetView()
      this.scheduleDraw()
    })
    canvas.addEventListener('keydown', (event) => this.handleKeydown(event))
    resize()
  }

  finishPointer() {
    this.dragging = false
    this.pointerMoved = false
    this.pointerDownAt = null
    this.lastPointer = null
  }

  handleKeydown(event) {
    let handled = true
    if (event.key === 'ArrowLeft') this.yaw -= 0.12
    else if (event.key === 'ArrowRight') this.yaw += 0.12
    else if (event.key === 'ArrowUp') this.pitch = clamp(this.pitch - 0.1, -1.2, 1.2)
    else if (event.key === 'ArrowDown') this.pitch = clamp(this.pitch + 0.1, -1.2, 1.2)
    else if (event.key === '+' || event.key === '=') this.zoom = clamp(this.zoom * 1.15, 0.35, 4)
    else if (event.key === '-' || event.key === '_') this.zoom = clamp(this.zoom / 1.15, 0.35, 4)
    else if (event.key === '0' || event.key === 'Home') this.resetView()
    else handled = false
    if (!handled) return
    event.preventDefault()
    this.scheduleDraw()
  }

  resetView() {
    this.yaw = -0.65
    this.pitch = 0.35
    this.zoom = 1
  }

  scheduleDraw() {
    if (this.drawFrame != null) return
    const requestFrame = globalThis.requestAnimationFrame
    if (typeof requestFrame !== 'function') {
      this.draw()
      return
    }
    this.drawFrame = requestFrame(() => {
      this.drawFrame = null
      this.draw()
    })
  }

  setResult(result) {
    this.result = result
    this.selectedModuleIndex = Math.min(
      this.selectedModuleIndex,
      Math.max(0, (result?.model?.moduleCount ?? 1) - 1),
    )
    this.detailedModel = null
    this.detailedModelError = null
    if (result) {
      try {
        this.detailedModel = buildDetailedMastModel(result, {
          radialSegments: viewerRadialSegments(result),
          includeJointHardware: true,
        })
      } catch (error) {
        this.detailedModelError = error instanceof Error ? error.message : String(error)
      }
    }
    this.draw()
  }

  setBucklingMode(enabled) {
    this.showBucklingMode = enabled
    this.draw()
  }

  setSelectedModule(moduleIndex) {
    const count = this.result?.model?.moduleCount ?? 1
    this.selectedModuleIndex = clamp(Number(moduleIndex) || 0, 0, count - 1)
    this.draw()
  }

  setModuleSelectHandler(handler) {
    this.onModuleSelect = handler
  }

  rotate(point) {
    const [x, y, z] = point
    const cosYaw = Math.cos(this.yaw)
    const sinYaw = Math.sin(this.yaw)
    const rotatedX = cosYaw * x - sinYaw * y
    const rotatedY = sinYaw * x + cosYaw * y
    const cosPitch = Math.cos(this.pitch)
    const sinPitch = Math.sin(this.pitch)
    const vertical = cosPitch * z - sinPitch * rotatedY
    const depth = sinPitch * z + cosPitch * rotatedY
    return [rotatedX, vertical, depth]
  }

  project(pointMm, scale, centerX, centerY) {
    const camera = this.rotate(pointMm)
    return {
      x: centerX + camera[0] * scale,
      y: centerY - camera[1] * scale,
      depth: camera[2],
      camera,
    }
  }

  pickModule(event) {
    if (!this.result || !this.projectedNodes) return
    const rectangle = this.canvas.getBoundingClientRect()
    const point = { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top }
    let best = null
    for (const member of this.result.model.members) {
      if (!Number.isInteger(member.moduleIndex)) continue
      const start = this.projectedNodes[member.nodeA]
      const end = this.projectedNodes[member.nodeB]
      const distance = segmentDistance(point, start, end)
      if (!best || distance < best.distance) best = { distance, moduleIndex: member.moduleIndex }
    }
    if (!best || best.distance > 14) return
    this.setSelectedModule(best.moduleIndex)
    this.onModuleSelect?.(best.moduleIndex)
  }

  objectStyle(object, lighting, ghost = false) {
    if (ghost) return { fill: 'hsl(210 10% 68%)', stroke: 'rgba(38, 55, 68, 0.2)', alpha: 0.16 }
    const selected = object.moduleIndices?.includes(this.selectedModuleIndex)
    if (object.kind === 'member') {
      const analysis = this.result?.analysis ?? this.result?.envelope?.governing?.analysis
      const utilization = clamp(Number(analysis?.memberResults?.[object.memberId]?.utilization ?? 0), 0, 1)
      const hue = Math.round((1 - utilization) * 120)
      const saturation = selected ? 72 : 44
      const baseLightness = selected ? 38 : 51
      const lightness = clamp(baseLightness * (0.72 + 0.42 * lighting), 24, 68)
      return {
        fill: `hsl(${hue} ${saturation}% ${lightness.toFixed(1)}%)`,
        stroke: selected ? 'rgba(24, 58, 49, 0.52)' : 'rgba(35, 55, 62, 0.24)',
        alpha: selected ? 0.98 : 0.78,
      }
    }
    const hardwareLightness = {
      'coupling-nut': 47,
      'clearance-nut': 58,
      'bolt-shaft': 36,
      'bolt-head': 42,
    }[object.kind] ?? 50
    const baseLightness = hardwareLightness - (selected ? 5 : 0)
    const lightness = clamp(baseLightness * (0.72 + 0.42 * lighting), 22, 72)
    return {
      fill: `hsl(210 10% ${lightness.toFixed(1)}%)`,
      stroke: selected ? 'rgba(26, 42, 54, 0.68)' : 'rgba(40, 54, 64, 0.32)',
      alpha: selected ? 1 : 0.84,
    }
  }

  drawDetailedModel(scale, centerX, centerY, options = {}) {
    if (!this.detailedModel) return false
    const faces = []
    for (const object of this.detailedModel.objects) {
      const projected = object.vertices.map((vertex) => this.project(vertex, scale, centerX, centerY))
      const cameraVertices = projected.map((vertex) => vertex.camera)
      for (const face of object.faces) {
        const depth = face.reduce((sum, index) => sum + projected[index].depth, 0) / face.length
        faces.push({
          object,
          face,
          projected,
          depth,
          lighting: faceLighting(cameraVertices, face),
        })
      }
    }
    faces.sort((left, right) => left.depth - right.depth)

    const ctx = this.context
    ctx.lineJoin = 'round'
    for (const item of faces) {
      const first = item.projected[item.face[0]]
      const style = this.objectStyle(item.object, item.lighting, options.ghost)
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (let index = 1; index < item.face.length; index += 1) {
        const point = item.projected[item.face[index]]
        ctx.lineTo(point.x, point.y)
      }
      ctx.closePath()
      ctx.globalAlpha = style.alpha
      ctx.fillStyle = style.fill
      ctx.fill()
      ctx.strokeStyle = style.stroke
      ctx.lineWidth = item.object.moduleIndices?.includes(this.selectedModuleIndex) ? 0.75 : 0.45
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    return true
  }

  drawMembers(projectedNodes, options = {}) {
    const { model } = this.result
    const analysis = this.result.analysis ?? this.result.envelope?.governing?.analysis ?? {}
    const items = model.members.map((member) => ({
      member,
      depth: (projectedNodes[member.nodeA].depth + projectedNodes[member.nodeB].depth) / 2,
    })).sort((a, b) => a.depth - b.depth)

    const ctx = this.context
    ctx.lineCap = 'round'
    for (const item of items) {
      const start = projectedNodes[item.member.nodeA]
      const end = projectedNodes[item.member.nodeB]
      const selected = item.member.moduleIndex === this.selectedModuleIndex
      const utilization = Math.min(1, analysis.memberResults?.[item.member.id]?.utilization ?? 0)
      const hue = Math.round((1 - utilization) * 120)
      if (options.ghost) {
        ctx.strokeStyle = '#b8c0c8'
        ctx.globalAlpha = 0.36
      } else if (selected) {
        ctx.strokeStyle = this.showBucklingMode ? '#1d5f9a' : `hsl(${hue} 82% 32%)`
        ctx.globalAlpha = 1
      } else {
        ctx.strokeStyle = this.showBucklingMode ? '#6f8fa8' : `hsl(${hue} 42% 52%)`
        ctx.globalAlpha = 0.42
      }
      ctx.lineWidth = selected
        ? Math.max(2.3, 4.2 * this.zoom)
        : Math.max(1, 1.8 * this.zoom)
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  drawSelectedNodes(projectedNodes) {
    const selectedNodeIds = new Set(this.result.model.modules?.[this.selectedModuleIndex]
      ? [
          ...this.result.model.modules[this.selectedModuleIndex].bottomNodeIds,
          ...this.result.model.modules[this.selectedModuleIndex].topNodeIds,
        ]
      : [])
    const ctx = this.context
    for (const nodeId of selectedNodeIds) {
      const node = projectedNodes[nodeId]
      if (!node) continue
      ctx.fillStyle = '#0f4d3c'
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(node.x, node.y, Math.max(2.2, 3.3 * this.zoom), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  draw() {
    const ctx = this.context
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#f5f7fa'
    ctx.fillRect(0, 0, width, height)

    if (!this.result) {
      ctx.fillStyle = '#667583'
      ctx.textAlign = 'center'
      ctx.fillText('Нет расчётной модели', width / 2, height / 2)
      return
    }

    const { model } = this.result
    const analysis = this.result.analysis ?? this.result.envelope?.governing?.analysis ?? {}
    const mastHeightMm = Math.max(...model.nodes.map((node) => node.position[2])) * 1000
    const baseScale = Math.min(width * 0.55, height * 0.78) / Math.max(mastHeightMm, 100)
    const scale = baseScale * this.zoom
    const centerX = width / 2
    const centerY = height * 0.88
    const original = model.nodes.map((node) => this.project(
      node.position.map((value) => value * 1000),
      scale,
      centerX,
      centerY,
    ))
    this.projectedNodes = original

    if (this.showBucklingMode && Number.isFinite(analysis.buckling?.criticalLoadFactor)) {
      this.drawDetailedModel(scale, centerX, centerY, { ghost: true })
      const amplitudeMm = mastHeightMm * 0.16
      const deformed = model.nodes.map((node) => {
        const mode = analysis.buckling.mode?.[node.id] ?? [0, 0, 0]
        const point = node.position.map((value) => value * 1000)
        return point.map((value, axis) => value + amplitudeMm * mode[axis])
      }).map((point) => this.project(point, scale, centerX, centerY))
      this.projectedNodes = deformed
      this.drawMembers(deformed)
      this.drawSelectedNodes(deformed)
    } else if (this.drawDetailedModel(scale, centerX, centerY)) {
      this.drawSelectedNodes(original)
    } else {
      this.drawMembers(original)
      this.drawSelectedNodes(original)
    }

    ctx.fillStyle = '#657382'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'left'
    const modelText = this.detailedModel
      ? `Подробная 3D-модель · ${this.detailedModel.statistics.structuralMembers} рёбер · ${this.detailedModel.statistics.hardwareObjects} деталей крепежа`
      : `Проволочная FEM-схема${this.detailedModelError ? ` · ${this.detailedModelError}` : ''}`
    ctx.fillText(modelText, 12, 20)
    ctx.fillStyle = '#203243'
    ctx.font = '600 12px system-ui'
    const modeText = this.showBucklingMode ? ' · форма потери устойчивости увеличена' : ''
    ctx.fillText(`Модуль ${this.selectedModuleIndex + 1} из ${model.moduleCount}${modeText}`, 12, 40)
    ctx.fillStyle = '#657382'
    ctx.font = '11px system-ui'
    ctx.fillText('Перетаскивание — вращение · колесо/± — масштаб · клик — модуль · двойной клик/0 — сброс', 12, 58)
  }
}
