import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PARAMETERS } from '../site/engine/calculate.js'
import { generateMastModel } from '../site/engine/geometry.js'

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
