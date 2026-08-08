import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const applicationUrl = pathToFileURL(path.join(root, '_desktop', 'packages', 'application', 'index.js')).href

async function applicationApi() {
  try {
    return await import(applicationUrl)
  } catch (error) {
    throw new Error(`Desktop packaged application API is unavailable; run build:desktop:web first: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function calculateDesktopSummary(packageText, provenance = {}) {
  const application = await applicationApi()
  const projectPackage = application.parseProjectPackage(packageText)
  const result = projectPackage.guys
    ? application.calculateGuyedProject(projectPackage.project, projectPackage.guys.tiers, {
        ...(projectPackage.guys.safetyFactor === undefined ? {} : { safetyFactor: projectPackage.guys.safetyFactor }),
        ...(projectPackage.guys.terminationEfficiency === undefined ? {} : { terminationEfficiency: projectPackage.guys.terminationEfficiency }),
      })
    : application.calculateProject(projectPackage.project)
  const source = {
    toolVersion: provenance.toolVersion ?? 'desktop-harness',
    coreVersion: provenance.coreVersion ?? 'desktop-harness',
    command: 'desktop-calculate',
    ...(provenance.gitSha === undefined ? {} : { gitSha: provenance.gitSha }),
    ...(provenance.gitRef === undefined ? {} : { gitRef: provenance.gitRef }),
  }
  return projectPackage.guys
    ? application.createGuyedResultSummary(projectPackage, result, { provenance: source })
    : application.createBareResultSummary(projectPackage, result, { provenance: source })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2]
  if (!input) throw new Error('Usage: node apps/desktop/adapter-harness.mjs <project.json>')
  const text = await fs.readFile(path.resolve(input), 'utf8')
  process.stdout.write(`${JSON.stringify(await calculateDesktopSummary(text))}\n`)
}
