# Architecture Foundation 2.0 — closure audit

Status: closure receipt for epic #49 / issue #57.

This file records why the Foundation can be closed. It is **not** a second architecture source of truth. Current package ownership and dependency rules live in [`../ARCHITECTURE.md`](../ARCHITECTURE.md); current external contracts live in [`CONTRACTS.md`](CONTRACTS.md).

## Result

Architecture Foundation 2.0 leaves one canonical TypeScript engineering implementation with three environment adapters:

```text
Web ─────┐
CLI ─────┼──→ application → reporting/design/engineering → structural-analysis → domain/numerics
Desktop ─┘
```

There is no compatibility `site/engine`/Web-engine copy, no second Desktop solver, no production cycle and no allowed environment exception in the final baseline.

## Architecture metrics

The original #50 audit was intentionally taken before the migration and used the then-current JavaScript/Web layout. It recorded:

- 63 production modules;
- 14,282 production LOC;
- 43 test files;
- 0 production cycles.

Those values are a discovery baseline, **not a code-size target**: during #52–#56 the monolithic Web engine was split into typed packages and the supported product surface gained explicit CLI/Desktop adapters and contract/equivalence coverage. Comparing raw module/LOC counts across those two layouts as a reduction percentage would therefore be misleading.

The final Foundation audit, using the current `packages/** + apps/web/**` production scope, records:

- 106 production modules;
- 19,220 production LOC;
- 60 test files;
- 0 production cycles;
- 0 environment exceptions;
- 0 architecture-policy violations.

`scripts/foundation-metrics.mjs` recomputes these values in CI and publishes the current largest-module, fan-out, test-role and public-API tables. The values above are the closure baseline, not manually maintained limits.

### Public API surface at closure

Effective exports include `export *` re-exports rather than merely counting declarations in the entrypoint file.

| entrypoint | effective exports |
|---|---:|
| `packages/application/contracts.ts` | 14 |
| `packages/application/index.ts` | 73 |
| `packages/design/contracts.ts` | 4 |
| `packages/design/index.ts` | 45 |
| `packages/domain/contracts.ts` | 22 |
| `packages/domain/index.ts` | 111 |
| `packages/engineering/contracts.ts` | 20 |
| `packages/engineering/index.ts` | 87 |
| `packages/numerics/index.ts` | 38 |
| `packages/reporting/index.ts` | 28 |
| `packages/structural-analysis/contracts.ts` | 13 |
| `packages/structural-analysis/index.ts` | 21 |
| `packages/structural-analysis/testing.ts` | 4 |

These are observability metrics. Public API reduction must be evidence-driven: deleting an externally meaningful export solely to make the count smaller is not a Foundation goal.

### Largest production modules at closure

The maintainability gate reviews production modules above 600 lines and hard-fails above 800. Four current modules have explicit, narrow budgets:

| module | LOC | named budget |
|---|---:|---:|
| `packages/application/src/calculate.ts` | 729 | 760 |
| `packages/engineering/src/guy-wire-system.ts` | 660 | 700 |
| `apps/web/app.js` | 652 | 700 |
| `packages/structural-analysis/src/solver.ts` | 640 | 680 |

A budget becomes an error if the file disappears, grows beyond its cap, or shrinks below the review threshold without removing the stale exception. Raising a cap merely to pass CI is prohibited by `CONTRIBUTING.md`.

## Final deletion ledger

The final hardening pass deliberately deletes migration orchestration instead of preserving it beside the durable path:

- removed issue-era `joint-strength.yml` workflow;
- removed issue-era `issue36.yml` workflow;
- removed separate `design-workspace.yml` workflow after moving its Web smoke assertions into the durable integration gate;
- removed historical `docs/architecture/FOUNDATION_AUDIT.md` after the migration it described was complete;
- removed issue-specific `docs/ISSUE_36_STATIC_LOAD_SIMPLIFICATION.md` after supported behaviour was represented by current focused docs/tests;
- removed redundant/issue-era npm test aliases and migrated every workflow/doc consumer to responsibility-based scripts;
- removed duplicate full-regression execution from the architecture workflow;
- kept historical bug-regression **tests** where they still detect a distinct supported failure mode.

