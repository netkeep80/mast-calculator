import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCompleteMast } from '../packages/application/index.js'
import { resolvedProject } from './helpers/resolved-project.js'

test('40 modules, 12 m / 20 cuts, Ø16 A500C do not collapse limits to 1 module / 1 kg', { timeout: 30_000 }, () => {
  const result = calculateCompleteMast(resolvedProject({
    moduleCount: 40,
    stockBarLengthMm: 12000,
    stockBarPieces: 20,
    barDiameterMm: 16,
    reinforcementClass: 'A500C',
    equipmentMassKg: 20,
  }))

  const currentHeightM = result.parameters.moduleCount * result.parameters.moduleHeightMm / 1000
  assert.ok(currentHeightM > 19)
  assert.equal(result.connections.passes, true)
  assert.ok(result.heightCapacity.design.maximumModules >= 10)
  assert.ok(result.heightCapacity.ultimateResistance.maximumModules >= 20)
  assert.ok(result.staticPayloadCapacity.purePayloadReference.boltLimitKg > 100)
  assert.ok(result.staticPayloadCapacity.maximumTopEquipmentMassKg > 100)
  assert.ok(result.lateralCapacity.boltLimitForceKgf > 10)
  assert.ok(result.lateralCapacity.criticalForceKgf > 10)
})
