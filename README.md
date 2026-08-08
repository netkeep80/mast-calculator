# Калькулятор мачты

Инженерное приложение для расчёта, проверки, подбора и подготовки проектных артефактов модульной мачты из сварных арматурных октаэдров.

Один и тот же типизированный расчётный core используется тремя адаптерами:

- **Web** — статическое offline-friendly приложение, публикуемое через GitHub Pages;
- **CLI** — headless расчёт, валидация и экспорт из `project-package/v1`;
- **Desktop** — Windows/Linux/macOS приложение на Tauri с native Open/Save dialogs.

Опубликованная Web-версия: **https://netkeep80.github.io/mast-calculator/**

## Архитектурная модель

Канонический pipeline:

```text
ProjectInput
    ↓ validate + resolve once
ResolvedProject
    ↓ structural / engineering orchestration
CalculationResult
    ↓ pure projections
result-summary/v1 / design-package/v1 / reports / OBJ / procurement
```

Расчётная логика не находится в `apps/*`. Она разделена по направлению зависимостей:

```text
packages/domain
packages/numerics
packages/structural-analysis
packages/engineering
packages/design
packages/reporting
packages/application
        ↑
apps/web   apps/cli   apps/desktop
```

`apps/*` отвечают только за transport/environment/UI concerns. Web Worker, CLI и Tauri не содержат второй FEM, второй optimizer или альтернативную интерпретацию проекта.

Подробная текущая карта: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Переносимые контракты

### Проект

```text
mast-calculator/project/v1
```

Содержит пользовательский `ProjectInput`, metadata и при необходимости параметры растяжек. Derived geometry, solver state и рассчитанные значения в проект не записываются.

### Результат расчёта

`CalculationResult` — полный immutable результат application layer. Для сравнения adapters и machine-readable output используется versioned canonical result summary.

### Принятая конструкция

```text
mast-calculator/design-package/v1
```

Содержит достаточную геометрию/узел/массу для 3D, КД и exports без повторного FEM.

Контракты и правила изменения схем: [`docs/architecture/CONTRACTS.md`](docs/architecture/CONTRACTS.md).

## Что рассчитывается

Текущий core включает:

- spatial Euler–Bernoulli frame FEM с 6 DOF на узел;
- global symmetric-band solver;
- exact module Schur condensation;
- независимый dense reference FEM для cross-check;
- собственный вес, ветер, лёд и оборудование на вершине;
- member strength, global/local buckling и displacement limits;
- физический межмодульный узел: болт, гайки, preload, net section и сварка;
- static payload capacity, lateral capacity и horizontal-boom estimate;
- растяжки;
- подбор стандартного диаметра;
- производственную массу и procurement estimate;
- подробную 3D-модель, OBJ, расчётный HTML и КД по ЕСКД.

Справочники, формы, отчёты и exports используют те же canonical catalogs и calculation results; дублирующие копии нормативных constants не поддерживаются.

## Быстрый запуск

Требуется Node.js 24.

Полный functional regression:

```bash
npm test
```

Критические physics/numerical regressions:

```bash
npm run test:physics
```

Strict TypeScript и architecture policy:

```bash
npm run typecheck
npm run test:architecture
npm run audit:architecture
```

Web build:

```bash
npm run build:web
python3 -m http.server 4173 --directory _site
```

CLI:

```bash
npm run cli -- validate project.json
npm run cli -- calculate project.json --json
npm run cli -- optimize project.json --json
```

CLI contract и команды: [`docs/CLI.md`](docs/CLI.md).

Desktop build/run/release: [`docs/DESKTOP.md`](docs/DESKTOP.md) и [`docs/BUILD_AND_RELEASE.md`](docs/BUILD_AND_RELEASE.md).

## Верификация

Численная эквивалентность является veto-gate.

CI сохраняет независимо проверяемые уровни:

- canonical regression fixtures;
- physics/property invariants;
- global ↔ Schur ↔ independent dense FEM cross-check;
- historical bug regressions для поддерживаемой физики;
- immutable/versioned contract tests;
- direct ↔ CLI ↔ Web ↔ Desktop result equivalence;
- Linux/macOS/Windows platform checks;
- Web/Desktop packaging;
- performance budgets;
- architecture/security policy.

При архитектурном рефакторинге canonical numerical baselines не обновляются ради прохождения CI.

## Документация

Начинать отсюда:

1. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — слои, ownership и dependency direction;
2. [`docs/architecture/CONTRACTS.md`](docs/architecture/CONTRACTS.md) — versioned contracts;
3. [`docs/CALCULATION_ARCHITECTURE.md`](docs/CALCULATION_ARCHITECTURE.md) — FEM и расчётная схема;
4. [`docs/TRIPLE_SOLVER_VERIFICATION.md`](docs/TRIPLE_SOLVER_VERIFICATION.md) — независимая численная проверка;
5. [`docs/DESIGN_WORKSPACE.md`](docs/DESIGN_WORKSPACE.md) — 3D/КД/design package;
6. [`docs/DESKTOP.md`](docs/DESKTOP.md) — Desktop adapter;
7. [`CONTRIBUTING.md`](CONTRIBUTING.md) — правила изменений для людей и AI-generated PR.

Специализированные документы описывают конкретные текущие расчётные функции; история миграций и старые архитектурные состояния остаются в Git history, а не в рабочем дереве.

## Границы применимости

Проект не является нормативным сертификатом конструкции. До отдельной реализации и верификации остаются, в частности, geometric nonlinearity/P-Delta, initial imperfections/plasticity, конечная жёсткость фундамента и части соединений, fatigue, полный нормативный набор сочетаний и независимая внешняя FEM/натурная проверка.

При добавлении новой физики сначала расширяются contracts/invariants/regressions, затем implementation; после миграции старый путь удаляется в том же PR.
