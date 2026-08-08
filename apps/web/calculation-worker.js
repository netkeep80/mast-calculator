import {
  calculateProject,
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

function runCalculation(jobId, parameters) {
  const result = calculateProject(parameters, {
    onProgress: (progress) => postProgress(jobId, progress),
  })
  self.postMessage({ type: 'result', jobId, projectInput: parameters, result, optimization: null })
}

function runOptimization(jobId, parameters) {
  const output = optimizeAndCalculateProject(parameters, {
    onProgress: (progress) => postProgress(jobId, progress),
  })
  self.postMessage({
    type: 'result',
    jobId,
    projectInput: output.projectInput,
    result: output.result,
    optimization: output.optimization,
  })
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
