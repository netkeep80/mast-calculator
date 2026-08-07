import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, resolveCalculationParameters } from '../packages/application/index.js'
import { generateMastModel } from '../packages/structural-analysis/index.js'

const memberLength = (model, member) => {
  const a = model.nodes[member.nodeA].position
  const b = model.nodes[member.nodeB].position
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

test('геометрия содержит три узла на уровень и ровно девять рёбер на каждый физический модуль', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 4 })
  assert.equal(model.nodes.length, 15)
  assert.equal(model.members.length, 36)
  assert.equal(model.modules.length, 4)
  assert.ok(model.modules.every((module) => module.memberIds.length === 9))
  assert.deepEqual(model.baseNodeIds, [0, 1, 2])
  assert.deepEqual(model.topNodeIds, [12, 13, 14])
})

test('каждый узел frame-модели имеет шесть степеней свободы и только фундамент заделан', () => {
  const model = generateMastModel(DEFAULT_PARAMETERS)
  assert.ok(model.nodes.every((node) => node.restrained.length === 6))
  assert.ok(model.nodes.slice(0, 3).every((node) => node.restrained.every(Boolean)))
  assert.ok(model.nodes.slice(3).every((node) => node.restrained.every((value) => value === false)))
})

test('один модуль является правильным октаэдром: все девять рёбер равны', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 1,
    stockBarLengthMm: 12000,
    stockBarPieces: 16,
  })
  const model = generateMastModel(parameters)
  assert.equal(model.members.length, 9)
  for (const member of model.members) {
    assert.ok(
      Math.abs(memberLength(model, member) - parameters.ribCutLengthMm / 1000) < 1e-12,
      `ребро ${member.id} имеет неверную длину ${memberLength(model, member)}`,
    )
  }
})

test('модуль ориентирован ножками вниз: горизонтальный треугольник принадлежит его верхней грани', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 2 })
  const first = model.modules[0]
  const second = model.modules[1]

  const firstRing = first.memberIds.slice(0, 3).map((id) => model.members[id])
  assert.ok(firstRing.every((member) => member.role === 'top-ring'))
  assert.ok(firstRing.every((member) => member.nodeA >= 3 && member.nodeA <= 5))
  assert.ok(firstRing.every((member) => member.nodeB >= 3 && member.nodeB <= 5))

  const firstLegs = first.memberIds.slice(3).map((id) => model.members[id])
  assert.ok(firstLegs.every((member) => member.role === 'leg'))
  assert.ok(firstLegs.every((member) => member.nodeA <= 2 && member.nodeB >= 3 && member.nodeB <= 5))

  const secondRing = second.memberIds.slice(0, 3).map((id) => model.members[id])
  assert.ok(secondRing.every((member) => member.nodeA >= 6 && member.nodeB >= 6))
})

test('верхний треугольник последнего модуля существует естественно без closeTopRing', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 3, closeTopRing: false })
  const topSet = new Set(model.topNodeIds)
  const topRing = model.members.filter((member) => (
    topSet.has(member.nodeA) && topSet.has(member.nodeB)
  ))
  assert.equal(topRing.length, 3)
  assert.ok(topRing.every((member) => member.moduleIndex === 2 && member.role === 'top-ring'))
})

test('высота между соседними треугольными уровнями равна a·sqrt(2/3)', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    stockBarLengthMm: 11800,
    stockBarPieces: 12,
  })
  const model = generateMastModel({ ...parameters, moduleCount: 2 })
  const expected = parameters.ribCutLengthMm / 1000 * Math.sqrt(2 / 3)
  assert.ok(Math.abs(model.nodes[3].position[2] - expected) < 1e-12)
  assert.ok(Math.abs(model.nodes[6].position[2] - 2 * expected) < 1e-12)
})

test('все девять рёбер каждого модуля имеют одинаковую длину', () => {
  const moduleCount = 6
  const parameters = resolveCalculationParameters({ ...DEFAULT_PARAMETERS, moduleCount })
  const model = generateMastModel(parameters)

  for (const module of model.modules) {
    const edges = module.memberIds.map((id) => model.members[id])
    assert.equal(edges.length, 9)
    for (const member of edges) {
      assert.ok(
        Math.abs(memberLength(model, member) - parameters.ribCutLengthMm / 1000) < 1e-12,
        `модуль ${module.number}, ребро ${member.id}: длина должна равняться a`,
      )
    }
  }
})

test('направление шести ножек чередуется вместе с поворотом уровней', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 2 })

  assert.deepEqual(
    model.modules[0].memberIds.slice(3).map((id) => {
      const { nodeA, nodeB } = model.members[id]
      return [nodeA, nodeB]
    }),
    [
      [0, 3], [0, 5],
      [1, 4], [1, 3],
      [2, 5], [2, 4],
    ],
  )

  assert.deepEqual(
    model.modules[1].memberIds.slice(3).map((id) => {
      const { nodeA, nodeB } = model.members[id]
      return [nodeA, nodeB]
    }),
    [
      [3, 6], [3, 7],
      [4, 7], [4, 8],
      [5, 8], [5, 6],
    ],
  )
})

test('поворот уровней не меняет радиус треугольной грани', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 3 })
  const radii = model.nodes.map((node) => Math.hypot(node.position[0], node.position[1]))
  const reference = radii[0]
  assert.ok(radii.every((radius) => Math.abs(radius - reference) < 1e-12))
})
