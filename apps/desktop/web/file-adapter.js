function tauriInvoke() {
  const invoke = globalThis.__TAURI__?.core?.invoke
  if (typeof invoke !== 'function') throw new Error('Tauri IPC недоступен в Desktop WebView')
  return invoke
}

/** Desktop environment adapter. This file overlays apps/web/file-adapter.js in the desktop build tree. */
export const fileAdapter = Object.freeze({
  environment: 'tauri',
  async saveText({ suggestedName, content, mediaType = 'text/plain;charset=utf-8', extensions = [] }) {
    return tauriInvoke()('save_text_file', {
      suggestedName,
      content,
      mediaType,
      extensions,
    })
  },
  async openText({ extensions = ['json'] } = {}) {
    return tauriInvoke()('open_text_file', { extensions })
  },
})
