import {
  createProjectPackage,
  parseProjectPackage,
  serializeProjectPackage,
} from '../../packages/application/index.js'
import { fileAdapter as defaultFileAdapter } from './file-adapter.js'
import {
  applyProjectInputToForm,
  readProjectInputFromForm,
} from './project-form-dom.js'
import { initializeRuntimeInfo } from './runtime-info.js'

void initializeRuntimeInfo()

function safeFilename(value) {
  const normalized = String(value ?? 'mast-project')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'mast-project'
}

function dispatchFormSynchronization(form) {
  for (const name of [
    'windPresetId',
    'windEnvelopeEnabled',
    'stockBarLengthMm',
    'stockBarPieces',
    'reinforcementClass',
    'jointConfiguratorMode',
    'jointBoltDiameterMm',
  ]) {
    form.elements.namedItem(name)?.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

export function initializeProjectPackageUi(form, fileAdapter = defaultFileAdapter) {
  const exportRow = document.querySelector('.export-row')
  if (!exportRow || !form || !fileAdapter) return null

  let retainedMetadata = undefined
  let retainedGuys = undefined

  const downloadButton = document.createElement('button')
  downloadButton.type = 'button'
  downloadButton.id = 'export-project-package-button'
  downloadButton.className = 'secondary'
  downloadButton.textContent = 'Сохранить проект JSON'
  downloadButton.title = 'Versioned project/v1: только пользовательские исходные данные'

  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.id = 'open-project-package-button'
  openButton.className = 'secondary'
  openButton.textContent = 'Открыть проект JSON'

  const status = document.createElement('p')
  status.id = 'project-package-status'
  status.className = 'hint practical-note'
  status.hidden = true

  downloadButton.addEventListener('click', async () => {
    try {
      const project = readProjectInputFromForm(form)
      const packageValue = createProjectPackage(project, {
        ...(retainedMetadata === undefined ? {} : { metadata: retainedMetadata }),
        ...(retainedGuys === undefined ? {} : { guys: retainedGuys }),
      })
      const filename = `${safeFilename(packageValue.metadata?.name)}.project.json`
      const saved = await fileAdapter.saveText({
        suggestedName: filename,
        content: serializeProjectPackage(packageValue),
        mediaType: 'application/json;charset=utf-8',
        extensions: ['json'],
      })
      if (!saved) return
      status.textContent = `Сохранён ${packageValue.schema}${saved.path ? `: ${saved.path}` : ''}${packageValue.guys ? '; вместе с конфигурацией растяжек' : ''}.`
      status.hidden = false
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.hidden = false
    }
  })

  openButton.addEventListener('click', async () => {
    try {
      const opened = await fileAdapter.openText({ accept: 'application/json,.json', extensions: ['json'] })
      if (!opened) return
      const packageValue = parseProjectPackage(opened.text)
      retainedMetadata = packageValue.metadata
      retainedGuys = packageValue.guys
      applyProjectInputToForm(form, packageValue.project)
      dispatchFormSynchronization(form)
      status.textContent = `Открыт ${packageValue.schema}${opened.path ? `: ${opened.path}` : ''}${packageValue.guys ? '; параметры растяжек сохранены в пакете' : ''}. Нажмите «Проверить конкретную мачту» для перерасчёта.`
      status.hidden = false
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.hidden = false
    }
  })

  exportRow.append(downloadButton, openButton)
  exportRow.after(status)

  return Object.freeze({
    get retainedMetadata() { return retainedMetadata },
    get retainedGuys() { return retainedGuys },
  })
}
