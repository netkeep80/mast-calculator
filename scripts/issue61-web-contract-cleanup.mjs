import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const write = (file, content) => fs.writeFileSync(file, content)
const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`Missing ${label}`)
  return source.replace(from, to)
}

{
  const file = 'apps/web/index.html'
  let source = read(file)
  source = replaceRequired(
    source,
    '<summary>Уточнить ветер и дополнительные нагрузки</summary>',
    '<summary>Уточнить ветер и параметры среды</summary>',
    'environment details title',
  )
  source = replaceRequired(
    source,
    '            <label>Доп. горизонтальная сила (уже как сила), Н<input name="extraHorizontalLoadN" type="number" min="0" step="10"></label>\n',
    '',
    'extra horizontal user control',
  )
  source = replaceRequired(
    source,
    '            <label>Доп. вертикальная сила вниз (уже как сила), Н<input name="extraVerticalLoadN" type="number" min="0" step="10"></label>\n',
    '',
    'extra vertical user control',
  )
  source = replaceRequired(
    source,
    '          <p class="hint practical-note"><strong>Не задавайте одну и ту же нагрузку дважды.</strong> «Масса оборудования» — физическая масса: программа переводит её в расчётный вес по формуле m·g·γ оборудования. «Доп. вертикальная сила» — уже готовая сила в ньютонах, например натяжение или иное внешнее усилие; коэффициент веса оборудования к ней повторно не применяется.</p>\n',
    '',
    'legacy duplicate load hint',
  )
  source = replaceRequired(
    source,
    '            <label>Rm металла детали узла, МПа<input name="jointBaseMetalTensileStrengthMPa" type="number" min="100" step="10"></label>\n',
    '',
    'internal base metal strength user control',
  )
  write(file, source)
}

{
  const file = 'apps/web/usage-scenarios.js'
  let source = read(file)
  source = replaceRequired(
    source,
    `function removeLegacyForceControl(name) {\n  const element = form?.elements.namedItem(name)\n  element?.closest('label')?.remove()\n}\n\n`,
    '',
    'legacy force DOM remover',
  )
  source = replaceRequired(
    source,
    `function installIssue36Ui() {\n  removeLegacyForceControl('extraHorizontalLoadN')\n  removeLegacyForceControl('extraVerticalLoadN')\n\n`,
    'function installIssue36Ui() {\n',
    'legacy force remover calls',
  )
  source = replaceRequired(
    source,
    `  for (const details of document.querySelectorAll('details.input-details')) {\n    const summary = details.querySelector(':scope > summary')\n    if (summary?.textContent.includes('Уточнить ветер и дополнительные нагрузки')) {\n      summary.textContent = 'Уточнить ветер и параметры среды'\n      for (const note of details.querySelectorAll('.practical-note')) {\n        if (/не задавайте одну и ту же нагрузку дважды/i.test(note.textContent)) note.remove()\n      }\n    }\n  }\n\n`,
    '',
    'legacy issue36 DOM text migration',
  )
  write(file, source)
}

{
  const file = 'tests/static-load-simplification-issue36.test.js'
  let source = read(file)
  source = replaceRequired(
    source,
    "const completeSource = fs.readFileSync(new URL('../packages/application/src/complete-calculation.js', import.meta.url), 'utf8')\n",
    "const completeSource = fs.readFileSync(new URL('../packages/application/src/complete-calculation.js', import.meta.url), 'utf8')\nconst htmlSource = fs.readFileSync(new URL('../apps/web/index.html', import.meta.url), 'utf8')\n",
    'issue36 html fixture',
  )
  source = replaceRequired(
    source,
    `test('issue #36: браузерный сценарный слой удаляет две дополнительные силы, скрывает воду и показывает стрелу', () => {\n  assert.match(usageSource, /removeLegacyForceControl\\('extraHorizontalLoadN'\\)/)\n  assert.match(usageSource, /removeLegacyForceControl\\('extraVerticalLoadN'\\)/)\n  assert.match(usageSource, /metric-water-volume/)\n  assert.match(usageSource, /waterArticle\\.hidden = true/)\n  assert.doesNotMatch(usageSource, /equivalentWaterVolumeM3/)\n  assert.match(usageSource, /Горизонтальная стрела/)\n  assert.match(usageSource, /boomSelfMassEquivalentKg/)\n  assert.match(usageSource, /Сколько ещё можно добавить сверху/)\n})\n`,
    `test('issue #36: пользовательская форма физически не содержит legacy сил и по-прежнему показывает стрелу', () => {\n  assert.doesNotMatch(htmlSource, /name=["']extraHorizontalLoadN["']/)\n  assert.doesNotMatch(htmlSource, /name=["']extraVerticalLoadN["']/)\n  assert.doesNotMatch(usageSource, /removeLegacyForceControl/)\n  assert.match(usageSource, /metric-water-volume/)\n  assert.match(usageSource, /waterArticle\\.hidden = true/)\n  assert.doesNotMatch(usageSource, /equivalentWaterVolumeM3/)\n  assert.match(usageSource, /Горизонтальная стрела/)\n  assert.match(usageSource, /boomSelfMassEquivalentKg/)\n  assert.match(usageSource, /Сколько ещё можно добавить сверху/)\n})\n`,
    'issue36 legacy DOM assertion',
  )
  write(file, source)
}

console.log('Removed legacy/dead user controls and their runtime DOM migration.')
