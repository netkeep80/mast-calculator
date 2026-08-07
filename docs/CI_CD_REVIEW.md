# Аудит CI/CD по шаблонам link-foundation

Дата аудита: 2026-08-07.

Цель: сопоставить CI/CD Mast Calculator с четырьмя эталонными шаблонами link-foundation и перенести практики, которые применимы к статическому браузерному JavaScript-приложению без npm-зависимостей и без package-release процесса.

Проверены репозитории:

- `link-foundation/js-ai-driven-development-pipeline-template`;
- `link-foundation/rust-ai-driven-development-pipeline-template`;
- `link-foundation/python-ai-driven-development-pipeline-template`;
- `link-foundation/csharp-ai-driven-development-pipeline-template`.

Аудит охватывал workflow-файлы, CI/CD-скрипты, тесты самих pipeline-механизмов и документацию о Pages/release. Языково-специфичные release-операции (npm/PyPI/crates.io/NuGet) анализировались, но не копировались в Mast Calculator, потому что приложение не публикует библиотечный пакет.

## 1. CI/CD-релевантное дерево шаблонов

### JavaScript template

Workflow-файлы:

```text
.github/workflows/release.yml
.github/workflows/links.yml
.github/workflows/example-app.yml
```

CI/CD и release scripts, найденные в текущем дереве и используемые/проверяемые pipeline:

```text
scripts/check-mjs-syntax.sh
scripts/simulate-fresh-merge.sh
scripts/check-file-line-limits.sh
scripts/detect-code-changes.mjs
scripts/check-version.mjs
scripts/check-changesets.mjs
scripts/validate-changeset.mjs
scripts/create-manual-changeset.mjs
scripts/merge-changesets.mjs
scripts/instant-version-bump.mjs
scripts/version-and-commit.mjs
scripts/check-release-needed.mjs
scripts/wait-for-npm.mjs
scripts/publish-to-npm.mjs
scripts/create-github-release.mjs
scripts/format-release-notes.mjs
scripts/format-github-release.mjs
scripts/package-info.mjs
scripts/npm-registry.mjs
scripts/check-docker-build.mjs
scripts/check-web-archive.mjs
scripts/update-preview-images.mjs
```

Особенно релевантные Mast Calculator практики:

- fast-fail checks;
- fresh-merge simulation для PR;
- explicit timeouts;
- cross-platform test matrix;
- secretlint;
- контроль длины файлов;
- тесты CI/CD-логики;
- современные major-версии official actions;
- отдельная безопасная Pages publication.

### Rust template

Workflow-файлы:

```text
.github/workflows/release.yml
```

Документация публикуется отдельным job внутри `release.yml`.

CI/CD scripts, перечисленные текущей структурой/документацией и release workflow:

```text
scripts/bump-version.rs
scripts/check-cargo-lock.rs
scripts/check-changelog-fragment.rs
scripts/check-crate-size.rs
scripts/check-file-size.rs
scripts/check-release-needed.rs
scripts/check-version-modification.rs
scripts/collect-changelog.rs
scripts/create-changelog-fragment.rs
scripts/create-github-release.rs
scripts/detect-code-changes.rs
scripts/get-bump-type.rs
scripts/get-version.rs
scripts/git-config.rs
scripts/publish-crate.rs
scripts/release-naming.rs
scripts/rust-paths.rs
scripts/smoke-test-published-crate.rs
scripts/version-and-commit.rs
scripts/wait-for-crate.rs
```

Также шаблон содержит CI/CD unit tests под `tests/unit/ci-cd/`.

Полезные практики:

- проверка lockfile/determinism;
- job-scoped concurrency;
- explicit timeouts;
- cross-platform tests;
- отдельная проверка опубликованного артефакта;
- явная документация одноразовой настройки Pages Source = GitHub Actions.

Lockfile-guard к Mast Calculator сейчас неприменим: у проекта нет npm-зависимостей и lockfile не участвует в расчёте/сборке.

### Python template

Workflow-файлы:

```text
.github/workflows/release.yml
.github/workflows/docs.yml
```

CI/CD scripts, найденные в текущем дереве/поиске и упомянутые workflow:

