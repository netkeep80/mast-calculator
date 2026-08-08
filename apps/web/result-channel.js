const listeners = new Set()
let latestSnapshot = null

export function subscribeCalculationResult(listener, { replay = false } = {}) {
  if (typeof listener !== 'function') throw new TypeError('Calculation result listener must be a function')
  listeners.add(listener)
  if (replay && latestSnapshot !== null) listener(latestSnapshot)
  return () => listeners.delete(listener)
}

export function publishCalculationResult(snapshot) {
  latestSnapshot = snapshot
  for (const listener of [...listeners]) listener(snapshot)
}
