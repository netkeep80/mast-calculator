import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PROJECT_INPUT,
  resolveProjectInput,
} from '../packages/domain/index.js'

/**
 * Physics #113: operational load factors are code-owned normative roles,
 * not one user scalar shared by steel self-weight and ice.
 */
test('operational project resolves distinct SP20 design-action factors', () => {
  const resolved = resolveProjectInput(DEFAULT_PROJECT_INPUT)

  assert.equal(resolved.steelSelfWeightLoadFactor, 1.05)
  assert.equal(resolved.equipmentLoadFactor, 1.05)
  assert.equal(resolved.iceLoadFactor, 1.8)
  assert.equal(resolved.windLoadFactor, 1.4)
  assert.equal('deadLoadFactor' in resolved, false)
})

test('canonical ProjectInput does not expose legacy operational reliability-factor knobs', () => {
  assert.equal('deadLoadFactor' in DEFAULT_PROJECT_INPUT.environment, false)
  assert.equal('loadFactor' in DEFAULT_PROJECT_INPUT.equipment, false)
})
