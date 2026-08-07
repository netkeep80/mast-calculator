# Аудит и контракт CI/CD

Дата последней актуализации: **2026-08-07**. Текущая конфигурация соответствует прототипу **1.2**.

## 1. База аудита

CI/CD Mast Calculator ранее был сопоставлен с четырьмя шаблонами link-foundation:

- `link-foundation/js-ai-driven-development-pipeline-template`;
- `link-foundation/rust-ai-driven-development-pipeline-template`;
- `link-foundation/python-ai-driven-development-pipeline-template`;
- `link-foundation/csharp-ai-driven-development-pipeline-template`.

Проверялись workflow-файлы, CI/CD/release scripts, pipeline tests и Pages documentation. Языково-специфичный publish в npm/PyPI/crates.io/NuGet не переносился, потому что Mast Calculator является статическим browser application, а не registry package.

## 2. Принятые практики из шаблонов

В репозитории зафиксированы:

- explicit `timeout-minutes` для каждого job;
- least-privilege `contents: read` по умолчанию;
- write permissions только в Pages deploy job;
- современные official GitHub Actions;
- Node.js 24.x;
- fresh-merge simulation для PR;
- Linux/macOS/Windows test matrix;
- secret scan;
- file line-limit guard;
- tests для policy самих workflows;
- отдельные узкие verification gates;
- safe writer concurrency для Pages;
- полный test/check до публикации;
- Git SHA опубликованной сборки в `build-info.json`.

## 3. Current PR checks

`.github/workflows/ci.yml` содержит независимые jobs:

```text
Syntax, policy and maintainability
Secrets scan
Triple FEM equivalence
Joint configurator
Tests (ubuntu-latest)
Tests (macos-latest)
Tests (windows-latest)
Static site smoke test
```

Все jobs кроме publication являются read-only и могут отменяться новым commit того же PR.

## 4. Syntax, policy and maintainability

Job выполняет:

```text
fresh-merge simulation
npm run check
node scripts/check-file-line-limits.mjs
```

`npm run check` включает browser entry points, Worker, FEM modules, reference solver и новые модули issue #21:

```text
app-bootstrap.js
joint-viewer.js
joint-hardware-catalog.js
joint-configurator.js
complete-calculation.js
```

## 5. Secrets scan

Используется `secretlint` с recommended preset.

Задача отделена от functional tests, чтобы случайный secret не маскировался обычным test failure.

## 6. Triple FEM equivalence

Dedicated job:

```bash
npm run test:triple
```

Он проверяет одну и ту же linear frame model тремя путями:

```text
global banded FEM
module Schur solver
independent dense reference FEM
```

Сравниваются DOF, reactions, local member end-forces и для выбранных cases `lambda_cr`.

Это отдельный visible PR gate, хотя те же tests входят в общий `npm test`.

## 7. Joint configurator — новый gate 1.2

Issue #21 получил отдельный job:

```bash
npm run test:joint
```

Он проверяет не просто UI, а физическую consistency конфигуратора:

```text
M24 bolt -> minimum clearance nut M30
M24 -> coupling nut M24x72
2d engagement -> 48 mm -> 16 turns
M24/M30 -> required 75.6 mm -> standard bolt 80 mm
M24x70 -> geometry FAIL
auto 100 kN -> minimum passing M20 8.8 with matching hardware
manual M24/M30/80 -> parameters are preserved
complete calculation -> selected joint is frozen for lateral/static/height searches
```

Задача нужна отдельно, потому что ошибка в catalogue/geometry/configurator не обязана проявиться как ошибка FEM.

## 8. Full cross-platform suite

Один и тот же:

```bash
npm test
```

обязан проходить на:

```text
ubuntu-latest
macos-latest
windows-latest
```

`fail-fast: false` сохраняется, чтобы platform-specific failure не скрывал результаты остальных ОС.

## 9. Static-site smoke

Smoke запускает реальный HTTP server и проверяет browser resources через `curl`.