```text
scripts/check_file_size.py
scripts/bump_version.py
scripts/version_and_commit.py
scripts/publish_to_pypi.py
scripts/create_github_release.py
scripts/validate_changeset.py
scripts/create_manual_changeset.py
scripts/format_release_notes.py
scripts/detect_code_changes.py
```

Pipeline-тесты включают, в частности:

```text
tests/test_workflows.py
tests/test_check_file_size.py
tests/test_smoke_test_published_package.py
tests/test_create_github_release.py
```

Полезные практики:

- workflow-конфигурация проверяется обычными unit tests;
- Pages build выполняется и на PR, deploy — только в разрешённом контексте;
- Pages deployment может иметь явный opt-in repository variable;
- build/test должны завершиться до publication.

### C# template

Workflow-файлы:

```text
.github/workflows/release.yml
.github/workflows/docs.yml
```

CI/CD scripts из текущей структуры:

```text
scripts/bump-version.mjs
scripts/check-file-size.mjs
scripts/create-github-release.mjs
scripts/merge-changesets.mjs
scripts/validate-changeset.mjs
scripts/version-and-commit.mjs
```

Полезные практики:

- cross-platform matrix Ubuntu/macOS/Windows;
- warnings-as-errors / strict quality gate как общий принцип;
- Pages deploy не должен ждать первого package release;
- official GitHub Pages actions;
- явная одноразовая настройка Source = GitHub Actions.

## 2. Общие лучшие практики, подтверждённые несколькими шаблонами

| Практика | JS | Rust | Python | C# | Mast Calculator |
|---|---:|---:|---:|---:|---:|
| Explicit `timeout-minutes` | да | да | да | да | принято |
| Least-privilege permissions | да | да | да | да | принято |
| Современные official actions | да | да | да | да | принято |
| Cross-platform tests | да | да | частично/по задаче | да | принято: 3 ОС |
| Fresh merge PR validation | да | да | используется в release pipeline | используется в release pipeline | принято |
| Secret scan | да | да/quality layer | да/quality layer | по pipeline | принято |
| File-size/line guard | да | да | да | да | принято |
| CI/CD tests | да | да | да | частично | принято |
| Safe writer concurrency | да | да | да | да | принято |
| Pages official artifact flow | да | да | да | да | принято |
| Проверка опубликованного package | да | да | да | release-specific | неприменимо |
| Changelog/version release machinery | да | да | да | да | пока неприменимо |

## 3. Изменения, перенесённые в Mast Calculator

### `.github/workflows/ci.yml`

Теперь pipeline разделён на независимые проверки:

```text
Syntax, policy and maintainability
Secrets scan
Tests (ubuntu-latest)
Tests (macos-latest)
Tests (windows-latest)
Static site smoke test
```

Принято:

- `actions/checkout@v6`;
- `actions/setup-node@v6`;
- Node.js `24.x`;
- `contents: read` по умолчанию;
- explicit timeout для каждого job;
- job-scoped concurrency с `cancel-in-progress: true` для read-only checks;
- `scripts/simulate-fresh-merge.sh` перед PR-проверками;
- 3-OS test matrix;
- secretlint с recommended preset;
- `scripts/check-file-line-limits.mjs`;
- smoke-test реального статического HTTP-site;
- workflow policy включён в обычный `npm test`.

### `.github/workflows/pages.yml`

Принято:

- `actions/checkout@v6`;
- `actions/setup-node@v6`, Node 24.x;
- `actions/configure-pages@v6`;
- `actions/upload-pages-artifact@v5`;
- `actions/deploy-pages@v5`;
- полный `npm test` перед упаковкой;
- syntax и line-limit checks перед deploy;
- build job имеет только `contents: read`;
- права `pages: write` и `id-token: write` выданы только deploy job;
- publication является writer operation с `cancel-in-progress: false` — уже начатый deploy не уничтожается более новым запуском;
- build-info содержит точный Git SHA опубликованного расчётного кода.

## 4. Ошибки прежней конфигурации и защита от повторения

### Старые major-версии GitHub Actions

Ранее workflow использовали `checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v4`, `deploy-pages@v4`. GitHub уже выдавал предупреждения о Node.js 20 deprecation.

