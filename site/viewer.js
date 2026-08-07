const segmentDistance = (point, start, end) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

export class MastViewer {
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.result = null
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

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const rectangle = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rectangle.width * ratio))
      canvas.height = Math.max(1, Math.round(rectangle.height * ratio))
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0)
      this.draw()
    }

    new ResizeObserver(resize).observe(canvas)
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true
      this.pointerMoved = false
      this.pointerDownAt = [event.clientX, event.clientY]
      this.lastPointer = [event.clientX, event.clientY]
      canvas.setPointerCapture(event.pointerId)
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
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dy * 0.01))
      this.lastPointer = [event.clientX, event.clientY]
      this.draw()
    })
    canvas.addEventListener('pointerup', (event) => {
      if (!this.pointerMoved) this.pickModule(event)
      this.dragging = false
      this.pointerMoved = false
      this.pointerDownAt = null
      this.lastPointer = null
    })
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.zoom = Math.max(0.45, Math.min(2.5, this.zoom * Math.exp(-event.deltaY * 0.001)))
      this.draw()
    }, { passive: false })
    resize()
  }

  setResult(result) {
    this.result = result
    this.selectedModuleIndex = Math.min(
      this.selectedModuleIndex,
      Math.max(0, (result?.model?.moduleCount ?? 1) - 1),
    )
    this.draw()
  }

  setBucklingMode(enabled) {
    this.showBucklingMode = enabled
    this.draw()
  }

  setSelectedModule(moduleIndex) {
    const count = this.result?.model?.moduleCount ?? 1
    this.selectedModuleIndex = Math.max(0, Math.min(count - 1, Number(moduleIndex) || 0))
    this.draw()
  }

  setModuleSelectHandler(handler) {
    this.onModuleSelect = handler
  }

  project(point, scale, centerX, centerY) {
    const [x, y, z] = point
    const cosYaw = Math.cos(this.yaw)
    const sinYaw = Math.sin(this.yaw)
    const rotatedX = cosYaw * x - sinYaw * y
    const rotatedY = sinYaw * x + cosYaw * y
    const cosPitch = Math.cos(this.pitch)
    const sinPitch = Math.sin(this.pitch)
    const screenY3d = cosPitch * z - sinPitch * rotatedY
    const depth = sinPitch * z + cosPitch * rotatedY
    return { x: centerX + rotatedX * scale, y: centerY - screenY3d * scale, depth }
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

  drawMembers(projectedNodes, options = {}) {
    const { model, analysis } = this.result
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
      const utilization = Math.min(1, analysis.memberResults[item.member.id]?.utilization ?? 0)
      const hue = Math.round((1 - utilization) * 120)
      if (options.ghost) {
        ctx.strokeStyle = '#b8c0c8'
        ctx.globalAlpha = 0.65
      } else if (selected) {
        ctx.strokeStyle = this.showBucklingMode ? '#1d5f9a' : `hsl(${hue} 82% 32%)`
        ctx.globalAlpha = 1
      } else {
        ctx.strokeStyle = this.showBucklingMode ? '#6f8fa8' : `hsl(${hue} 42% 52%)`
        ctx.globalAlpha = 0.35
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

    const { model, analysis } = this.result
    const mastHeight = Math.max(...model.nodes.map((node) => node.position[2]))
    const baseScale = Math.min(width * 0.55, height * 0.78) / Math.max(mastHeight, 0.1)
    const scale = baseScale * this.zoom
    const centerX = width / 2
    const centerY = height * 0.88
    const original = model.nodes.map((node) => this.project(node.position, scale, centerX, centerY))

    let displayed = original
    if (this.showBucklingMode && Number.isFinite(analysis.buckling.criticalLoadFactor)) {
      const amplitude = mastHeight * 0.16
      const deformedPositions = model.nodes.map((node) => {
        const mode = analysis.buckling.mode[node.id] ?? [0, 0, 0]
        return node.position.map((value, axis) => value + amplitude * mode[axis])
      })
      displayed = deformedPositions.map((point) => this.project(point, scale, centerX, centerY))
      this.drawMembers(original, { ghost: true })
    }

    this.projectedNodes = displayed
    this.drawMembers(displayed)

    const selectedNodeIds = new Set(model.modules?.[this.selectedModuleIndex]
      ? [
          ...model.modules[this.selectedModuleIndex].bottomNodeIds,
          ...model.modules[this.selectedModuleIndex].topNodeIds,
        ]
      : [])
    for (let index = 0; index < displayed.length; index += 1) {
      const node = displayed[index]
      const selected = selectedNodeIds.has(index)
      ctx.fillStyle = selected ? '#0f4d3c' : '#52606d'
      ctx.globalAlpha = selected ? 1 : 0.35
      ctx.beginPath()
      ctx.arc(node.x, node.y, Math.max(2, (selected ? 4.1 : 2.6) * this.zoom), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    ctx.fillStyle = '#657382'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'left'
    const modeText = this.showBucklingMode ? ' · форма потери устойчивости увеличена' : ''
    ctx.fillText(`Перетаскивание — вращение, колесо — масштаб, клик — выбрать модуль${modeText}`, 12, 20)
    ctx.fillStyle = '#203243'
    ctx.font = '600 12px system-ui'
    ctx.fillText(`Выбран модуль ${this.selectedModuleIndex + 1} из ${model.moduleCount}`, 12, 40)
  }
}