The final architecture baseline contains:

```json
{
  "environmentExceptions": [],
  "allowedCycles": []
}
```

There is no planned compatibility-wrapper cleanup left from #50–#57. Git history is the archive for superseded internal architecture.

## Test responsibility model

Retained tests belong to one of these durable failure-detection roles:

- canonical/numerical equivalence;
- independent solver cross-check;
- physical invariant;
- public API/versioned contract;
- historical supported bug regression;
- UI/adapter contract;
- architecture/security/CI policy;
- performance budget;
- implementation-detail unit coverage for reusable numerical/engineering primitives.

`scripts/foundation-metrics.mjs` publishes the category inventory, including any unclassified files. Migration-era issue numbers may remain in regression **filenames** as provenance; they do not get their own permanent workflow/npm architecture.

## Cross-adapter veto gate

The final adapter oracle runs a canonical project set through:

```text
direct application API
       = CLI
       = built Web
       = built Desktop
```

The set includes, at minimum:

1. basic project with automatic joint configuration;
2. mixed module diameters;
3. manual M24/M30/80 joint configuration;
4. nontrivial capacity outputs;
5. guy-wire project package;
6. design/export path.

The design/export oracle additionally compares serialized design package, OBJ, ESKD HTML, calculation-project HTML and procurement artifacts. Numerical baselines are not regenerated by the Foundation hardening PR.

## Performance budgets

The Foundation keeps order-of-magnitude regression budgets rather than unstable microbenchmarks:

| path | gate |
|---|---:|
| 40-module complete calculation | `< 20 s` |
| representative optimization | `< 45 s` |
| emitted functional test execution | `< 90 s` |
| emitted build + functional tests | `< 120 s` |
| representative design + OBJ generation | `< 5 s` |
| Web HTML/JS/CSS/JSON code assets | `< 6 MiB` |
| representative OBJ | `< 12 MiB` |
| Desktop AppImage/NSIS/macOS app | informational size published by bundle CI |

A failure is investigated before a threshold is changed. Desktop native package size is intentionally informational because three platform packaging formats have different compression/runtime characteristics.

## CI topology after purge

The durable checks are responsibility-based:

- **Pull request checks** — syntax/types/maintainability, secrets, one complete functional regression, performance/build budgets, three-OS canonical equivalence, Web integration smoke;
- **Architecture foundation checks** — TypeScript/core import, architecture/CI policy, zero-exception baseline and metrics;
- **CLI checks** — CLI oracle on supported OS matrix;
- **Desktop checks** — generated WebView oracle plus native shell compile;
- **Desktop bundles** — real AppImage/NSIS/macOS packaging and artifact size reporting;
- **Pages** — canonical calculation + maintainability + canonical Web build/deploy.

There is no parallel issue-number CI architecture left from the Foundation migration.

## Dependency review

JavaScript has no installed runtime/development dependency tree in `package.json`; the repository uses pinned `npx` tool invocations where needed. There is therefore no obsolete npm runtime package to carry through Foundation closure.

The Desktop Rust manifest is intentionally small and all direct dependencies have current use:

- `tauri-build` — build-time Tauri metadata/resources;
- `tauri` — native shell/IPC runtime;
- `tauri-plugin-dialog` — system Open/Save dialogs;
- `serde` — serialization of the two narrow IPC response structures.

No fs/shell/http/updater frontend plugin is retained.

## Numerical audit

The #57 hardening diff changes CI, tests, scripts, documentation and repository policy; it does not rewrite production engineering/solver/UI implementation to manufacture a cleaner result. Merge remains vetoed by:

- the complete regression suite;
- canonical cross-platform baseline;
- independent FEM/physics regressions;
- direct/CLI/Web/Desktop project-set equivalence;
- real Desktop packaging.

Any unexplained numerical change blocks Foundation closure. Canonical fixtures must not be refreshed to conceal drift.

## Completion condition

When the #57 PR is green against the latest `main`, its deletion ledger is empty, and it is merged, issue #57 can close and epic #49 can close. New serious physics work (P-Delta, foundation/soil interaction and similar extensions) resumes only on top of this architecture rather than during the Foundation migration.
