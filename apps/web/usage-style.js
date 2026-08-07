import './procurement-ui.js'

const existing = document.querySelector('link[data-usage-scenarios-style]')
if (!existing) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = './usage.css'
  link.dataset.usageScenariosStyle = 'true'
  document.head.append(link)
}
