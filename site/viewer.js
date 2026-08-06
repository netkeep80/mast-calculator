export class MastViewer {
  constructor(canvas) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.result = null
    this.showBucklingMode = false
    this.yaw = -0.65
    this.pitch = 0.35
    this.zoom = 1
    this.dragging = false
    this.lastPointer = null

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
      this.lastPointer = [event.clientX, event.clientY]
      canvas.setPointerCapture(event.pointerId)
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging || !this.lastPointer) return
      this.yaw += (event.clientX - this.lastPointer[0]) * 0.01
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + (event.clientY - this.lastPointer[1]) * 0.01))
      this.lastPointer = [event.clientX, event.clientY]
      this.draw()
    })
    canvas.addEventListener('pointerup', () => {
      this.dragging = false
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
    this.draw()
  }

  setBucklingMode(enabled) {
    this.showBucklingMode = enabled
    this.draw()
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

  drawMembers(projectedNodes, strokeStyle, lineWidth, utilizationColors = false) {
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
      if (utilizationColors) {
        const utilization = Math.min(1, analysis.memberResults[item.member.id]?.utilization ?? 0)
        const hue = Math.round((1 - utilization) * 120)
        ctx.strokeStyle = `hsl(${hue} 72% 38%)`
      } else {
        ctx.strokeStyle = strokeStyle
      }
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
    }
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
      this.drawMembers(original, '#b5bec8', Math.max(1, 1.5 * this.zoom), false)
    }

    this.drawMembers(displayed, '#168565', Math.max(1.3, 2.3 * this.zoom), !this.showBucklingMode)

    for (const node of displayed) {
      ctx.fillStyle = this.showBucklingMode ? '#1d5f9a' : '#233342'
      ctx.beginPath()
      ctx.arc(node.x, node.y, Math.max(2, 3.2 * this.zoom), 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = '#657382'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'left'
    const modeText = this.showBucklingMode ? ' · форма потери устойчивости увеличена' : ''
    ctx.fillText(`Перетаскивание — вращение, колесо — масштаб${modeText}`, 12, 20)
  }
}
