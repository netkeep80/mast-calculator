const listeners = new Set()

export function subscribeCalculationResult(listener) {
  if (typeof listener !== 'function') throw new TypeError('Calculation result listener must be a function')
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishCalculationResult(snapshot) {
  for (const listener of [...listeners]) listener(snapshot)
}
