import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateMast,
  calculateMaximumHeight,
  DEFAULT_PARAMETERS,
  resolveCalculationParameters,
} from '../packages/application/index.js'
import { generateMastModel } from '../packages/structural-analysis/index.js'
import { buildLoadCase } from '../packages/structural-analysis/index.js'
import { compileModuleStack, solveModuleStack } from '../packages/structural-analysis/index.js'
import { analyzeFrame, compileFrameSystem } from '../packages/structural-analysis/index.js'

const norm = (vector) => Math.hypot(...vector)

function analysisVector(analysis) {
  return analysis.displacements.flatMap((value, nodeId) => [
    ...value,
    ...analysis.rotations[nodeId],
  ])
}

test('Schur-расчёт сверху вниз совпадает с глобальной banded FEM по всем 6 DOF', () => {
  const parameters = resolveCalculationParameters({
    ...DEFAULT_PARAMETERS,
    moduleCount: 4,
    windEnvelopeEnabled: false,
    windDirectionDeg: 37,
  })
  const model = generateMastModel(parameters)
  const frameSystem = compileFrameSystem(model, parameters)
  const stack = compileModuleStack(model, frameSystem.memberGeometry)
  const loads = buildLoadCase(model, parameters)
  const global = analyzeFrame(model, loads, parameters, frameSystem)
  const modular = solveModuleStack(model, stack, loads)
  const reference = analysisVector(global)
  const difference = modular.displacementVector.map((value, index) => value - reference[index])
  const relative = norm(difference) / Math.max(1e-12, norm(reference))

  assert.equal(stack.method, 'module-schur-top-down-v1')
  assert.equal(stack.interfaceFactorizationCount, 4)
  assert.ok(relative < 1e-8, `расхождение modular/global = ${relative}`)
  assert.ok(modular.interfaceEquilibriumResidual < 1e-8)
})

test('верхний модуль не получает нагрузку от несуществующего вышестоящего модуля', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 3,
    windEnvelopeEnabled: false,
    windPressurePa: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 0,
    extraVerticalLoadN: 0,
  })
  const modules = result.analysis.moduleResults
  const top = modules.at(-1)
  assert.ok(norm(top.topResultantFromAbove.forceN) < 1e-7)
  assert.ok(norm(top.topResultantFromAbove.momentNm) < 1e-7)
})

test('воздействие верхних модулей на нижние интерфейсы нарастает сверху вниз', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 4,
    windEnvelopeEnabled: false,
    windPressurePa: 0,
    equipmentMassKg: 0,
    equipmentWindAreaM2: 0,
    extraHorizontalLoadN: 0,
    extraVerticalLoadN: 0,
  })
  const modules = result.analysis.moduleResults
  const interfaceVertical = modules.map((module) => Math.abs(module.topResultantFromAbove.forceN[2]))
  assert.ok(interfaceVertical[0] > interfaceVertical[1])
  assert.ok(interfaceVertical[1] > interfaceVertical[2])
  assert.ok(interfaceVertical[2] > interfaceVertical[3] - 1e-8)
  assert.ok(interfaceVertical[3] < 1e-7)
})

test('calculateMast публикует модульный cross-check и по одному результату на физический модуль', () => {
  const result = calculateMast({
    ...DEFAULT_PARAMETERS,
    moduleCount: 5,
    windEnvelopeEnabled: false,
  })
  assert.equal(result.analysis.moduleResults.length, 5)
  assert.equal(result.analysis.modular.method, 'module-schur-top-down-v1')
  assert.ok(result.analysis.modular.relativeDisplacementDifference < 1e-8)
  assert.ok(result.analysis.modular.interfaceEquilibriumResidual < 1e-8)
  assert.ok(result.analysis.moduleResults.every((module) => module.memberIds.length === 9))
})

test('поиск максимальной высоты возвращает дискретный предел и механизм нижнего модуля', { timeout: 30_000 }, () => {
  const result = calculateMaximumHeight({
    ...DEFAULT_PARAMETERS,
    moduleCount: 3,
    heightSearchMaxModules: 12,
    windEnvelopeEnabled: false,
    windPressurePa: 150,
  })
  assert.equal(result.method, 'integer-module-height-search-v1')
  assert.ok(result.design.maximumModules >= 0)
  assert.ok(result.design.maximumModules <= 12)
  assert.ok(result.ultimateResistance.maximumModules >= result.design.maximumModules)
  assert.ok(result.evaluationCount > 0)
  if (result.bottomModuleAtDesignLimit) {
    assert.ok(['local-member-buckling', 'tensile-rupture'].includes(result.bottomModuleAtDesignLimit.mode))
    assert.ok(result.bottomModuleAtDesignLimit.reserveFactor > 0)
  }
})
