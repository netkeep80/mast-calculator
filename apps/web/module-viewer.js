const norm3 = (value) => Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
const sub3 = (left, right) => left.map((value, index) => value - right[index])
const add3 = (left, right) => left.map((value, index) => value + right[index])
const scale3 = (value, factor) => value.map((component) => component * factor)

const forceLabel = (value) => `${(norm3(value) / 1000).toFixed(2)} кН`
const momentLabel = (value) => `${norm3(value).toFixed(1)} Н·м`

function distance3(left, right) {
  return norm3(sub3(left, right))
}

export class ModuleViewer {
  constructor(canvas) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.result = null
    this.moduleIndex = 0
    this.yaw = -0.55
    this.pitch = 0.45
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
      this.zoom = Math.max(0.55, Math.min(2.6, this.zoom * Math.exp(-event.deltaY * 0.001)))
      this.draw()
    }, { passive: false })
    resize()
  }

  setResult(result) {
    this.result = result
    this.moduleIndex = Math.min(this.moduleIndex, Math.max(0, (result?.model?.moduleCount ?? 1) - 1))
    this.draw()
  }

  setModule(moduleIndex) {
    const count = this.result?.model?.moduleCount ?? 1
    this.moduleIndex = Math.max(0, Math.min(count - 1, Number(moduleIndex) || 0))
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

  drawArrow(origin, vector, color, scale, centerX, centerY, worldLength, label) {
    const magnitude = norm3(vector)
    if (magnitude < 1e-8) return
    const direction = scale3(vector, 1 / magnitude)
    const end3 = add3(origin, scale3(direction, worldLength))
    const start = this.project(origin, scale, centerX, centerY)
    const end = this.project(end3, scale, centerX, centerY)
    const dx = end.x - start.x
    const dy = end.y - start.y
    const screenLength = Math.hypot(dx, dy)
    if (screenLength < 1) return
    const ux = dx / screenLength
    const uy = dy / screenLength
    const head = 8
    const ctx = this.context
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - ux * head - uy * head * 0.55, end.y - uy * head + ux * head * 0.55)
    ctx.lineTo(end.x - ux * head + uy * head * 0.55, end.y - uy * head - ux * head * 0.55)
    ctx.closePath()
    ctx.fill()
    ctx.font = '11px system-ui'
    ctx.textAlign = 'left'
    ctx.fillText(label, end.x + 4, end.y - 4)
  }

  draw() {
    const ctx = this.context
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#f7f9fb'
    ctx.fillRect(0, 0, width, height)

    if (!this.result?.model?.modules?.length) {
      ctx.fillStyle = '#667583'
      ctx.textAlign = 'center'
      ctx.fillText('Нет выбранного модуля', width / 2, height / 2)
      return
    }

    const { model } = this.result
    const loadCase = this.result.envelope.governing
    const analysis = loadCase.analysis
    const module = model.modules[this.moduleIndex]
    const state = analysis.moduleResults?.[this.moduleIndex]
    if (!module || !state) {
      ctx.fillStyle = '#a21d2c'
      ctx.textAlign = 'center'
      ctx.fillText('Для модуля нет помодульного результата', width / 2, height / 2)
      return
    }

    const nodeIds = [...new Set([...module.bottomNodeIds, ...module.topNodeIds])]
    const baseZ = Math.min(...nodeIds.map((nodeId) => model.nodes[nodeId].position[2]))
    const localPositions = new Map(nodeIds.map((nodeId) => [
      nodeId,
      model.nodes[nodeId].position.map((value, axis) => axis === 2 ? value - baseZ : value),
    ]))
    const sideM = distance3(localPositions.get(module.topNodeIds[0]), localPositions.get(module.topNodeIds[1]))
    const moduleHeightM = Math.max(...[...localPositions.values()].map((point) => point[2]))
    const baseScale = Math.min(width * 0.62 / Math.max(sideM, 0.1), height * 0.55 / Math.max(moduleHeightM, 0.1))
    const scale = baseScale * this.zoom
    const centerX = width * 0.48
    const centerY = height * 0.72
    const projected = new Map(nodeIds.map((nodeId) => [
      nodeId,
      this.project(localPositions.get(nodeId), scale, centerX, centerY),
    ]))

    const memberItems = module.memberIds.map((memberId) => {
      const member = model.members[memberId]
      const a = projected.get(member.nodeA)
      const b = projected.get(member.nodeB)
      return { member, depth: (a.depth + b.depth) / 2 }
    }).sort((left, right) => left.depth - right.depth)

    ctx.lineCap = 'round'
    for (const { member } of memberItems) {
      const start = projected.get(member.nodeA)
      const end = projected.get(member.nodeB)
      const memberResult = analysis.memberResults[member.id]
      const utilization = Math.min(1, memberResult?.utilization ?? 0)
      const hue = Math.round((1 - utilization) * 120)
      ctx.strokeStyle = `hsl(${hue} 72% 38%)`
      ctx.lineWidth = member.role === 'top-ring' ? 3 : 2.4
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()

      const midX = (start.x + end.x) / 2
      const midY = (start.y + end.y) / 2
      ctx.fillStyle = '#243746'
      ctx.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace'
      ctx.textAlign = 'left'
      const n = (memberResult.axialForceN / 1000).toFixed(2)
      const v = (memberResult.maxShearN / 1000).toFixed(2)
      const m = memberResult.maxBendingNm.toFixed(1)
      ctx.fillText(`#${member.id} N=${n} V=${v} M=${m}`, midX + 4, midY - 3)
    }

    for (const nodeId of nodeIds) {
      const point = projected.get(nodeId)
      ctx.fillStyle = '#213443'
      ctx.beginPath()
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '11px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(`${nodeId}`, point.x, point.y - 7)
    }

    const arrowWorldLength = Math.max(sideM, moduleHeightM) * 0.28
    const structuralActions = state.topStructuralFromAbove ?? state.topAppliedFromAbove
    for (const action of structuralActions) {
      this.drawArrow(
        localPositions.get(action.nodeId),
        action.forceN,
        '#b2363f',
        scale,
        centerX,
        centerY,
        arrowWorldLength,
        `↑модули ${forceLabel(action.forceN)}; M ${momentLabel(action.momentNm)}`,
      )
    }
    for (const action of state.bottomReactionFromBelow) {
      this.drawArrow(
        localPositions.get(action.nodeId),
        action.forceN,
        '#246a9a',
        scale,
        centerX,
        centerY,
        arrowWorldLength,
        `осн. ${forceLabel(action.forceN)}; M ${momentLabel(action.momentNm)}`,
      )
    }

    const directActions = state.topDirectApplied ?? module.topNodeIds.map((nodeId) => ({
      nodeId,
      forceN: loadCase.loads.nodalLoads[nodeId] ?? [0, 0, 0],
      momentNm: loadCase.loads.nodalMoments?.[nodeId] ?? [0, 0, 0],
    }))
    for (const action of directActions) {
      if (norm3(action.forceN) < 1e-8) continue
      this.drawArrow(
        localPositions.get(action.nodeId),
        action.forceN,
        '#9a681f',
        scale,
        centerX,
        centerY,
        arrowWorldLength * 0.85,
        `внеш. ${forceLabel(action.forceN)}`,
      )
    }

    const topForce = forceLabel(state.topResultantFromAbove.forceN)
    const structuralForce = forceLabel(state.topStructuralResultantFromAbove?.forceN ?? [0, 0, 0])
    const directForce = forceLabel(state.topDirectResultant?.forceN ?? [0, 0, 0])
    const bottomForce = forceLabel(state.bottomResultantFromBelow.forceN)
    ctx.fillStyle = '#33495a'
    ctx.font = '12px system-ui'
    ctx.textAlign = 'left'
    ctx.fillText(`Модуль ${module.number} · нагрузка на верхнюю грань: ${topForce} (модули выше ${structuralForce}; внешняя ${directForce})`, 12, 20)
    ctx.fillText(`Реакция снизу: ${bottomForce} · критическое ребро #${state.criticalMemberId}; U=${state.maxUtilization.toFixed(3)}; вертикальный механизм: ${state.verticalFailureMode === 'local-member-buckling' ? 'потеря устойчивости' : 'разрыв'}`, 12, 38)
    ctx.fillStyle = '#b2363f'
    ctx.fillText('красный — воздействие вышестоящих модулей', 12, height - 34)
    ctx.fillStyle = '#246a9a'
    ctx.fillText('синий — реакция нижележащей части/фундамента', 12, height - 18)
    ctx.fillStyle = '#9a681f'
    ctx.fillText('коричневый — внешняя нагрузка непосредственно на верхней грани', Math.max(260, width * 0.5), height - 18)
  }
}