Для prototype 1.2 дополнительно проверяются:

```text
logo.jpg
app-bootstrap.js
joint-viewer.js
complete-calculation.js
joint-hardware-catalog.js
joint-configurator.js
reference-frame.js
```

Так как исходный `logo.jpg` хранится в корне repository, smoke перед запуском копирует его в `site/logo.jpg`. Это воспроизводит структуру Pages artifact.

Проверяется и пользовательский title:

```html
<title>Калькулятор мачты</title>
```

## 10. Pages publication

`.github/workflows/pages.yml` выполняет:

```text
checkout
Node 24
npm test
npm run check
line-limit guard
prepare _site
configure Pages
upload artifact
deploy
```

Сайт формируется:

```bash
cp -R site _site
cp logo.jpg _site/logo.jpg
```

Таким образом используется именно пользовательский `logo.jpg` из корня репозитория.

`build-info.json` содержит:

```text
repository
ref
sha
runId
```

Git SHA затем может попасть в расчётный проект как идентификатор фактически опубликованного кода.

## 11. Writer concurrency

Read-only checks допускают:

```text
cancel-in-progress: true
```

Для Pages deploy используется отдельная writer group:

```text
main-writer-${{ github.repository }}-pages
cancel-in-progress: false
```

Уже начавшаяся публикация не должна обрываться новым push.

## 12. Workflow policy tests

`tests/ci-policy.test.js` проверяет CI/CD как обычный код.

Среди invariants:

- `contents: read` по умолчанию;
- timeout у каждого runner job;
- official actions не старее разрешённых major versions;
- Node 24.x;
- fresh-merge script;
- три ОС;
- dedicated Triple FEM gate;
- dedicated Joint configurator gate;
- smoke resources issue #21;
- logo packaging;
- safe Pages writer concurrency.

То есть случайное ослабление CI должно упасть в том же PR, где оно внесено.

## 13. Fresh-merge validation

PR workflow перед code/test jobs вызывает:

```bash
scripts/simulate-fresh-merge.sh
```

Проверки относятся не только к isolated head branch, но и к её совместимости с текущим `main`.

## 14. Практики, которые сознательно не применяются

Пока не нужны:

```text
npm package release
changesets/Scriv package changelog machinery
registry smoke tests
lockfile cache
selective test skipping
```

Причины:

- runtime npm dependencies отсутствуют;
- сайт не является registry package;
- полный test suite остаётся достаточно дешёвым;
- расчётное ПО выигрывает от запуска всех regression tests на каждый PR.

Если появятся npm dependencies, обязательными станут committed lockfile, `npm ci` и cache key по lockfile hash.

## 15. Проверка исходных шаблонов

При первоначальном аудите были специально сопоставлены две ранее реальные проблемы Mast Calculator:

1. устаревшие versions GitHub Actions / Node deprecation;
2. misunderstanding initial Pages Source setup.

В актуальных версиях исследованных link-foundation templates эти проблемы уже были исправлены или документированы, поэтому искусственные issues в templates не создавались.

Правило на будущее сохраняется: если Mast Calculator обнаружит CI/CD defect, который воспроизводится в актуальном template-файле/скрипте, сначала создаётся минимальный reproducible case, затем issue в соответствующем template repository.

## 16. CI/CD invariants проекта

1. Ни один PR с расчётным кодом не обходит `npm test`.
2. Frame tests проходят минимум на Linux/macOS/Windows.
3. Три внутренних solver имеют отдельный visible gate.
4. Physical joint configurator имеет отдельный visible gate.
5. Каждый job имеет timeout.
6. Default permissions read-only.
7. PR проверяется относительно latest `main`.
8. Writer operation не отменяется посередине более новым push.
9. Pages deploy получает только прошедший test/check artifact.
10. Root `logo.jpg` входит в published artifact и smoke-tested.
11. Git SHA published build сохраняется.
12. CI/CD scripts/workflows тестируются как часть repository code.
