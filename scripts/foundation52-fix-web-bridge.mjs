import fs from 'node:fs'

const file = 'apps/web/usage-scenarios.js'
let source = fs.readFileSync(file, 'utf8')
const oldImport = "import { saveDesignResult } from '../../packages/design/index.js'\n"
if (!source.includes(oldImport)) throw new Error('Expected legacy design persistence import not found')
source = source.replace(
  oldImport,
  "import { saveDesignResult } from './design-storage.js'\nimport './navigation.js'\n",
)
fs.writeFileSync(file, source)
console.log('usage-scenarios.js now uses the Web persistence adapter and navigation adapter')
