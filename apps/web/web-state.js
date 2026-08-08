const freeze = (value) => Object.freeze(value)

function initialSnapshot() {
  return freeze({
    projectInput: null,
    result: null,
    optimization: null,
    selectedModuleIndex: 0,
    activeJob: null,
    progress: null,
  })
}

export function createWebApplicationState() {
  let snapshot = initialSnapshot()

  const replace = (patch) => {
    snapshot = freeze({ ...snapshot, ...patch })
    return snapshot
  }

  return freeze({
    get snapshot() {
      return snapshot
    },

    beginJob({ jobId, action, projectInput, startedAt }) {
      return replace({
        activeJob: freeze({ jobId, action, projectInput, startedAt }),
        progress: null,
      })
    },

    updateProgress(jobId, progress) {
      if (snapshot.activeJob?.jobId !== jobId) return false
      replace({ progress: freeze({ ...progress }) })
      return true
    },

    completeJob(jobId, { result = null, optimization = null } = {}) {
      const activeJob = snapshot.activeJob
      if (!activeJob || activeJob.jobId !== jobId) return false
      const moduleCount = result?.model?.moduleCount ?? 0
      const selectedModuleIndex = moduleCount > 0
        ? Math.min(snapshot.selectedModuleIndex, moduleCount - 1)
        : 0
      replace({
        projectInput: activeJob.projectInput,
        result,
        optimization,
        selectedModuleIndex,
        activeJob: null,
        progress: null,
      })
      return true
    },

    cancelJob(jobId) {
      if (snapshot.activeJob?.jobId !== jobId) return false
      replace({ activeJob: null, progress: null })
      return true
    },

    failJob(jobId) {
      if (snapshot.activeJob?.jobId !== jobId) return false
      replace({ activeJob: null, progress: null })
      return true
    },

    selectModule(moduleIndex) {
      const moduleCount = snapshot.result?.model?.moduleCount ?? 0
      const selectedModuleIndex = moduleCount > 0
        ? Math.max(0, Math.min(moduleCount - 1, Math.floor(Number(moduleIndex) || 0)))
        : 0
      replace({ selectedModuleIndex })
      return selectedModuleIndex
    },

    reset() {
      snapshot = initialSnapshot()
      return snapshot
    },
  })
}
