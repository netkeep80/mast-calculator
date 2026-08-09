import {
  createProjectPackage,
  parseProjectPackage,
  serializeProjectPackage,
} from '../../packages/application/index.js'
import { initializeErectionEditor } from './erection-editor.js'
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

export function initializeProjectPackageUi(
  form,
  fileAdapter = defaultFileAdapter,
  guyEditor = null,
  erectionEditor = null,
) {
  const actions = document.querySelector('#project-file-actions') ?? document.querySelector('.export-row')
  if (!actions || !form || !fileAdapter) return null
  const editableErection = erectionEditor ?? initializeErectionEditor(form)

  let retainedMetadata = undefined
  let retainedGuys = undefined
  let retainedErection = undefined

  const downloadButton = document.createElement('button')
  downloadButton.type = 'button'
  downloadButton.id = 'export-project-package-button'
  downloadButton.className = 'secondary'
  downloadButton.textContent = 'Сохранить'
  downloadButton.title = 'Сохранить project/v1: пользовательские исходные данные проекта'

  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.id = 'open-project-package-button'
  openButton.className = 'secondary'
  openButton.textContent = 'Открыть'
  openButton.title = 'Открыть project/v1 JSON'

  const status = document.createElement('p')
  status.id = 'project-package-status'
  status.className = 'hint practical-note project-package-status'
  status.hidden = true

  downloadButton.addEventListener('click', async () => {
    try {
      const project = readProjectInputFromForm(form)
      const editableGuys = guyEditor ? guyEditor.read() : retainedGuys
      const erection = editableErection ? editableErection.read() : retainedErection
      const packageValue = createProjectPackage(project, {
        ...(retainedMetadata === undefined ? {} : { metadata: retainedMetadata }),
        ...(editableGuys === undefined ? {} : { guys: editableGuys }),
        ...(erection === undefined ? {} : { erection }),
      })
      retainedGuys = packageValue.guys
      retainedErection = packageValue.erection
      const filename = `${safeFilename(packageValue.metadata?.name)}.project.json`
      const saved = await fileAdapter.saveText({
        suggestedName: filename,
        content: serializeProjectPackage(packageValue),
        mediaType: 'application/json;charset=utf-8',
        extensions: ['json'],
      })
      if (!saved) return
      const stageNotes = [
        packageValue.guys ? 'растяжки' : null,
        packageValue.erection?.mode === 'tilt-up' ? 'монтаж' : null,
      ].filter(Boolean)
      status.textContent = `Сохранён ${packageValue.schema}${saved.path ? `: ${saved.path}` : ''}${stageNotes.length ? `; конфигурации: ${stageNotes.join(', ')}` : ''}.`
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
      retainedErection = packageValue.erection
      applyProjectInputToForm(form, packageValue.project)
      dispatchFormSynchronization(form)
      guyEditor?.apply(packageValue.guys)
      editableErection?.apply(packageValue.erection)
      const stageNotes = [
        packageValue.guys ? 'растяжки загружены в редактор' : null,
        packageValue.erection?.mode === 'tilt-up' ? 'монтаж загружен в редактор' : null,
      ].filter(Boolean)
      status.textContent = `Открыт ${packageValue.schema}${opened.path ? `: ${opened.path}` : ''}${stageNotes.length ? `; ${stageNotes.join(', ')}` : ''}. Запустите расчёт для обновления результата.`
      status.hidden = false
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.hidden = false
    }
  })

  actions.append(openButton, downloadButton)
  const statusHost = document.querySelector('.workspace-project-pane') ?? actions.parentElement
  const projectCard = statusHost?.querySelector('.workspace-project-card')
  if (statusHost && projectCard) statusHost.insertBefore(status, projectCard)
  else actions.after(status)

  return Object.freeze({
    get retainedMetadata() { return retainedMetadata },
    get retainedGuys() { return retainedGuys },
    get retainedErection() { return retainedErection },
    erectionEditor: editableErection,
  })
}
