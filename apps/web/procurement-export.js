import { createProcurementEstimateFromCalculation } from '../../packages/application/index.js'
import { createProcurementEstimateHtml } from '../../packages/design/index.js'
import { fileAdapter } from './file-adapter.js'
import { subscribeCalculationResult } from './result-channel.js'

export function initializeProcurementExport() {
  const exportRow = document.querySelector('.export-row')
  if (!exportRow || document.querySelector('#export-procurement-button')) return null

  let currentResult = null
  const button = document.createElement('button')
  button.id = 'export-procurement-button'
  button.type = 'button'
  button.className = 'secondary'
  button.disabled = true
  button.textContent = 'Сохранить закупочную смету'

  const unsubscribe = subscribeCalculationResult(({ result }) => {
    currentResult = result ?? null
    button.disabled = currentResult == null
  })

  button.addEventListener('click', async () => {
    if (!currentResult) return
    try {
      const estimate = createProcurementEstimateFromCalculation(currentResult)
      const html = createProcurementEstimateHtml(estimate, new Date().toISOString())
      await fileAdapter.saveText({
        suggestedName: `mast-${currentResult.parameters.moduleCount}-procurement.html`,
        content: html,
        mediaType: 'text/html;charset=utf-8',
        extensions: ['html'],
      })
    } catch (error) {
      const errorBox = document.querySelector('#error')
      if (errorBox) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        errorBox.hidden = false
      }
    }
  })

  exportRow.append(button)
  return Object.freeze({ button, unsubscribe })
}
