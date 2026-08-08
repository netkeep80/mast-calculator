import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createProjectInput,
  createProjectPackage,
  serializeProjectPackage,
} from '../packages/application/index.js'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const cliPath = path.join(sourceRoot, 'apps', 'cli', 'mast-calc.mjs')
const cleanEnv = { ...process.env }
delete cleanEnv.GITHUB_SHA
delete cleanEnv.GITHUB_REF
delete cleanEnv.GITHUB_RUN_ID

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: sourceRoot,
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 120_000,
  })
}

test('CLI generates design, OBJ, ESKD, report and procurement artifacts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mast-cli-artifacts-'))
  try {
    const projectFile = path.join(directory, 'project.json')
    const projectPackage = createProjectPackage(createProjectInput({
      geometry: { moduleCount: 1 },
      environment: {
        windPresetId: 'custom',
        windPressurePa: 250,
        windEnvelopeEnabled: false,
        lateralCapacityStepDeg: 60,
      },
      criteria: { heightSearchMaxModules: 1 },
    }), {
      metadata: { name: 'artifact-smoke', createdAt: '2026-08-08T12:00:00.000Z' },
    })
    fs.writeFileSync(projectFile, serializeProjectPackage(projectPackage))

    const cases = [
      ['design', 'design.json', (text) => assert.equal(JSON.parse(text).schema, 'mast-calculator/design-package/v1')],
      ['export-obj', 'mast.obj', (text) => {
        assert.match(text, /(^|\n)v\s+-?[0-9]/)
        assert.match(text, /(^|\n)f\s+[0-9]/)
      }],
      ['export-eskd', 'eskd.html', (text) => {
        assert.match(text, /<html/i)
        assert.match(text, /ЕСКД|конструкторск/i)
      }],
      ['export-report', 'calculation.html', (text) => {
        assert.match(text, /<html/i)
        assert.match(text, /расч[её]т/i)
      }],
      ['export-procurement', 'procurement.html', (text) => {
        assert.match(text, /<html/i)
        assert.match(text, /закуп|спецификац|материал/i)
      }],
    ]

    for (const [command, filename, verify] of cases) {
      const output = path.join(directory, filename)
      const cli = runCli([command, projectFile, '--quiet', '-o', output])
      assert.equal(cli.status, 0, `${command}: ${cli.stderr}`)
      assert.equal(cli.stdout, '')
      assert.ok(fs.existsSync(output), `${command}: output was not created`)
      const text = fs.readFileSync(output, 'utf8')
      assert.ok(text.length > 20, `${command}: output is unexpectedly short`)
      verify(text)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
