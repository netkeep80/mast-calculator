const scenarioPanel = document.querySelector('.scenario-panel')

if (scenarioPanel && !scenarioPanel.querySelector('[data-design-workspace-link]')) {
  const paragraph = document.createElement('p')
  paragraph.className = 'hint practical-note'
  paragraph.dataset.designWorkspaceLink = 'true'

  const label = document.createElement('strong')
  label.textContent = '3D и конструкторская документация: '

  const link = document.createElement('a')
  link.href = './design.html'
  link.textContent = 'открыть последний расчёт, OBJ и комплект КД →'

  paragraph.append(label, link)
  scenarioPanel.append(paragraph)
}
