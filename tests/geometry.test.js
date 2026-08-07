import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS, resolveCalculationParameters } from '../site/engine/calculate.js'
import { generateMastModel } from '../site/engine/geometry.js'

const memberLength = (model, member) => {
  const a = model.nodes[member.nodeA].position
  const b = model.nodes[member.nodeB].position
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

test('геометрия содержит три узла на уровень и девять рёбер на модуль', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 4, closeTopRing: true })
  assert.equal(model.nodes.length, 15)
  assert.equal(model.members.length, 39)
  assert.deepEqual(model.topNodeIds, [12, 13, 14])
})

test('каждый узел frame-модели имеет шесть степеней свободы', () => {
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
    closeTopRing: false,
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
  const parameters = resolveCalculationParameters({ ...DEFAULT_PARAMETERS, moduleCount, closeTopRing: false })
  const model = generateMastModel(parameters)

  for (let module = 0; module < moduleCount; module += 1) {
    const edges = model.members.slice(module * 9, module * 9 + 9)
    assert.equal(edges.length, 9)
    for (const member of edges) {
      assert.ok(
        Math.abs(memberLength(model, member) - parameters.ribCutLengthMm / 1000) < 1e-12,
        `модуль ${module + 1}, ребро ${member.id}: длина должна равняться a`,
      )
    }
  }
})

test('направление второй диагонали чередуется вместе с поворотом уровней', () => {
  const model = generateMastModel({ ...DEFAULT_PARAMETERS, moduleCount: 2, closeTopRing: false })

  assert.deepEqual(
    model.members.slice(3, 9).map(({ nodeA, nodeB }) => [nodeA, nodeB]),
    [
      [0, 3], [0, 5],
      [1, 4], [1, 3],
      [2, 5], [2, 4],
    ],
  )

  assert.deepEqual(
    model.members.slice(12, 18).map(({ nodeA, nodeB }) => [nodeA, nodeB]),
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
