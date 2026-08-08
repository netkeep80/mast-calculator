function shortSha(value) {
  const text = String(value ?? '')
  return /^[0-9a-f]{7,40}$/i.test(text) ? text.slice(0, 8) : text || 'unknown'
}

function runtimeLabel(info) {
  const adapter = info.adapter === 'tauri' ? 'Desktop' : 'Web'
  const appVersion = info.appVersion ?? 'unknown'
  const coreVersion = info.coreVersion ?? appVersion
  const ref = info.ref && info.ref !== 'local' ? ` · ${info.ref}` : ''
  return `${adapter} · core ${coreVersion} · ${shortSha(info.sha)}${ref}`
}

function updateVersionLabel(info) {
  const version = document.querySelector('.app-version')
  if (!version) return
  const appVersion = info?.appVersion ?? 'unknown'
  version.textContent = `v${appVersion}`
  version.dataset.appVersion = appVersion
}

export async function initializeRuntimeInfo() {
  const header = document.querySelector('#runtime-info-slot, .page-header > div, .design-header > div')
  if (!header || document.querySelector('#runtime-build-info')) return null

  const line = document.createElement('p')
  line.id = 'runtime-build-info'
  line.className = 'hint runtime-build-info'
  line.textContent = 'Web · local build'
  header.append(line)
  updateVersionLabel(null)

  try {
    const response = await fetch('./build-info.json', { cache: 'no-store' })
    if (!response.ok) return line
    const info = await response.json()
    line.textContent = runtimeLabel(info)
    line.dataset.adapter = info.adapter ?? 'unknown'
    line.dataset.appVersion = info.appVersion ?? 'unknown'
    line.dataset.coreVersion = info.coreVersion ?? 'unknown'
    line.dataset.sha = info.sha ?? 'unknown'
    updateVersionLabel(info)
    return line
  } catch {
    return line
  }
}
