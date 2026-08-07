import { calculateCompleteMastWithConfiguredJoint } from './engine/complete-calculation.js'
import { augmentVerificationWithModuleChecks } from './engine/module-verification.js'
import { selectUniformDiameter, STANDARD_DIAMETERS_MM } from './engine/optimize.js'

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0))

function postProgress(jobId, progress) {
  self.postMessage({
    type: 'progress',
    jobId,
    progress: {
      ...progress,
      fraction: clamp01(progress.fraction ?? progress.completed / Math.max(1, progress.total)),
    },
  })
}

function calculationProgress(jobId, progress, start = 0, span = 1, prefix = '') {
  const fraction = progress.completed / Math.max(1, progress.total)
  postProgress(jobId, {
    phase: progress.phase,
    label: prefix ? `${prefix}: ${progress.label}` : progress.label,
    fraction: start + span * fraction,
  })
}

function addModuleVerification(result) {
  result.verification = augmentVerificationWithModuleChecks(result.verification, result)
  if (result.performance) result.performance.verificationInternalCheckCount = result.verification.counts.internal
  return result
}

function summarizeOptimization(optimization) {
  return {
    recommendedDiameter: optimization.recommended?.diameter ?? null,
    evaluatedCount: optimization.evaluatedCount,
    availableCount: optimization.availableCount,
    variants: optimization.variants.map((variant) => ({
      diameter: variant.diameter,
      passesStrength: variant.passesStrength,
      passesDisplacement: variant.passesDisplacement,
      passesBuckling: variant.passesBuckling,
      utilization: variant.result.envelope.maxUtilization,
      displacementMm: variant.result.envelope.maxTopDisplacementM * 1000,
      bucklingFactor: variant.result.envelope.minimumBucklingFactor,
    })),
  }
}

function runCalculation(jobId, parameters) {
  const result = addModuleVerification(calculateCompleteMastWithConfiguredJoint(parameters, {
    onProgress: (progress) => calculationProgress(jobId, progress),
  }))
  self.postMessage({ type: 'result', jobId, result, optimization: null })
}

function runOptimization(jobId, parameters) {
  const optimizationShare = 0.78
  const automaticParameters = { ...parameters, jointConfiguratorMode: 'auto' }
  postProgress(jobId, {
    phase: 'optimize',
    label: `Подбор диаметра: до ${STANDARD_DIAMETERS_MM.length} стандартных вариантов`,
    fraction: 0,
  })
  const optimization = selectUniformDiameter(automaticParameters, STANDARD_DIAMETERS_MM, {
    stopAtFirstPassing: true,
    onProgress: (event) => {
      postProgress(jobId, {
        phase: 'optimize',
        label: `Подбор Ø${event.diameter} мм (${event.variantIndex + 1}/${event.variantCount}): ${event.inner.label}`,
        fraction: optimizationShare * event.fraction,
      })
    },
  })
  const summary = summarizeOptimization(optimization)
  if (!optimization.recommended) {
    postProgress(jobId, { phase: 'done', label: 'Подбор завершён: подходящий диаметр не найден', fraction: 1 })
    self.postMessage({ type: 'result', jobId, result: null, optimization: summary })
    return
  }

  const diameter = optimization.recommended.diameter
  postProgress(jobId, {
    phase: 'optimize',
    label: `Минимальный проходящий диаметр найден после ${optimization.evaluatedCount} вариантов: Ø${diameter} мм`,
    fraction: optimizationShare,
  })
  const result = addModuleVerification(calculateCompleteMastWithConfiguredJoint({
    ...automaticParameters,
    barDiameterMm: diameter,
  }, {
    onProgress: (progress) => calculationProgress(
      jobId,
      progress,
      optimizationShare,
      1 - optimizationShare,
      `Итоговый расчёт Ø${diameter} мм`,
    ),
  }))
  postProgress(jobId, { phase: 'done', label: `Подбор завершён: Ø${diameter} мм`, fraction: 1 })
  self.postMessage({ type: 'result', jobId, result, optimization: summary })
}

self.onmessage = (event) => {
  const { jobId, action, parameters } = event.data ?? {}
  try {
    if (action === 'calculate') {
      runCalculation(jobId, parameters)
      return
    }
    if (action === 'optimize') {
      runOptimization(jobId, parameters)
      return
    }
    throw new Error(`Неизвестная операция расчёта: ${action}`)
  } catch (error) {
    self.postMessage({
      type: 'error',
      jobId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
