import { ProjectSchemaError } from '../../domain/index.js'

export const APPLICATION_ERROR_CATEGORIES = Object.freeze([
  'input-validation',
  'unsupported-configuration',
  'numerical-failure',
  'convergence-failure',
  'schema-error',
  'internal-invariant',
])

export class MastApplicationError extends Error {
  constructor(category, code, message, details = {}, options = {}) {
    super(message, options)
    if (!APPLICATION_ERROR_CATEGORIES.includes(category)) {
      throw new Error(`Неизвестная категория application error: ${category}`)
    }
    this.name = 'MastApplicationError'
    this.category = category
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

export function toApplicationError(error, fallback = {}) {
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
  let category = fallback.category ?? 'internal-invariant'
  if (/вырожден|singular|factor|pivot|матриц|численн/.test(lower)) category = 'numerical-failure'
  else if (/сход|converg|итерац/.test(lower)) category = 'convergence-failure'
  else if (/неподдерж|unknown|неизвестн/.test(lower)) category = 'unsupported-configuration'
  return new MastApplicationError(
    category,
    fallback.code ?? 'application-failure',
    message,
    fallback.details ?? {},
    { cause: error instanceof Error ? error : undefined },
  )
}
