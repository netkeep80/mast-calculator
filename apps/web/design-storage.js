import {
  buildDesignPackage,
  parseDesignPackage,
  serializeDesignPackage,
} from '../../packages/design/index.js'

export const DESIGN_PACKAGE_STORAGE_KEY = 'mast-calculator:last-design-package:v1'
const MAX_LOCAL_STORAGE_BYTES = 4_500_000

export function saveDesignPackage(value, storage = globalThis.localStorage) {
  const text = serializeDesignPackage(value)
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_LOCAL_STORAGE_BYTES) {
    throw new Error(`Пакет 3D/КД слишком велик для localStorage (${Math.round(bytes / 1024)} КиБ)`)
  }
  if (!storage?.setItem) throw new Error('localStorage недоступен')
  storage.setItem(DESIGN_PACKAGE_STORAGE_KEY, text)
  return { bytes, text }
}

export function saveDesignResult(result, metadata = {}, storage = globalThis.localStorage) {
  const designPackage = buildDesignPackage(result, metadata)
  return { designPackage, ...saveDesignPackage(designPackage, storage) }
}

export function loadDesignPackage(storage = globalThis.localStorage) {
  if (!storage?.getItem) return null
  const text = storage.getItem(DESIGN_PACKAGE_STORAGE_KEY)
  return text ? parseDesignPackage(text) : null
}
