import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const workflow = fs.readFileSync(new URL('../.github/workflows/issue36.yml', import.meta.url), 'utf8')
const packageJson = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')

test('issue #36 имеет отдельный обязательный gate статических нагрузок, стрелы и раскроя', () => {
  assert.match(workflow, /name:\s*Static load simplification checks/)
  assert.match(workflow, /name:\s*Static loads, crane boom and cut range/)
  assert.match(workflow, /scripts\/simulate-fresh-merge\.sh/)
  assert.match(workflow, /npm run test:issue36/)
  assert.match(workflow, /crane-boom-capacity\.js/)
  assert.match(workflow, /craneBoomCapacity/)
})

test('issue #36 syntax gate включает новый расчёт горизонтальной стрелы', () => {
  assert.match(packageJson, /node --check site\/engine\/crane-boom-capacity\.js/)
  assert.match(packageJson, /tests\/crane-boom-capacity\.test\.js/)
})
