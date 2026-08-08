import {
  calculateProjectWithGuys,
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

function runCalculation(jobId, parameters, guys) {
  const output = calculateProjectWithGuys(parameters, guys, {
    onProgress: (progress) => postProgress(jobId, progress),
  })
  self.postMessage({
    type: 'result',
    jobId,
    projectInput: parameters,
    projectGuys: guys ?? null,
    result: output.result,
    guyResult: output.guyedResult,
    optimization: null,
  })
}

function runOptimization(jobId, parameters, guys) {
  if (guys?.tiers?.length) {
    throw new Error('Автоподбор единого диаметра пока не оптимизирует конфигурацию растяжек. Отключите растяжки или выполните обычный расчёт.')
  }
  const output = optimizeAndCalculateProject(parameters, {
    onProgress: (progress) => postProgress(jobId, progress),
  })
  self.postMessage({
    type: 'result',
    jobId,
    projectInput: output.projectInput,
    projectGuys: null,
    result: output.result,
    guyResult: null,
    optimization: output.optimization,
  })
}

self.onmessage = (event) => {
  const { jobId, action, parameters, guys } = event.data ?? {}
  try {
    if (action === 'calculate') {
      runCalculation(jobId, parameters, guys)
      return
    }
    if (action === 'optimize') {
      runOptimization(jobId, parameters, guys)
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
