import { buildJointVisualGeometry } from './engine/joint-visual-geometry.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const add3 = (a, b) => a.map((value, index) => value + b[index])
const scale3 = (v, k) => v.map((value) => value * k)

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

function polygonRadiusFromAcrossFlats(acrossFlatsMm, sides) {
  return Number(acrossFlatsMm) / (2 * Math.cos(Math.PI / sides))
}

function ringPoints(radius, z, sides, rotation = 0) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + index * 2 * Math.PI / sides
    return [radius * Math.cos(angle), radius * Math.sin(angle), z]
  })
}

function prismFaces(radius, z0, z1, sides, rotation = 0) {
  const bottom = ringPoints(radius, z0, sides, rotation)
  const top = ringPoints(radius, z1, sides, rotation)
  const faces = []
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    faces.push({ kind: 'side', index, points: [bottom[index], bottom[next], top[next], top[index]] })
  }
  faces.push({ kind: 'cap-bottom', index: sides, points: [...bottom].reverse() })
  faces.push({ kind: 'cap-top', index: sides + 1, points: top })
  return faces
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

export class JointViewer {
  constructor(canvas) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.configuration = null
    this.visualModel = null
    this.yaw = -0.62
    this.pitch = -0.42
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
      this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * 0.001), 0.55, 2.5)
      this.draw()
    }, { passive: false })
  }

  setConfiguration(configuration) {
    this.configuration = configuration ?? null
    try {
      this.visualModel = configuration?.geometry
        ? buildJointVisualGeometry(configuration)
        : null
    } catch {
      this.visualModel = null
    }
    this.draw()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
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
    return {
      x: width / 2 + rotated[0] * scale * perspective,
      y: height / 2 - rotated[1] * scale * perspective,
      depth: rotated[2],
    }
  }

  projectedPolygon(points, width, height, scale, centerZ) {
    return points.map((point) => this.project(point, width, height, scale, centerZ))
  }

  drawTexturedFace(face, width, height, scale, centerZ, palette) {
    const projected = this.projectedPolygon(face.points, width, height, scale, centerZ)
    const ctx = this.context
    const xs = projected.map((point) => point.x)
    const ys = projected.map((point) => point.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const shadeIndex = face.kind === 'side' ? face.index % 3 : face.kind === 'cap-top' ? 3 : 0
    const fill = palette[Math.min(shadeIndex, palette.length - 1)]

    ctx.save()
    ctx.beginPath()
    projected.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y))
    ctx.closePath()
    const gradient = ctx.createLinearGradient(minX, minY, maxX, maxY)
    gradient.addColorStop(0, fill)
    gradient.addColorStop(0.5, '#d6dde1')
    gradient.addColorStop(1, fill)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.clip()

    ctx.globalAlpha = 0.18
    ctx.strokeStyle = '#344650'
    ctx.lineWidth = 0.7
    const span = Math.max(maxX - minX, maxY - minY, 20)
    for (let offset = -span; offset < span * 2; offset += 7) {
      ctx.beginPath()
      ctx.moveTo(minX + offset, maxY + 3)
      ctx.lineTo(minX + offset + span, minY - 3)
      ctx.stroke()
    }
    ctx.globalAlpha = 0.12
    ctx.fillStyle = '#ffffff'
    for (let index = 0; index < 10; index += 1) {
      const x = minX + (maxX - minX) * ((index * 37 % 97) / 97)
      const y = minY + (maxY - minY) * ((index * 53 % 89) / 89)
      ctx.fillRect(x, y, 1.2, 1.2)
    }
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = '#344650'
    ctx.lineWidth = 1.1
    ctx.beginPath()
    projected.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y))
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
  }

  drawPrism(acrossFlatsMm, z0, z1, sides, width, height, scale, centerZ, palette, rotation = 0) {
    const radius = polygonRadiusFromAcrossFlats(acrossFlatsMm, sides)
    const faces = prismFaces(radius, z0, z1, sides, rotation)
      .map((face) => ({
        ...face,
        depth: average(face.points.map((point) => rotatePoint(
          [point[0], point[1], point[2] - centerZ],
          this.yaw,
          this.pitch,
        )[2])),
      }))
      .sort((a, b) => a.depth - b.depth)
    for (const face of faces) this.drawTexturedFace(face, width, height, scale, centerZ, palette)
  }

  drawLine3d(a, b, width, height, scale, centerZ, style = {}) {
    const pa = this.project(a, width, height, scale, centerZ)
    const pb = this.project(b, width, height, scale, centerZ)
    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = style.color ?? '#344650'
    ctx.lineWidth = style.lineWidth ?? 2
    ctx.lineCap = 'round'
    if (style.dash) ctx.setLineDash(style.dash)
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
    ctx.restore()
    return { pa, pb }
  }

  drawRebar(rib, width, height, scale, centerZ) {
    const baseWidth = clamp(rib.barDiameterMm * scale * 0.36, 4, 13)
    const color = rib.group === 'coupling' ? '#28785f' : '#b56b1e'
    this.drawLine3d(rib.weldStartPoint, rib.weldEndPoint, width, height, scale, centerZ, {
      color: '#d34835',
      lineWidth: baseWidth + 5,
    })
    const projected = this.drawLine3d(rib.startPoint, rib.endPoint, width, height, scale, centerZ, {
      color,
      lineWidth: baseWidth,
    })
    this.drawLine3d(rib.startPoint, rib.endPoint, width, height, scale, centerZ, {
      color: 'rgba(255,255,255,0.48)',
      lineWidth: Math.max(1, baseWidth * 0.22),
    })

    const dx = projected.pb.x - projected.pa.x
    const dy = projected.pb.y - projected.pa.y
    const length = Math.hypot(dx, dy)
    if (length > 12) {
      const nx = -dy / length
      const ny = dx / length
      const ctx = this.context
      ctx.save()
      ctx.strokeStyle = 'rgba(31,43,48,0.55)'
      ctx.lineWidth = 1
      for (let t = 0.18; t < 0.94; t += 0.11) {
        const x = projected.pa.x + dx * t
        const y = projected.pa.y + dy * t
        const hatch = Math.min(5, baseWidth * 0.65)
        ctx.beginPath()
        ctx.moveTo(x - nx * hatch, y - ny * hatch)
        ctx.lineTo(x + nx * hatch, y + ny * hatch)
        ctx.stroke()
      }
      ctx.restore()
    }

    const contact = this.project(rib.startPoint, width, height, scale, centerZ)
    const ctx = this.context
    ctx.save()
    ctx.fillStyle = '#f1b542'
    ctx.strokeStyle = '#7a2e24'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(contact.x, contact.y, 4.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  label(text, point, width, height, scale, centerZ, options = {}) {
    const projected = this.project(point, width, height, scale, centerZ)
    this.context.save()
    this.context.font = options.font ?? '700 11px system-ui, sans-serif'
    this.context.fillStyle = options.color ?? '#203243'
    this.context.textAlign = options.align ?? 'left'
    this.context.fillText(text, projected.x + (options.dx ?? 5), projected.y + (options.dy ?? -4))
    this.context.restore()
  }

  draw() {
    const { width, height } = this.resize()
    const ctx = this.context
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#f4f7f8'
    ctx.fillRect(0, 0, width, height)

    const visual = this.visualModel
    if (!visual) {
      ctx.fillStyle = '#687786'
      ctx.font = '14px system-ui, sans-serif'
      ctx.fillText('Выполните расчёт, чтобы увидеть соединительный узел.', 20, 30)
      return
    }

    const extent = Math.max(190, visual.maxAcrossFlatsMm * 6.2)
    const scale = this.zoom * Math.min(width / extent, height / Math.max(210, visual.totalHeightMm * 2.5))
    const centerZ = visual.totalHeightMm / 2
    const coupling = visual.couplingNut
    const clearance = visual.clearanceNut

    // Сначала дальние рёбра, затем металлические тела и ближние рёбра —
    // глубина не является CAD z-buffer, но порядок сохраняет читаемость.
    const ribsWithDepth = visual.ribs.map((rib) => ({
      rib,
      depth: rotatePoint(
        [rib.startPoint[0], rib.startPoint[1], rib.startPoint[2] - centerZ],
        this.yaw,
        this.pitch,
      )[2],
    })).sort((a, b) => a.depth - b.depth)
    const middle = Math.ceil(ribsWithDepth.length / 2)
    ribsWithDepth.slice(0, middle).forEach(({ rib }) => this.drawRebar(rib, width, height, scale, centerZ))

    this.drawPrism(
      coupling.acrossFlatsMm,
      visual.couplingZ0,
      visual.couplingZ1,
      6,
      width,
      height,
      scale,
      centerZ,
      ['#9da8ad', '#aeb8bc', '#8e9ba1', '#c1c9cc'],
      Math.PI / 6,
    )
    this.drawPrism(
      clearance.acrossFlatsMm,
      visual.clearanceZ0,
      visual.clearanceZ1,
      6,
      width,
      height,
      scale,
      centerZ,
      ['#a1aaae', '#b7bfc2', '#929da2', '#c7ced0'],
      Math.PI / 6,
    )

    const boltRadiusAcrossFlats = visual.bolt.diameterMm
    const shaftZ0 = Math.max(visual.couplingZ0, visual.couplingZ1 - visual.threadEngagementMm)
    const headHeight = visual.bolt.headHeightMm ?? Math.max(8, visual.bolt.diameterMm * 0.6)
    const headZ0 = visual.boltTop - headHeight
    this.drawPrism(
      boltRadiusAcrossFlats,
      shaftZ0,
      headZ0,
      12,
      width,
      height,
      scale,
      centerZ,
      ['#6e7e87', '#7f8f97', '#657780', '#9aa7ad'],
      Math.PI / 12,
    )
    this.drawPrism(
      visual.bolt.headAcrossFlatsMm ?? visual.bolt.diameterMm * 1.5,
      headZ0,
      visual.boltTop,
      6,
      width,
      height,
      scale,
      centerZ,
      ['#78878f', '#8d9aa0', '#6e7e86', '#a6b0b4'],
      Math.PI / 6,
    )

    ribsWithDepth.slice(middle).forEach(({ rib }) => this.drawRebar(rib, width, height, scale, centerZ))

    const maxRadius = visual.maxAcrossFlatsMm * 0.72
    this.label(
      `Длинная M${coupling.threadDiameterMm} × ${coupling.lengthMm} · 4 ребра`,
      [maxRadius, 0, visual.couplingZ1 * 0.48],
      width, height, scale, centerZ,
    )
    this.label(
      `Проходная M${clearance.threadDiameterMm} · 2 ребра`,
      [maxRadius, 0, visual.clearanceZ1],
      width, height, scale, centerZ,
    )
    this.label(
      `Болт M${visual.bolt.diameterMm} × ${visual.bolt.lengthMm}`,
      [-maxRadius, 0, visual.boltTop],
      width, height, scale, centerZ,
      { align: 'right', dx: -4 },
    )

    ctx.save()
    ctx.fillStyle = '#203243'
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`Диагональная ножка правильного октаэдра: ${visual.octahedronLegAngleToBoltDeg.toFixed(2)}° к оси болта`, 12, 20)
    ctx.fillText('● жёлтый — контакт с гранью · красный — зона углового шва', 12, 38)
    ctx.fillStyle = '#28785f'
    ctx.fillText('зелёный — 4 ребра длинной гайки', 12, height - 34)
    ctx.fillStyle = '#b56b1e'
    ctx.fillText('оранжевый — 2 ребра проходной гайки', 12, height - 18)
    ctx.restore()

    const representative = visual.ribs.find((rib) => rib.role === 'leg-up')
    if (representative) {
      const p = add3(representative.startPoint, scale3(representative.direction, representative.weldDisplayLengthMm * 0.7))
      this.label(
        `к грани ${representative.angleToFacePlaneDeg.toFixed(1)}°`,
        p,
        width, height, scale, centerZ,
        { color: '#7a2e24', font: '700 10px system-ui, sans-serif' },
      )
    }
  }
}
