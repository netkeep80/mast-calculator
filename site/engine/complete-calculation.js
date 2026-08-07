import {
  calculateMast,
  calculateMaximumHeight,
  HEIGHT_SEARCH_PROGRESS_STEPS,
  resolveCalculationParameters,
  windDirections,
} from './calculate.js'
import { generateMastModel } from './geometry.js'
import { calculateLateralCapacity, lateralDirections } from './lateral-capacity.js'
import { compileModuleStack } from './module-stack.js'
import { compileFrameSystem } from './solver.js'
import {
  calculateStaticPayloadCapacity,
  STATIC_PAYLOAD_PROGRESS_STEPS,
} from './static-payload-capacity.js'
import { buildVerificationPassport } from './verification.js'

function fixedSelectedJointParameters(result, requestedMode) {
  return {
    ...result.parameters,
    ...(result.connections?.resolvedParameters ?? {}),
    // После автоподбора физическое изделие становится конкретным. Все
    // предельные расчёты обязаны проверять именно его, а не увеличивать болт
    // по мере роста пробной нагрузки/высоты.
    jointConfiguratorMode: 'manual',
    requestedJointConfiguratorMode: requestedMode,
  }
}

export function calculateCompleteMastWithConfiguredJoint(inputParameters, options = {}) {
  const requested = resolveCalculationParameters(inputParameters)
  const requestedMode = requested.jointConfiguratorMode === 'manual' ? 'manual' : 'auto'
  const model = generateMastModel(requested)
  const directions = windDirections(requested)
  const lateral = lateralDirections(requested.lateralCapacityStepDeg)
  const total = 1 + directions.length + lateral.length
    + STATIC_PAYLOAD_PROGRESS_STEPS + HEIGHT_SEARCH_PROGRESS_STEPS

  options.onProgress?.({
    phase: 'compile',
    label: `Подготовка ${requested.moduleCount} модулей и конфигуратора узла`,
    completed: 0,
    total,
  })
  const frameSystem = compileFrameSystem(model, requested)
  const moduleStack = compileModuleStack(model, frameSystem.memberGeometry)

  const result = calculateMast(requested, {
    model,
    frameSystem,
    moduleStack,
    onProgress: (event) => options.onProgress?.({
      ...event,
      completed: event.completed,
      total,
    }),
  })

  const physicalJoint = fixedSelectedJointParameters(result, requestedMode)
  result.parameters = {
    ...physicalJoint,
    jointConfiguratorMode: requestedMode,
  }
  result.connections.requestedMode = requestedMode
  result.connections.capacityChecksUseFixedSelectedJoint = true

  const lateralOffset = 1 + directions.length
  result.lateralCapacity = calculateLateralCapacity(model, physicalJoint, {
    frameSystem,
    onProgress: (event) => options.onProgress?.({
      phase: 'lateral',
      label: `Боковая нагрузка: ${event.completed}/${event.total}, направление ${event.directionDeg.toFixed(0)}°`,
      completed: lateralOffset + event.completed,
      total,
    }),
  })

  const staticPayloadOffset = lateralOffset + lateral.length
  result.staticPayloadCapacity = calculateStaticPayloadCapacity(model, physicalJoint, {
    frameSystem,
    onProgress: (event) => options.onProgress?.({
      phase: 'static-payload',
      label: event.label,
      completed: staticPayloadOffset + event.completed,
      total,
    }),
  })

  const heightOffset = staticPayloadOffset + STATIC_PAYLOAD_PROGRESS_STEPS
  result.heightCapacity = calculateMaximumHeight(physicalJoint, {
    knownResult: result,
    onProgress: (event) => options.onProgress?.({
      phase: 'height-capacity',
      label: event.label,
      completed: heightOffset + event.completed,
      total,
    }),
  })
  result.heightCapacity.fixedJointConfiguration = {
    diameterMm: physicalJoint.jointBoltDiameterMm,
    boltClass: physicalJoint.jointBoltClass,
    boltLengthMm: physicalJoint.jointBoltLengthMm,
    clearanceNutThreadMm: physicalJoint.jointClearanceNutThreadMm,
    threadEngagementFactor: physicalJoint.jointThreadEngagementFactor,
  }

  result.verification = buildVerificationPassport(result)
  result.performance = {
    linearSystemSolver: frameSystem.method,
    modularStaticSolver: moduleStack?.method ?? null,
    modularInterfaceFactorizationCount: moduleStack?.interfaceFactorizationCount ?? 0,
    modularRelativeDisplacementDifference: result.analysis.modular?.relativeDisplacementDifference ?? null,
    modularInterfaceEquilibriumResidual: result.analysis.modular?.interfaceEquilibriumResidual ?? null,
    freeDofCount: frameSystem.freeDofs.length,
    stiffnessBandwidth: frameSystem.bandwidth,
    stiffnessFactorizationCount: frameSystem.factorizationCount,
    operationalCaseCount: directions.length,
    lateralCaseCount: lateral.length,
    staticPayloadEvaluationCount: STATIC_PAYLOAD_PROGRESS_STEPS,
    heightSearchEvaluationCount: result.heightCapacity.evaluationCount,
    verificationInternalCheckCount: result.verification.counts.internal,
    rotationalSymmetryDeg: 120,
    jointConfiguratorMode: requestedMode,
  }
  options.onProgress?.({
    phase: 'done',
    label: 'Расчёт, автоконфигурация узла, предельные проверки и верификация завершены',
    completed: total,
    total,
  })
  return result
}
