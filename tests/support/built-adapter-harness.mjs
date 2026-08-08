import path from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleCache = new Map()

async function applicationApi(buildRoot) {
  const absoluteRoot = path.resolve(buildRoot)
  if (!moduleCache.has(absoluteRoot)) {
    const url = pathToFileURL(path.join(absoluteRoot, 'packages', 'application', 'index.js')).href
    moduleCache.set(absoluteRoot, import(url))
  }
  try {
    return await moduleCache.get(absoluteRoot)
  } catch (error) {
    moduleCache.delete(absoluteRoot)
    throw new Error(`Built application API is unavailable at ${absoluteRoot}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function calculateBuiltAdapterSummary(buildRoot, packageText, provenance) {
  const application = await applicationApi(buildRoot)
  const projectPackage = application.parseProjectPackage(packageText)
  const result = projectPackage.guys
    ? application.calculateGuyedProject(projectPackage.project, projectPackage.guys.tiers, {
        ...(projectPackage.guys.safetyFactor === undefined ? {} : { safetyFactor: projectPackage.guys.safetyFactor }),
        ...(projectPackage.guys.terminationEfficiency === undefined ? {} : { terminationEfficiency: projectPackage.guys.terminationEfficiency }),
      })
    : application.calculateProject(projectPackage.project)

  return projectPackage.guys
    ? application.createGuyedResultSummary(projectPackage, result, { provenance })
    : application.createBareResultSummary(projectPackage, result, { provenance })
}
