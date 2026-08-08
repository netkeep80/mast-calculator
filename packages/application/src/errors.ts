import { ProjectSchemaError } from '../../domain/index.js'
import type { ApplicationErrorCategory } from './contracts.js'

export const APPLICATION_ERROR_CATEGORIES = Object.freeze([
  'input-validation',
  'unsupported-configuration',
  'numerical-failure',
  'convergence-failure',
  'schema-error',
  'cancelled',
  'internal-invariant',
] as const satisfies readonly ApplicationErrorCategory[])

export class MastApplicationError extends Error {
  readonly category: ApplicationErrorCategory
  readonly code: string
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    category: ApplicationErrorCategory,
    code: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options)
    if (!(APPLICATION_ERROR_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error(`Неизвестная категория application error: ${category}`)
    }
    this.name = 'MastApplicationError'
    this.category = category
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

export interface ApplicationErrorFallback {
  readonly category?: ApplicationErrorCategory
  readonly code?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export function toApplicationError(
  error: unknown,
  fallback: ApplicationErrorFallback = {},
): MastApplicationError {
  if (error instanceof MastApplicationError) return error
  if (error instanceof ProjectSchemaError) {
    return new MastApplicationError(
      'input-validation',
      error.code ?? 'invalid-project-input',
      error.message,
      error.details ?? {},
      { cause: error },
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  let category: ApplicationErrorCategory = fallback.category ?? 'internal-invariant'
  if (/вырожден|singular|factor|pivot|матриц|численн/.test(lower)) category = 'numerical-failure'
  else if (/сход|converg|итерац/.test(lower)) category = 'convergence-failure'
  else if (/неподдерж|unknown|неизвестн/.test(lower)) category = 'unsupported-configuration'
  return new MastApplicationError(
    category,
    fallback.code ?? 'application-failure',
    message,
    fallback.details ?? {},
    error instanceof Error ? { cause: error } : {},
  )
}
