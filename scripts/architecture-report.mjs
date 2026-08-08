const PACKAGE_ORDER = Object.freeze([
  'domain',
  'numerics',
  'structural-analysis',
  'engineering',
  'design',
  'reporting',
  'application',
])

export function reportToMarkdown(report, violations = []) {
  const rows = report.modules.map((module) => (
    `| \`${module.path}\` | ${module.layer} | ${module.lines} | ${module.importers.length} | ${module.imports.filter((item) => item.relative).length} | ${module.exports.length} | ${[...module.environment.globals, ...module.environment.nodeImports].join(', ') || '—'} |`
  ))
  const cycleText = report.cycles.length
    ? report.cycles.map((cycle) => `- ${cycle.map((item) => `\`${item}\``).join(' → ')}`).join('\n')
    : '- none'
  const violationText = violations.length
    ? violations.map((item) => `- **${item.type}** \`${item.path}\`: ${item.detail}`).join('\n')
    : '- none'
  const testText = report.tests.length
    ? report.tests.map((item) => `- \`${item.path}\` — ${item.category}`).join('\n')
    : '- none'
  const packageCounts = PACKAGE_ORDER.map((name) => {
    const count = report.modules.filter((module) => module.layer === name).length
    return `- ${name}: **${count}** modules`
  }).join('\n')
  return `# Generated architecture snapshot\n\nGenerated: ${report.generatedAt}\n\n- production modules: **${report.productionModuleCount}**\n- production LOC: **${report.productionLineCount}**\n- tests: **${report.tests.length}**\n- detected cycles: **${report.cycles.length}**\n- policy violations outside baseline: **${violations.length}**\n\n## Package counts\n\n${packageCounts}\n\n## Modules\n\n| module | current layer | LOC | importers | relative deps | exports | environment |\n|---|---:|---:|---:|---:|---:|---|\n${rows.join('\n')}\n\n## Cycles\n\n${cycleText}\n\n## Policy violations\n\n${violationText}\n\n## Test inventory\n\n${testText}\n`
}
