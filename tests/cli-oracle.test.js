import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  calculateGuyedProject,
  calculateProject,
  createBareResultSummary,
  createGuyedResultSummary,
  createProjectInput,
  createProjectPackage,
  serializeProjectPackage,
} from '../packages/application/index.js'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.basename(runtimeRoot) === '.build' ? path.dirname(runtimeRoot) : runtimeRoot
const cliPath = path.join(sourceRoot, 'apps', 'cli', 'mast-calc.mjs')
const packageVersion = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')).version
const cleanEnv = { ...process.env }
delete cleanEnv.GITHUB_SHA
delete cleanEnv.GITHUB_REF
delete cleanEnv.GITHUB_RUN_ID

function compactProject(overrides = {}) {
  const input = createProjectInput({
    geometry: { moduleCount: 1, ...(overrides.geometry ?? {}) },
    environment: {
      windPresetId: 'custom',
      windPressurePa: 250,
      windEnvelopeEnabled: false,
      lateralCapacityStepDeg: 60,
      ...(overrides.environment ?? {}),
    },
    criteria: { heightSearchMaxModules: 1, ...(overrides.criteria ?? {}) },
    ...(overrides.connection ? { connection: overrides.connection } : {}),
  })
  return input
}

function temporaryProject(projectPackage) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mast-cli-'))
  const file = path.join(directory, 'project.json')
  fs.writeFileSync(file, serializeProjectPackage(projectPackage))
  return { directory, file }
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: sourceRoot,
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 120_000,
  })
}

function provenance(command) {
  return { toolVersion: packageVersion, coreVersion: packageVersion, command }
}

test('CLI calculate --json is an exact oracle for direct bare application summary', () => {
  const projectPackage = createProjectPackage(compactProject(), {
    metadata: { name: 'CLI bare oracle', createdAt: '2026-08-08T12:00:00.000Z' },
  })
  const temp = temporaryProject(projectPackage)
  try {
    const direct = createBareResultSummary(projectPackage, calculateProject(projectPackage.project), {
      provenance: provenance('calculate'),
    })
    const cli = runCli(['calculate', temp.file, '--json'])
    assert.equal(cli.status, 0, cli.stderr)
    assert.deepEqual(JSON.parse(cli.stdout), direct)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI calculate uses package.guys and matches direct guyed application summary', () => {
  const projectPackage = createProjectPackage(compactProject(), {
    metadata: { name: 'CLI guyed oracle' },
    guys: {
      safetyFactor: 3,
      terminationEfficiency: 0.8,
      tiers: [{
        id: 'top',
        heightM: 0.5,
        anchorRadiusM: 5,
        guyCount: 3,
        pretensionN: 500,
        wireId: '6x19s-iwrc-4',
      }],
    },
  })
  const temp = temporaryProject(projectPackage)
  try {
    const directResult = calculateGuyedProject(projectPackage.project, projectPackage.guys.tiers, {
      safetyFactor: 3,
      terminationEfficiency: 0.8,
    })
    const direct = createGuyedResultSummary(projectPackage, directResult, {
      provenance: provenance('calculate'),
    })
    const cli = runCli(['calculate', temp.file, '--json'])
    assert.equal(cli.status, 0, cli.stderr)
    assert.deepEqual(JSON.parse(cli.stdout), direct)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI returns stable schema/input exit code 2', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mast-cli-invalid-'))
  const file = path.join(directory, 'invalid.json')
  fs.writeFileSync(file, JSON.stringify({ schema: 'mast-calculator/project/v999', project: {} }))
  try {
    const cli = runCli(['validate', file, '--json'])
    assert.equal(cli.status, 2)
    assert.match(cli.stderr, /unsupported-schema|Неподдерживаемая схема проекта/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('CLI watchdog terminates isolated CPU worker with exit code 6', () => {
  const projectPackage = createProjectPackage(compactProject({ geometry: { moduleCount: 4 } }))
  const temp = temporaryProject(projectPackage)
  try {
    const cli = runCli(['calculate', temp.file, '--json', '--timeout', '1'])
    assert.equal(cli.status, 6, cli.stderr)
    assert.match(cli.stderr, /operation-timeout|watchdog timeout/)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})
