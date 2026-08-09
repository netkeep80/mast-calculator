import {
  calculateProjectStages,
  optimizeAndCalculateProject,
} from '../../packages/application/index.js'

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

function runCalculation(jobId, parameters, guys, erection) {
  const output = calculateProjectStages(parameters, guys, erection, {
    onProgress: (progress) => postProgress(jobId, progress),
  })
  self.postMessage({
    type: 'result',
    jobId,
    projectInput: parameters,
    projectGuys: guys ?? null,
    projectErection: erection ?? null,
    result: output.result,
    guyResult: output.guyedResult,
    erectionResult: output.erectionResult,
    optimization: null,
  })
}

function runOptimization(jobId, parameters, guys, erection) {
  if (guys?.tiers?.length) {
    throw new Error('Автоподбор единого диаметра пока не оптимизирует конфигурацию растяжек. Отключите растяжки или выполните обычный расчёт.')
  }
  if (erection?.mode === 'tilt-up') {
    throw new Error('Автоподбор единого диаметра пока не оптимизирует монтажную стадию. Отключите монтаж или выполните обычный расчёт.')
  }
  const output = optimizeAndCalculateProject(parameters, {
    onProgress: (progress) => postProgress(jobId, progress),
  })
  self.postMessage({
    type: 'result',
    jobId,
    projectInput: output.projectInput,
    projectGuys: null,
    projectErection: erection ?? null,
    result: output.result,
    guyResult: null,
    erectionResult: null,
    optimization: output.optimization,
  })
}

self.onmessage = (event) => {
  const { jobId, action, parameters, guys, erection } = event.data ?? {}
  try {
    if (action === 'calculate') {
      runCalculation(jobId, parameters, guys, erection)
      return
    }
    if (action === 'optimize') {
      runOptimization(jobId, parameters, guys, erection)
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
