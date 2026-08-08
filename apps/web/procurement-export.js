import { initializeReportsExports } from './reports-exports.js'

function loadReportsStyles() {
  if (document.querySelector('link[data-reports-exports-styles]')) return Promise.resolve()
  const stylesheet = document.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = './reports-exports.css'
  stylesheet.dataset.reportsExportsStyles = 'true'
  return new Promise((resolve) => {
    stylesheet.addEventListener('load', resolve, { once: true })
    stylesheet.addEventListener('error', resolve, { once: true })
    document.head.append(stylesheet)
  })
}

/**
 * Transitional bootstrap name retained only until the Web UI 2.0 purge rewires app-bootstrap.
 * Procurement no longer owns a separate export button or result subscription.
 */
export async function initializeProcurementExport() {
  await loadReportsStyles()
  return initializeReportsExports()
}
