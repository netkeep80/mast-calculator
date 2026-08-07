import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { generateMastModel } from '../site/engine/geometry.js'

const memberLength = (model, member) => {
  const a = model.nodes[member.nodeA].position
  const b = model.nodes[member.nodeB].position
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

test('геометрия содержит три узла на уровень и девять стержней на модуль', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 4, closeTopRing: true })
  assert.equal(model.nodes.length, 15)
  assert.equal(model.members.length, 39)
  assert.deepEqual(model.topNodeIds, [12, 13, 14])
})

test('три нижних узла полностью закреплены', () => {
  const model = generateMastModel(DEFAULT_PARAMETERS)
  assert.ok(model.nodes.slice(0, 3).every((node) => node.restrained.every(Boolean)))
})

test('все шесть диагоналей каждого модуля имеют одинаковую длину', () => {
  const moduleCount = 6
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount, closeTopRing: false })

  for (let module = 0; module < moduleCount; module += 1) {
    const diagonals = model.members.slice(module * 9 + 3, module * 9 + 9)
    assert.equal(diagonals.length, 6)

    const lengths = diagonals.map((member) => memberLength(model, member))
    const reference = lengths[0]
    for (const length of lengths) {
      assert.ok(
        Math.abs(length - reference) < 1e-12,
        `модуль ${module + 1}: диагонали должны быть равны, получено ${length} и ${reference}`,
      )
    }
  }
})

test('направление второй диагонали чередуется вместе с поворотом уровней', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 2, closeTopRing: false })

  // Модуль 1: уровень 0 -> 1 (+60°), ближайшая соседняя вершина имеет corner - 1.
  assert.deepEqual(
    model.members.slice(3, 9).map(({ nodeA, nodeB }) => [nodeA, nodeB]),
    [
      [0, 3], [0, 5],
      [1, 4], [1, 3],
      [2, 5], [2, 4],
    ],
  )

  // Модуль 2: уровень 1 -> 2 (-60°), направление должно зеркально поменяться.
  assert.deepEqual(
    model.members.slice(12, 18).map(({ nodeA, nodeB }) => [nodeA, nodeB]),
    [
      [3, 6], [3, 7],
      [4, 7], [4, 8],
      [5, 8], [5, 6],
    ],
  )
})
