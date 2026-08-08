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
  createOptimizationResultSummary,
  createProjectInput,
  createProjectPackage,
  optimizeAndCalculateProject,
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
  return createProjectInput({
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
}

function temporaryProject(projectPackage, filename = 'project with spaces.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mast-cli-'))
  const file = path.join(directory, filename)
  fs.writeFileSync(file, serializeProjectPackage(projectPackage))
  return { directory, file }
}

function temporaryText(text, filename = 'project with spaces.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mast-cli-'))
  const file = path.join(directory, filename)
  fs.writeFileSync(file, text)
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

function directBareSummary(projectPackage) {
  return createBareResultSummary(projectPackage, calculateProject(projectPackage.project), {
    provenance: provenance('calculate'),
  })
}

test('CLI calculate --json is an exact oracle for direct bare application summary', () => {
  const projectPackage = createProjectPackage(compactProject(), {
    metadata: { name: 'CLI bare oracle', createdAt: '2026-08-08T12:00:00.000Z' },
  })
  const temp = temporaryProject(projectPackage)
  try {
    const direct = directBareSummary(projectPackage)
    const cli = runCli(['calculate', temp.file, '--json'])
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(cli.stderr, '')
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
        wireId: 'galv-6x19-iwrc-6',
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

test('CLI optimize --json is an exact oracle for application optimization', () => {
  const projectPackage = createProjectPackage(compactProject(), {
    metadata: { name: 'CLI optimization oracle' },
  })
  const temp = temporaryProject(projectPackage)
  try {
    const output = optimizeAndCalculateProject(projectPackage.project)
    const direct = createOptimizationResultSummary(projectPackage, output, {
      provenance: provenance('optimize'),
    })
    const cli = runCli(['optimize', temp.file, '--json'])
    assert.equal(cli.status, 0, cli.stderr)
    assert.deepEqual(JSON.parse(cli.stdout), direct)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI preserves a mixed module diameter ProjectInput exactly', () => {
  const projectPackage = createProjectPackage(compactProject({
    geometry: { moduleCount: 3, moduleDiametersMm: [16, 12, 8] },
    criteria: { heightSearchMaxModules: 3 },
  }))
  const temp = temporaryProject(projectPackage)
  try {
    const direct = directBareSummary(projectPackage)
    const cli = runCli(['calculate', temp.file, '--json'])
    assert.equal(cli.status, 0, cli.stderr)
    const actual = JSON.parse(cli.stdout)
    assert.deepEqual(actual, direct)
    assert.deepEqual(actual.result.geometry.moduleDiametersMm, [16, 12, 8])
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI preserves a manual physical joint without switching it to auto', () => {
  const projectPackage = createProjectPackage(compactProject({
    geometry: { moduleCount: 2 },
    criteria: { heightSearchMaxModules: 2 },
    connection: {
      configuratorMode: 'manual',
      boltDiameterMm: 24,
      boltClass: '8.8',
      clearanceNutThreadMm: 30,
      boltLengthMm: 80,
      threadEngagementFactor: 2,
    },
  }))
  const temp = temporaryProject(projectPackage)
  try {
    const direct = directBareSummary(projectPackage)
    const cli = runCli(['calculate', temp.file, '--json'])
    assert.equal(cli.status, 0, cli.stderr)
    const actual = JSON.parse(cli.stdout)
    assert.deepEqual(actual, direct)
    assert.equal(actual.result.connection.mode, 'manual')
    assert.equal(actual.result.connection.bolt.diameterMm, 24)
    assert.equal(actual.result.connection.clearanceNutThreadMm, 30)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI returns stable schema/input exit code 2 with machine stdout kept clean', () => {
  const temp = temporaryText(JSON.stringify({ schema: 'mast-calculator/project/v999', project: {} }))
  try {
    const cli = runCli(['validate', temp.file, '--json'])
    assert.equal(cli.status, 2)
    assert.equal(cli.stdout, '')
    assert.match(cli.stderr, /unsupported-schema|Неподдерживаемая схема проекта/)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI rejects malformed JSON with input exit code 2', () => {
  const temp = temporaryText('{"schema":')
  try {
    const cli = runCli(['validate', temp.file, '--json'])
    assert.equal(cli.status, 2)
    assert.equal(cli.stdout, '')
    assert.match(cli.stderr, /invalid-json|Не удалось прочитать JSON-пакет проекта/)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI rejects semantic project errors with input exit code 2', () => {
  const valid = JSON.parse(serializeProjectPackage(createProjectPackage(compactProject())))
  valid.project.geometry.moduleCount = 0
  const temp = temporaryText(JSON.stringify(valid))
  try {
    const cli = runCli(['validate', temp.file, '--json'])
    assert.equal(cli.status, 2)
    assert.equal(cli.stdout, '')
    assert.match(cli.stderr, /invalid-module-count|moduleCount/)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})

test('CLI watchdog terminates isolated CPU worker with exit code 6', () => {
  const projectPackage = createProjectPackage(compactProject({ geometry: { moduleCount: 4 } }))
  const temp = temporaryProject(projectPackage)
  try {
    const cli = runCli(['calculate', temp.file, '--json', '--timeout', '1'])
    assert.equal(cli.status, 6, cli.stderr)
    assert.equal(cli.stdout, '')
    assert.match(cli.stderr, /operation-timeout|watchdog timeout/)
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true })
  }
})
