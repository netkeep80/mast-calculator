import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const buildPackagesRoot = path.join(repoRoot, '.build', 'packages')

function moduleUrl(packageName) {
  return pathToFileURL(path.join(buildPackagesRoot, packageName, 'index.js')).href
}

async function loadCore() {
  try {
    const [application, design, reporting] = await Promise.all([
      import(moduleUrl('application')),
      import(moduleUrl('design')),
      import(moduleUrl('reporting')),
    ])
    const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'))
    return { application, design, reporting, version: String(packageJson.version ?? 'unknown') }
  } catch (error) {
    const wrapped = new Error(`Не удалось загрузить compiler-emitted core из .build/packages: ${error instanceof Error ? error.message : String(error)}`)
    wrapped.code = 'core-not-built'
    wrapped.category = 'internal-invariant'
    throw wrapped
  }
}

function stableGeneratedAt(projectPackage) {
  return projectPackage.metadata?.modifiedAt ?? projectPackage.metadata?.createdAt ?? 'not-specified'
}

function provenance(command, version) {
  return {
    toolVersion: version,
    coreVersion: version,
    command,
    ...(process.env.GITHUB_SHA ? { gitSha: process.env.GITHUB_SHA } : {}),
    ...(process.env.GITHUB_REF ? { gitRef: process.env.GITHUB_REF } : {}),
    ...(process.env.GITHUB_RUN_ID ? { runId: process.env.GITHUB_RUN_ID } : {}),
  }
}

async function readProjectPackage(file, application) {
  if (!file) {
    const error = new Error('Не указан путь к project.json')
    error.code = 'missing-project-path'
    error.category = 'input-validation'
    throw error
  }
  let text
  try {
    text = await fs.readFile(path.resolve(file), 'utf8')
  } catch (error) {
    const wrapped = new Error(`Не удалось прочитать ${file}: ${error instanceof Error ? error.message : String(error)}`)
    wrapped.code = 'project-read-failed'
    wrapped.category = 'io-error'
    throw wrapped
  }
  return application.parseProjectPackage(text)
}

function guyOptions(projectPackage) {
  const guys = projectPackage.guys
  if (!guys) return {}
  return {
    ...(guys.safetyFactor === undefined ? {} : { safetyFactor: guys.safetyFactor }),
    ...(guys.terminationEfficiency === undefined ? {} : { terminationEfficiency: guys.terminationEfficiency }),
  }
}

function progressReporter(hooks) {
  return typeof hooks?.onProgress === 'function' ? hooks.onProgress : () => {}
}

function calculateFromPackage(projectPackage, application, onProgress) {
  if (projectPackage.guys) {
    onProgress({ phase: 'guyed', label: 'Расчёт мачты с растяжками', fraction: 0 })
    const result = application.calculateGuyedProject(
      projectPackage.project,
      projectPackage.guys.tiers,
      guyOptions(projectPackage),
    )
    onProgress({ phase: 'guyed', label: 'Расчёт мачты с растяжками завершён', fraction: 1 })
    return { mode: 'guyed', result }
  }
  return {
    mode: 'bare',
    result: application.calculateProject(projectPackage.project, { onProgress }),
  }
}

