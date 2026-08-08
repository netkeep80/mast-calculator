import './guy-result-panel.js'
import { getGuyEditor } from './guy-editor.js'

export function currentProjectGuys() {
  return getGuyEditor()?.read() ?? null
}
