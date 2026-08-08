import { parentPort, workerData } from 'node:worker_threads'
import { executeCliRequest, serializeCliError } from './cli-runtime.mjs'

try {
  const result = await executeCliRequest(workerData)
  parentPort?.postMessage({ ok: true, result })
} catch (error) {
  parentPort?.postMessage({ ok: false, error: serializeCliError(error) })
}
