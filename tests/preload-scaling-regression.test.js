import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateBoltCapacity, checkBoltDemand } from '../packages/engineering/index.js'

const approximately = (actual, expected, relative = 1e-9, absolute = 1e-9) => {
  const tolerance = Math.max(absolute, Math.abs(expected) * relative)
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}; tol=${tolerance}`)
}

const preloadOptions = Object.freeze({
  diameterMm: 24,
  boltClass: '8.8',
  tighteningTorqueNm: 200,
  nutFactor: 0.2,
  preloadVariation: 0.25,
})

test('fixed preload: pure external tension scales only the external demand', () => {
  const capacity = calculateBoltCapacity(preloadOptions)
  const unitTensionN = 1000
  const check = checkBoltDemand({ tensionN: unitTensionN, shearN: 0 }, preloadOptions)
  const expectedFactor = (capacity.tensionCapacityN - capacity.preload.maximumPreloadN) / unitTensionN
  approximately(check.loadFactorToDesignLimit, expectedFactor)
  assert.ok(Math.abs(check.loadFactorToDesignLimit - 1 / check.utilization) > 1)
  const atLimit = checkBoltDemand({
    tensionN: unitTensionN * check.loadFactorToDesignLimit,
    shearN: 0,
  }, preloadOptions)
  approximately(atLimit.utilization, 1)
})

test('fixed preload: combined external tension/shear reaches interaction ellipse at returned factor', () => {
  const check = checkBoltDemand({ tensionN: 900, shearN: 700 }, preloadOptions)
  assert.ok(Number.isFinite(check.loadFactorToDesignLimit))
  assert.ok(check.loadFactorToDesignLimit > 1)
  const atLimit = checkBoltDemand({
    tensionN: 900 * check.loadFactorToDesignLimit,
    shearN: 700 * check.loadFactorToDesignLimit,
  }, preloadOptions)
  approximately(atLimit.interactionUtilization, 1)
  approximately(atLimit.utilization, 1)
})

test('fixed preload: zero external demand has infinite scale when preload itself passes', () => {
  const check = checkBoltDemand({ tensionN: 0, shearN: 0 }, preloadOptions)
  assert.ok(check.preloadUtilization < 1)
  assert.equal(check.loadFactorToDesignLimit, Number.POSITIVE_INFINITY)
})
