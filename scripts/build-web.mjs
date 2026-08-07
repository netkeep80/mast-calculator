import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const output = path.join(root, '_site')
const webSource = path.join(root, 'apps', 'web')
const packagesSource = path.join(root, 'packages')

if (!fs.existsSync(webSource)) throw new Error('apps/web not found')
if (!fs.existsSync(packagesSource)) throw new Error('packages not found')

fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
fs.cpSync(webSource, path.join(output, 'apps', 'web'), { recursive: true })
fs.cpSync(packagesSource, path.join(output, 'packages'), { recursive: true })

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

console.log(`Web build ready: ${path.relative(root, output)} (apps/web + packages, no bundler)`)
