#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const COMMANDS = new Set([
  'validate',
  'calculate',
  'optimize',
  'design',
  'export-obj',
  'export-eskd',
  'export-report',
  'export-procurement',
])

const HELP = `mast-calc <command> <project.json> [options]

Commands:
  validate             Validate/migrate a project package
  calculate            Calculate bare mast or guyed mast when package.guys is present
  optimize             Optimize diameter/joint using the same application workflow
  design               Build the versioned design package
  export-obj           Export shared mast geometry as OBJ
  export-eskd          Export ESKD construction documentation HTML
  export-report        Export calculation report HTML
  export-procurement   Export procurement estimate HTML

Options:
  --json               Machine-readable stdout for validate/calculate/optimize
  --quiet              Suppress human success messages when output goes to a file
  -o, --output <file>  Write command output/artifact to a file
  --timeout <ms>       Kill the isolated calculation worker after the deadline
  -h, --help           Show this help
`

function parseArguments(argv) {
  const values = [...argv]
  if (values.length === 0 || values.includes('--help') || values.includes('-h')) return { help: true }
  const command = values.shift()
  const projectFile = values.shift()
  const options = { command, projectFile, json: false, quiet: false, output: null, timeoutMs: 0 }
  while (values.length > 0) {
    const token = values.shift()
    if (token === '--json') options.json = true
    else if (token === '--quiet') options.quiet = true
    else if (token === '-o' || token === '--output') {
      const output = values.shift()
      if (!output) throw Object.assign(new Error(`${token}: требуется путь к файлу`), { exitCode: 2 })
      options.output = output
    } else if (token === '--timeout') {
      const raw = values.shift()
      const timeoutMs = Number(raw)
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw Object.assign(new Error('--timeout: требуется положительное число миллисекунд'), { exitCode: 2 })
      }
      options.timeoutMs = Math.floor(timeoutMs)
    } else {
      throw Object.assign(new Error(`Неизвестная опция CLI: ${token}`), { exitCode: 2 })
    }
  }
  if (!COMMANDS.has(command)) throw Object.assign(new Error(`Неизвестная команда CLI: ${String(command)}`), { exitCode: 3 })
  if (!projectFile) throw Object.assign(new Error('Не указан путь к project.json'), { exitCode: 2 })
  if (options.output == null && command.startsWith('export-')) {
    throw Object.assign(new Error(`${command}: требуется -o/--output`), { exitCode: 2 })
  }
  return options
}

function exitCodeForError(error) {
  if (Number.isInteger(error?.exitCode)) return error.exitCode
  if (error?.name === 'ProjectSchemaError') return 2
  if (error?.category === 'input-validation' || error?.category === 'schema-error') return 2
  if (error?.category === 'unsupported-configuration') return 3
  if (error?.category === 'numerical-failure' || error?.category === 'convergence-failure') return 4
  if (error?.category === 'cancelled') return 6
  return 5
}

function errorText(error) {
  const prefix = error?.code ? `${error.code}: ` : ''
  return `${prefix}${error?.message ?? String(error)}`
}

async function runWorker(request) {
  const worker = new Worker(new URL('./job-worker.mjs', import.meta.url), { workerData: request })
  let timer = null
  let cancelled = false

  const terminate = async (message, code = 'operation-cancelled') => {
    if (cancelled) return
    cancelled = true
    if (timer) clearTimeout(timer)
    await worker.terminate()
    const error = new Error(message)
    error.category = 'cancelled'
    error.code = code
    throw error
  }

  const signalHandler = () => {
    void terminate('CLI operation cancelled by signal').catch((error) => {
      process.stderr.write(`${errorText(error)}\n`)
      process.exit(6)
    })
  }
  process.once('SIGINT', signalHandler)
  process.once('SIGTERM', signalHandler)

  try {
    return await new Promise((resolve, reject) => {
      worker.once('message', (message) => {
        if (timer) clearTimeout(timer)
        if (message?.ok) resolve(message.result)
        else reject(message?.error ?? new Error('CLI worker returned an invalid response'))
      })
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (!cancelled && code !== 0) reject(new Error(`CLI worker exited with code ${code}`))
      })
      if (request.timeoutMs > 0) {
        timer = setTimeout(() => {
          cancelled = true
          void worker.terminate().then(() => {
            const error = new Error(`CLI watchdog timeout after ${request.timeoutMs} ms`)
            error.category = 'cancelled'
            error.code = 'operation-timeout'
            reject(error)
          })
        }, request.timeoutMs)
      }
    })
  } finally {
    if (timer) clearTimeout(timer)
    process.removeListener('SIGINT', signalHandler)
    process.removeListener('SIGTERM', signalHandler)
  }
}

async function emitResult(result, options) {
  if (options.output) {
    const target = path.resolve(options.output)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, result.content, 'utf8')
    if (options.json) {
      const bytes = Buffer.byteLength(result.content, 'utf8')
      process.stdout.write(`${JSON.stringify({ ok: true, command: options.command, output: target, mediaType: result.mediaType, bytes })}\n`)
    } else if (!options.quiet) {
      process.stdout.write(`${result.human ?? 'Готово'}: ${target}\n`)
    }
    return
  }
  if (!options.quiet || options.json) process.stdout.write(result.content)
}

export async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseArguments(argv)
    if (options.help) {
      process.stdout.write(HELP)
      return 0
    }
    const result = await runWorker(options)
    await emitResult(result, options)
    return 0
  } catch (error) {
    const exitCode = exitCodeForError(error)
    process.stderr.write(`${errorText(error)}\n`)
    return exitCode
  }
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false
if (invokedAsScript) process.exitCode = await main()
