function shortSha(value) {
  const text = String(value ?? '')
  return /^[0-9a-f]{7,40}$/i.test(text) ? text.slice(0, 8) : text || 'unknown'
}

function runtimeLabel(info) {
  const adapter = info.adapter === 'tauri' ? 'Desktop' : 'Web'
  const appVersion = info.appVersion ?? 'unknown'
  const coreVersion = info.coreVersion ?? appVersion
  const ref = info.ref && info.ref !== 'local' ? ` · ${info.ref}` : ''
  return `${adapter} v${appVersion} · core ${coreVersion} · ${shortSha(info.sha)}${ref}`
}

export async function initializeRuntimeInfo() {
  const header = document.querySelector('.page-header > div, .design-header > div')
  if (!header || document.querySelector('#runtime-build-info')) return null

  const line = document.createElement('p')
  line.id = 'runtime-build-info'
  line.className = 'hint runtime-build-info'
  line.textContent = 'Версия сборки: local'
  header.append(line)

  try {
    const response = await fetch('./build-info.json', { cache: 'no-store' })
    if (!response.ok) return line
    const info = await response.json()
    line.textContent = runtimeLabel(info)
    line.dataset.adapter = info.adapter ?? 'unknown'
    line.dataset.appVersion = info.appVersion ?? 'unknown'
    line.dataset.coreVersion = info.coreVersion ?? 'unknown'
    line.dataset.sha = info.sha ?? 'unknown'
    return line
  } catch {
    return line
  }
}
