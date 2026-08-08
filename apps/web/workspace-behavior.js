const $ = (selector, root = document) => root.querySelector(selector)

function observeAppBarHeight(appBar) {
  const root = document.documentElement
  const sync = () => {
    const height = Math.ceil(appBar.getBoundingClientRect().height)
    if (height > 0) root.style.setProperty('--app-bar-height', `${height}px`)
  }
  sync()
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(sync)
    observer.observe(appBar)
    return observer
  }
  globalThis.addEventListener?.('resize', sync, { passive: true })
  return null
}

function synchronizeResultPlaceholder() {
  const answer = $('#scenario-answer')
  const placeholder = $('#result-placeholder')
  if (!answer || !placeholder) return null
  const sync = () => {
    placeholder.hidden = !answer.hidden
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(answer, { attributes: true, attributeFilter: ['hidden'] })
  return observer
}

function installWorkspaceLinks() {
  $('[data-open-guys]')?.addEventListener('click', () => {
    const editor = $('#guy-input-details')
    if (editor instanceof HTMLDetailsElement) editor.open = true
  })

  const openReports = () => {
    queueMicrotask(() => $('#result-tab-reports')?.click())
  }
  $('[data-open-reports]')?.addEventListener('click', openReports)
  if (globalThis.location?.hash === '#reports') openReports()
}

export function initializeWorkspaceBehavior() {
  if (typeof document === 'undefined') return null
  const appBar = $('.app-bar')
  if (!appBar) return null
  const appBarObserver = observeAppBarHeight(appBar)
  const resultObserver = synchronizeResultPlaceholder()
  installWorkspaceLinks()
  return Object.freeze({ appBarObserver, resultObserver })
}