function humanCalculation(summary) {
  const response = summary.result.response
  const geometry = summary.result.geometry
  if (summary.mode === 'guyed') {
    return `OK guyed: ${geometry.moduleCount} мод.; H=${geometry.mastHeightM.toFixed(3)} м; U=${response.maxUtilization.toFixed(6)}; прогиб=${response.topDisplacementMm.toFixed(3)} мм; λcr=${response.minimumBucklingFactor.toFixed(6)}; Uтрос=${response.maximumCableUtilization.toFixed(6)}`
  }
  return `OK bare: ${geometry.moduleCount} мод.; H=${geometry.mastHeightM.toFixed(3)} м; U=${response.maxUtilization.toFixed(6)}; прогиб=${response.topDisplacementMm.toFixed(3)} мм; λcr=${response.minimumBucklingFactor.toFixed(6)}`
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function artifactResult(content, mediaType, suggestedExtension, human) {
  return { kind: 'artifact', content, mediaType, suggestedExtension, human }
}

export async function executeCliRequest(request, hooks = {}) {
  const { command, projectFile, json = false } = request
  const onProgress = progressReporter(hooks)
  const { application, design, reporting, version } = await loadCore()
  const projectPackage = await readProjectPackage(projectFile, application)
  const source = provenance(command, version)

  if (command === 'validate') {
    return {
      kind: 'output',
      content: json ? jsonText(projectPackage) : `OK ${projectPackage.schema}\n`,
      mediaType: 'application/json',
      human: `Проект валиден: ${projectPackage.schema}`,
    }
  }

  if (command === 'calculate') {
    const calculated = calculateFromPackage(projectPackage, application, onProgress)
    const summary = calculated.mode === 'guyed'
      ? application.createGuyedResultSummary(projectPackage, calculated.result, { provenance: source })
      : application.createBareResultSummary(projectPackage, calculated.result, { provenance: source })
    return {
      kind: 'output',
      content: json ? jsonText(summary) : `${humanCalculation(summary)}\n`,
      mediaType: json ? 'application/json' : 'text/plain',
      human: humanCalculation(summary),
    }
  }

  if (command === 'optimize') {
    const output = application.optimizeAndCalculateProject(projectPackage.project, { onProgress })
    let summary = application.createOptimizationResultSummary(projectPackage, output, { provenance: source })
    if (projectPackage.guys && output.result) {
      const effectivePackage = application.createProjectPackage(output.projectInput, {
        metadata: projectPackage.metadata,
        guys: projectPackage.guys,
      })
      onProgress({ phase: 'guyed', label: 'Проверка выбранной конструкции с растяжками', fraction: 0 })
      const guyed = application.calculateGuyedProject(
        output.projectInput,
        projectPackage.guys.tiers,
        guyOptions(projectPackage),
      )
      onProgress({ phase: 'guyed', label: 'Проверка выбранной конструкции с растяжками завершена', fraction: 1 })
      summary = application.createGuyedResultSummary(effectivePackage, guyed, {
        provenance: source,
        optimization: output.optimization,
      })
    }
    const human = output.optimization.recommendedDiameter == null
      ? `Подбор завершён: проходящий стандартный диаметр не найден после ${output.optimization.evaluatedCount} вариантов`
      : `Подбор завершён: Ø${output.optimization.recommendedDiameter} мм после ${output.optimization.evaluatedCount} вариантов`
    return {
      kind: 'output',
      content: json ? jsonText(summary) : `${human}\n`,
      mediaType: json ? 'application/json' : 'text/plain',
      human,
    }
  }

  const bareResult = application.calculateProject(projectPackage.project, { onProgress })
  const generatedAt = stableGeneratedAt(projectPackage)

  if (command === 'design') {
    const value = application.createDesignPackage(bareResult, {
      createdAt: generatedAt,
      repository: 'netkeep80/mast-calculator',
      ref: process.env.GITHUB_REF ?? 'unknown',
      sha: process.env.GITHUB_SHA ?? 'unknown',
    })
    return artifactResult(jsonText(value), 'application/json', '.design.json', 'Пакет 3D/КД сформирован')
  }

  if (command === 'export-obj') {
    return artifactResult(design.createMastObj(bareResult), 'text/plain;charset=utf-8', '.obj', 'OBJ сформирован')
  }

  if (command === 'export-eskd') {
    return artifactResult(
      reporting.createEskdConstructionDocumentationHtml(bareResult),
      'text/html;charset=utf-8',
      '.eskd.html',
      'Комплект КД по ЕСКД сформирован',
    )
  }

  if (command === 'export-report') {
    return artifactResult(
      reporting.createCalculationProjectHtml(
        bareResult,
        bareResult.parameters,
        generatedAt,
        {
          repository: 'netkeep80/mast-calculator',
          ref: process.env.GITHUB_REF ?? 'unknown',
          sha: process.env.GITHUB_SHA ?? 'unknown',
          runId: process.env.GITHUB_RUN_ID ?? 'unknown',
        },
      ),
      'text/html;charset=utf-8',
      '.calculation.html',
      'Расчётный отчёт сформирован',
    )
  }

  if (command === 'export-procurement') {
    let guyed = null
    if (projectPackage.guys) {
      onProgress({ phase: 'guyed', label: 'Расчёт растяжек для закупочной сметы', fraction: 0 })
      guyed = application.calculateGuyedProject(projectPackage.project, projectPackage.guys.tiers, guyOptions(projectPackage))
      onProgress({ phase: 'guyed', label: 'Расчёт растяжек для закупочной сметы завершён', fraction: 1 })
    }
    const estimate = application.createProcurementEstimateFromCalculation(bareResult, guyed)
    return artifactResult(
      design.createProcurementEstimateHtml(estimate, generatedAt),
      'text/html;charset=utf-8',
      '.procurement.html',
      'Закупочная смета сформирована',
    )
  }

  const error = new Error(`Неизвестная команда CLI: ${String(command)}`)
  error.code = 'unknown-command'
  error.category = 'unsupported-configuration'
  throw error
}

export function serializeCliError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error instanceof Error ? error.message : String(error),
    code: error?.code ?? 'cli-failure',
    category: error?.category ?? null,
    details: error?.details ?? null,
    stack: error instanceof Error ? error.stack ?? null : null,
  }
}
