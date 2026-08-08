import { initializeReportsExports } from './reports-exports.js'

/**
 * Transitional bootstrap name retained only until the Web UI 2.0 purge rewires app-bootstrap.
 * Procurement no longer owns a separate export button or result subscription.
 */
export function initializeProcurementExport() {
  return initializeReportsExports()
}
