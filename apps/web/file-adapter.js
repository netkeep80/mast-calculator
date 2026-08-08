function triggerDownload(suggestedName, content, mediaType) {
  const blob = new Blob([content], { type: mediaType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = suggestedName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function chooseTextFile({ accept = '' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.hidden = true
    const finish = (value) => {
      input.remove()
      resolve(value)
    }
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return finish(null)
      try {
        finish({ name: file.name, text: await file.text() })
      } catch (error) {
        finish(Promise.reject(error))
      }
    }, { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    document.body.append(input)
    input.click()
  })
}

/** Browser-only environment adapter. Desktop build replaces this module at build output. */
export const fileAdapter = Object.freeze({
  environment: 'browser',
  async saveText({ suggestedName, content, mediaType = 'text/plain;charset=utf-8' }) {
    triggerDownload(suggestedName, content, mediaType)
    return { name: suggestedName, path: null }
  },
  async openText({ accept = '' } = {}) {
    return chooseTextFile({ accept })
  },
})
