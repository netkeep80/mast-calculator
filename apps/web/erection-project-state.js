import './erection-result-panel.js'
import { getErectionEditor } from './erection-editor.js'

export function currentProjectErection() {
  return getErectionEditor()?.read() ?? null
}
