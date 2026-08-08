export function createCalculationController({
  state,
  createWorker = () => new Worker('./calculation-worker.js', { type: 'module' }),
  now = () => performance.now(),
  onStart = () => {},
  onProgress = () => {},
  onResult = () => {},
  onError = () => {},
  onCancel = () => {},
} = {}) {
  if (!state) throw new Error('Calculation controller requires Web application state')

  let activeWorker = null
  let nextJobId = 0

  function stopTransport() {
    if (activeWorker) activeWorker.terminate()
    activeWorker = null
  }

  function cancel({ notify = true } = {}) {
    const activeJob = state.snapshot.activeJob
    if (!activeJob) {
      stopTransport()
      return false
    }
    stopTransport()
    state.cancelJob(activeJob.jobId)
    if (notify) onCancel(activeJob)
    return true
  }

  function start(action, projectInput) {
    if (state.snapshot.activeJob || activeWorker) cancel({ notify: false })

    const jobId = ++nextJobId
    const worker = createWorker()
    activeWorker = worker
    state.beginJob({ jobId, action, projectInput, startedAt: now() })
    onStart(state.snapshot.activeJob)

    worker.onmessage = (event) => {
      const message = event.data ?? {}
      if (message.jobId !== jobId || worker !== activeWorker) return

      if (message.type === 'progress') {
        if (state.updateProgress(jobId, message.progress)) onProgress(state.snapshot.progress, state.snapshot.activeJob)
        return
      }

      if (message.type === 'error') {
        const activeJob = state.snapshot.activeJob
        if (!state.failJob(jobId)) return
        stopTransport()
        onError(message.message ?? 'Неизвестная ошибка worker', activeJob)
        return
      }

      if (message.type === 'result') {
        const activeJob = state.snapshot.activeJob
        const completed = state.completeJob(jobId, {
          projectInput: message.projectInput,
          result: message.result,
          optimization: message.optimization,
        })
        if (!completed) return
        stopTransport()
        onResult(state.snapshot, activeJob)
      }
    }

    worker.onerror = (event) => {
      if (worker !== activeWorker) return
      const activeJob = state.snapshot.activeJob
      if (!state.failJob(jobId)) return
      stopTransport()
      onError(event.message || 'Ошибка Web Worker', activeJob)
    }

    worker.postMessage({ jobId, action, parameters: projectInput })
    return jobId
  }

  return Object.freeze({
    start,
    cancel,
    get active() {
      return Boolean(activeWorker && state.snapshot.activeJob)
    },
  })
}
