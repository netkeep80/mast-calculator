import { parentPort, workerData } from 'node:worker_threads'
import { executeCliRequest, serializeCliError } from './cli-runtime.mjs'

try {
  const result = await executeCliRequest(workerData, {
    onProgress: (progress) => parentPort?.postMessage({ type: 'progress', progress }),
  })
  parentPort?.postMessage({ type: 'result', ok: true, result })
} catch (error) {
  parentPort?.postMessage({ type: 'result', ok: false, error: serializeCliError(error) })
}
