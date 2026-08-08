import type { ApplicationAbortSignal } from './contracts.js'
import { MastApplicationError } from './errors.js'

export interface ApplicationCancellationController {
  readonly signal: ApplicationAbortSignal
  abort(reason?: unknown): void
}

export function createApplicationCancellationController(): ApplicationCancellationController {
  let aborted = false
  let reason: unknown = undefined
  const signal: ApplicationAbortSignal = Object.freeze({
    get aborted() {
      return aborted
    },
    get reason() {
      return reason
    },
  })
  return Object.freeze({
    signal,
    abort(value?: unknown) {
      if (aborted) return
      aborted = true
      reason = value
    },
  })
}

export function throwIfApplicationAborted(signal?: ApplicationAbortSignal): void {
  if (!signal?.aborted) return
  const reason = signal.reason
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string' && reason.trim()
      ? reason
      : 'Расчёт отменён'
  throw new MastApplicationError(
    'cancelled',
    'operation-cancelled',
    message,
    reason === undefined ? {} : { reason: String(reason) },
  )
}
