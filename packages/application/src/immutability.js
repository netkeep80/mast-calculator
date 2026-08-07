const isFreezableObject = (value) => (
  value != null
  && typeof value === 'object'
  && !ArrayBuffer.isView(value)
)

export function deepFreeze(value, seen = new WeakSet()) {
  if (!isFreezableObject(value) || Object.isFrozen(value) || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}

export function immutablePublicResult(value, options = {}) {
  return options.freezeResult === false ? value : deepFreeze(value)
}
