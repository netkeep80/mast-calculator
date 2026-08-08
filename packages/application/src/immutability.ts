const isFreezableObject = (value: unknown): value is Record<PropertyKey, unknown> => (
  value != null
  && typeof value === 'object'
  && !ArrayBuffer.isView(value)
)

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isFreezableObject(value) || Object.isFrozen(value) || seen.has(value)) return value
  seen.add(value)
  for (const nested of Object.values(value)) deepFreeze(nested, seen)
  return Object.freeze(value)
}

export interface ImmutableResultOptions {
  readonly freezeResult?: boolean
}

export function immutablePublicResult<T>(value: T, options: ImmutableResultOptions = {}): T {
  return options.freezeResult === false ? value : deepFreeze(value)
}
