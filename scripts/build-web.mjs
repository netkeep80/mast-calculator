import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const output = path.join(root, '_site')
const webSource = path.join(root, 'apps', 'web')
const compiledPackages = path.join(root, '.build', 'packages')

if (!fs.existsSync(webSource)) throw new Error('apps/web not found')

execFileSync(process.execPath, ['scripts/build-core.mjs'], {
  cwd: root,
  stdio: 'inherit',
})
if (!fs.existsSync(compiledPackages)) throw new Error('.build/packages not found after TypeScript emit')

fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
fs.cpSync(webSource, path.join(output, 'apps', 'web'), { recursive: true })
fs.cpSync(compiledPackages, path.join(output, 'packages'), { recursive: true })

const logo = path.join(root, 'logo.jpg')
if (fs.existsSync(logo)) {
  fs.copyFileSync(logo, path.join(output, 'logo.jpg'))
  fs.copyFileSync(logo, path.join(output, 'apps', 'web', 'logo.jpg'))
}

function rootHtml(source) {
  if (/<base\s/i.test(source)) return source
  return source.replace(/<head>\s*/i, '<head>\n  <base href="./apps/web/">\n')
}

for (const entry of fs.readdirSync(webSource, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.html')) continue
  const source = fs.readFileSync(path.join(webSource, entry.name), 'utf8')
  fs.writeFileSync(path.join(output, entry.name), rootHtml(source))
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const buildInfo = {
  adapter: 'web',
  appVersion: String(packageJson.version ?? 'unknown'),
  coreVersion: String(packageJson.version ?? 'unknown'),
  repository: 'netkeep80/mast-calculator',
  ref: process.env.GITHUB_REF ?? 'local',
  sha: process.env.GITHUB_SHA ?? 'development',
  runId: process.env.GITHUB_RUN_ID ?? 'local',
}
fs.writeFileSync(
  path.join(output, 'apps', 'web', 'build-info.json'),
  `${JSON.stringify(buildInfo, null, 2)}\n`,
)

console.log(`Web build ready: ${path.relative(root, output)} (apps/web + TypeScript-emitted packages)`)