Исправление: версии синхронизированы с актуальными link-foundation templates.

Защита: `tests/ci-policy.test.js` падает, если в workflows снова появятся запрещённые старые major versions или Node 22.

### Pages publication и первая настройка репозитория

Ранее публикация не происходила, пока Pages source не был вручную настроен. Это не ошибка YAML: GitHub требует одноразово выбрать **Settings → Pages → Source = GitHub Actions** для custom Pages workflow.

Та же особенность прямо документирована в актуальных link-foundation templates; в Python template дополнительно применяется opt-in variable, а C# template отдельно документирует проблему первого 404/deploy.

Для Mast Calculator источник уже настроен, поэтому дополнительный opt-in variable сейчас не нужен.

### Отмена writer job

Старый Pages workflow имел `cancel-in-progress: true` на весь workflow. Для read-only test job это полезно, но для уже начавшейся публикации потенциально опасно.

Исправление: проверки могут отменяться, deploy serialization использует `cancel-in-progress: false`.

### CI как непроверяемая конфигурация

Ранее YAML проверял сам себя только фактом успешного запуска.

Исправление: `tests/ci-policy.test.js` проверяет policy-инварианты workflows, а значит изменения CI/CD проходят через тот же PR test gate, что и расчётный код.

## 5. Практики, которые сознательно не перенесены

### Changesets / Scriv / package release

Mast Calculator сейчас публикует статическое приложение, а не npm/PyPI/NuGet/crates.io package. Автоматический semantic release, package registry publishing и changelog fragments добавили бы сложность без текущей пользы.

### Dependency cache и lockfile guard

У приложения нет runtime npm dependencies. Node используется как test runner. Нет смысла создавать lockfile только ради cache-key.

Если появятся внешние npm dependencies, обязательными становятся:

1. committed lockfile;
2. `npm ci` вместо плавающей установки;
3. dependency cache по hash lockfile;
4. обновление CI policy tests.

### Change detection для пропуска тестов

Шаблоны используют сложное определение code changes, потому что выполняют дорогие package-release pipelines. Полный тест Mast Calculator остаётся достаточно дешёвым, а расчётное ПО выигрывает от запуска всего набора тестов на каждый PR. Поэтому сейчас selective skip сознательно не используется.

## 6. Проверка самих шаблонов на наши найденные проблемы

Проверялись две проблемы, которые уже реально возникали в Mast Calculator:

1. устаревшие action versions / Node.js 20 deprecation warnings;
2. некорректные ожидания относительно автоматического первоначального включения GitHub Pages.

В актуальных версиях четырёх шаблонов эти проблемы уже исправлены или явно документированы:

- используются актуальные major versions official actions;
- Pages Source = GitHub Actions описан как обязательный одноразовый шаг;
- Python template имеет дополнительный безопасный Pages opt-in;
- C# template документирует случай, когда привязка deploy к release оставляла сайт 404 до первого релиза.

**Поэтому новые issues в template repositories по этим двум проблемам не создавались: воспроизводимого дефекта в текущих шаблонах не найдено.**

Если в дальнейшем CI Mast Calculator обнаружит дефект, который воспроизводится и в актуальном template-файле/скрипте, сначала фиксируется минимальный воспроизводимый пример, затем создаётся issue в соответствующем template repository со ссылкой на failing workflow/log.

## 7. Инварианты CI/CD Mast Calculator

Эти правила считаются частью архитектуры проекта:

1. Ни один PR с изменением расчётного кода не должен обходить `npm test`.
2. Аналитические FEM-тесты должны проходить минимум на Linux, macOS и Windows.
3. Каждый job обязан иметь конечный timeout.
4. Default token permissions — только read; write-права выдаются локально конкретному deploy job.
5. PR должен проверяться относительно актуального `main`.
6. Writer operations нельзя отменять посередине только потому, что появился более новый push.
7. Версии GitHub Actions должны контролироваться тестом.
8. Pages publication запускается только после успешной повторной проверки сайта.
9. Git SHA опубликованной версии должен попадать в расчётный проект.
10. CI/CD scripts являются тестируемым кодом и подчиняются тем же ограничениям размера/поддерживаемости, что и расчётное ядро.
