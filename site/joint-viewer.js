const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function rotatePoint(point, yaw, pitch) {
  const [x, y, z] = point
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const x1 = x * cy - y * sy
  const y1 = x * sy + y * cy
  return [x1, y1 * cp - z * sp, y1 * sp + z * cp]
}

function hexagon(radius, z) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * Math.PI / 3
    return [radius * Math.cos(angle), radius * Math.sin(angle), z]
  })
}

function prismEdges(radius, z0, z1) {
  const bottom = hexagon(radius, z0)
  const top = hexagon(radius, z1)
  const edges = []
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6
    edges.push([bottom[index], bottom[next]])
    edges.push([top[index], top[next]])
    edges.push([bottom[index], top[index]])
  }
  return edges
}

export class JointViewer {
  constructor(canvas) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.configuration = null
    this.yaw = -0.55
    this.pitch = -0.35
    this.zoom = 1
    this.dragging = false
    this.lastPointer = null
    this.bindEvents()
    this.resizeObserver = new ResizeObserver(() => this.draw())
    this.resizeObserver.observe(canvas)
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true
      this.lastPointer = [event.clientX, event.clientY]
      this.canvas.setPointerCapture(event.pointerId)
    })
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging || !this.lastPointer) return
      const dx = event.clientX - this.lastPointer[0]
      const dy = event.clientY - this.lastPointer[1]
      this.lastPointer = [event.clientX, event.clientY]
      this.yaw += dx * 0.008
      this.pitch = clamp(this.pitch + dy * 0.008, -1.35, 1.35)
      this.draw()
    })
    const stop = () => { this.dragging = false; this.lastPointer = null }
    this.canvas.addEventListener('pointerup', stop)
    this.canvas.addEventListener('pointercancel', stop)
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * 0.001), 0.55, 2.2)
      this.draw()
    }, { passive: false })
  }

  setConfiguration(configuration) {
    this.configuration = configuration ?? null
    this.draw()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0)
    return { width: rect.width, height: rect.height }
  }

  project(point, width, height, scale, centerZ) {
    const rotated = rotatePoint([point[0], point[1], point[2] - centerZ], this.yaw, this.pitch)
    const perspective = 1 / Math.max(0.4, 1 + rotated[2] * 0.0022)
    return [
      width / 2 + rotated[0] * scale * perspective,
      height / 2 - rotated[1] * scale * perspective,
      rotated[2],
    ]
  }

  line(a, b, width, height, scale, centerZ, lineWidth = 2, dash = []) {
    const pa = this.project(a, width, height, scale, centerZ)
    const pb = this.project(b, width, height, scale, centerZ)
    this.context.save()
    this.context.lineWidth = lineWidth
    this.context.setLineDash(dash)
    this.context.beginPath()
    this.context.moveTo(pa[0], pa[1])
    this.context.lineTo(pb[0], pb[1])
    this.context.stroke()
    this.context.restore()
  }

  drawPrism(radius, z0, z1, width, height, scale, centerZ, lineWidth = 2) {
    for (const [a, b] of prismEdges(radius, z0, z1)) {
      this.line(a, b, width, height, scale, centerZ, lineWidth)
    }
  }

  drawRibs(z, count, radius, length, width, height, scale, centerZ) {
    for (let index = 0; index < count; index += 1) {
      const angle = index * 2 * Math.PI / count + (count === 2 ? Math.PI / 2 : Math.PI / 4)
      const start = [radius * Math.cos(angle), radius * Math.sin(angle), z]
      const end = [
        (radius + length) * Math.cos(angle),
        (radius + length) * Math.sin(angle),
        z + (index % 2 === 0 ? length * 0.3 : -length * 0.3),
      ]
      this.line(start, end, width, height, scale, centerZ, 4)
    }
  }

  label(text, point, width, height, scale, centerZ) {
    const projected = this.project(point, width, height, scale, centerZ)
    this.context.save()
    this.context.font = '700 12px system-ui, sans-serif'
    this.context.fillText(text, projected[0] + 6, projected[1] - 5)
    this.context.restore()
  }

  draw() {
    const { width, height } = this.resize()
    this.context.clearRect(0, 0, width, height)
    const configuration = this.configuration
    if (!configuration?.geometry) {
      this.context.fillStyle = '#687786'
      this.context.font = '14px system-ui, sans-serif'
      this.context.fillText('Выполните расчёт, чтобы увидеть соединительный узел.', 20, 30)
      return
    }

    const geometry = configuration.geometry
    const top = geometry.topCouplingNut
    const bottom = geometry.bottomClearanceNut
    const bolt = geometry.bolt
    const gap = 2
    const couplingZ0 = 0
    const couplingZ1 = top.lengthMm
    const clearanceZ0 = couplingZ1 + gap
    const clearanceZ1 = clearanceZ0 + bottom.heightMm
    const boltTop = clearanceZ1 + Math.max(8, bolt.diameterMm * 0.65)
    const totalHeight = boltTop
    const maxRadius = Math.max(top.acrossFlatsMm, bottom.acrossFlatsMm) / Math.sqrt(3)
    const scale = this.zoom * Math.min(width / Math.max(180, maxRadius * 6), height / Math.max(190, totalHeight * 2.2))
    const centerZ = totalHeight / 2

    this.context.strokeStyle = '#40586b'
    this.context.fillStyle = '#203243'
    this.drawPrism(top.acrossFlatsMm / Math.sqrt(3), couplingZ0, couplingZ1, width, height, scale, centerZ, 2.3)
    this.drawPrism(bottom.acrossFlatsMm / Math.sqrt(3), clearanceZ0, clearanceZ1, width, height, scale, centerZ, 2.3)

    this.context.strokeStyle = '#177d62'
    this.drawRibs(couplingZ1 * 0.55, 4, top.acrossFlatsMm / 2, Math.max(28, top.acrossFlatsMm), width, height, scale, centerZ)
    this.context.strokeStyle = '#a76118'
    this.drawRibs((clearanceZ0 + clearanceZ1) / 2, 2, bottom.acrossFlatsMm / 2, Math.max(28, bottom.acrossFlatsMm), width, height, scale, centerZ)

    this.context.strokeStyle = '#2c4052'
    const boltRadius = bolt.diameterMm / 2
    this.drawPrism(boltRadius, Math.max(couplingZ0, couplingZ1 - geometry.threadEngagementMm), boltTop, width, height, scale, centerZ, 2.8)
    this.context.strokeStyle = '#8b4b14'
    this.line(
      [boltRadius * 1.15, 0, couplingZ1 - geometry.threadEngagementMm],
      [boltRadius * 1.15, 0, couplingZ1],
      width,
      height,
      scale,
      centerZ,
      3.2,
    )

    this.context.fillStyle = '#203243'
    this.label(`Соединительная гайка M${top.threadDiameterMm} × ${top.lengthMm} мм · 4 ребра`, [maxRadius, 0, couplingZ1 * 0.35], width, height, scale, centerZ)
    this.label(`Проходная гайка M${bottom.threadDiameterMm} · 2 ребра`, [maxRadius, 0, clearanceZ1], width, height, scale, centerZ)
    this.label(`Болт M${bolt.diameterMm} × ${bolt.lengthMm} мм`, [-maxRadius, 0, boltTop], width, height, scale, centerZ)
    this.label(`Зацепление ${geometry.threadEngagementMm.toFixed(0)} мм ≈ ${geometry.engagedThreadTurns.toFixed(1)} витка`, [-maxRadius, 0, couplingZ1 - geometry.threadEngagementMm / 2], width, height, scale, centerZ)
  }
}
