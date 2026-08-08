# Contributing

Mast Calculator is an engineering codebase. Architectural cleanliness matters, but numerical equivalence and explicit physical contracts take precedence over stylistic refactoring.

## Non-negotiable rules

1. **One engineering implementation.** Web, CLI and Desktop are adapters over the same TypeScript application/core packages. Do not copy FEM, optimization, connection checks, reporting or design logic into `apps/*`.
2. **Respect dependency direction.** `domain/numerics -> structural-analysis -> engineering -> design/reporting -> application -> apps`. Lower layers never import upper layers or environment APIs.
3. **Numerical drift is a veto.** Refactoring must keep canonical and independent-solver regressions green. Never regenerate a baseline merely because a refactor changed numbers.
4. **Git stores history.** When a migration is complete, migrate every consumer and delete the old implementation, imports, docs, scripts and obsolete tests in the same PR. Do not add compatibility wrappers without a current external-contract requirement.
5. **External schemas are versioned.** Incompatible project/result/design formats require a new schema version plus explicit migration and contract tests. Do not silently reinterpret old JSON.
6. **Results are complete and immutable.** Do not reintroduce adapter-side mutation/enrichment of `CalculationResult`.
7. **No speculative dependencies.** A new runtime dependency needs a concrete use case, ownership layer and security/maintenance justification.

## Where changes belong

- `packages/domain` — user project semantics, catalogs, units and portable schemas.
- `packages/numerics` — generic numerical primitives with no mast semantics.
- `packages/structural-analysis` — frame model, loads at the structural level, FEM, Schur and eigen analysis.
- `packages/engineering` — engineering checks and interpretation of structural response.
- `packages/design` — portable geometry/manufacturing projections and OBJ.
- `packages/reporting` — report/reference projections that return data/text, not environment persistence.
- `packages/application` — validated/resolved use cases and complete public results.
- `apps/web`, `apps/cli`, `apps/desktop` — environment/UI/transport only.

See `docs/ARCHITECTURE.md` for the complete boundary contract.

## Required verification

Start with the smallest relevant focused suite, then run the full gate before merge.

```bash
npm run check
npm run typecheck
npm run test:architecture
npm run audit:architecture
npm test
```

For engineering/numerical changes also run:

```bash
npm run test:physics
npm run test:performance
```

For contract changes:

```bash
npm run test:contracts
npm run test:headless
```

For design/report/3D changes:

```bash
npm run test:design
npm run build:web
```

For adapter changes:

```bash
npm run test:cli
npm run test:desktop
```

Native Desktop shell/bundle changes additionally require the Windows/Linux/macOS GitHub Actions matrix.

## Refactoring sequence

Use this order for architectural migrations:

```text
strengthen characterization/invariant tests
→ introduce the new boundary
→ migrate every consumer
→ prove numerical/functional equivalence
→ delete the old path
→ delete stale imports/docs/scripts/tests
→ merge
```

A PR is not complete while a temporary compatibility path remains without a named follow-up owner.

## Tests

A retained test must have a distinct failure-detection role: canonical regression, independent numerical oracle, physical invariant, public contract, historical bug regression, adapter equivalence, security/architecture policy or performance budget.

Historical issue numbers may remain in regression filenames when they identify the bug being guarded. They must not remain as separate CI architecture, npm orchestration or product documentation once the behaviour is part of the supported system.

## Maintainability budgets

`scripts/check-file-line-limits.mjs` enforces production-module review/hard limits. A module above the review threshold requires a narrow named budget with a concrete architectural reason. Do not raise a budget to make a PR pass; split responsibilities unless keeping the code together is necessary for a verified invariant.

`scripts/architecture-audit.mjs` must finish with zero unowned policy violations, zero production cycles and zero environment exceptions in the final Foundation baseline.

## Performance

Performance budgets are deliberately order-of-magnitude guards, not microbenchmarks. If a budget fails, investigate algorithmic/workflow regression first. Do not loosen the threshold because a change became slower without documenting and reviewing the reason.

## Pull requests

PRs should state:

- user/engineering behaviour changed or explicitly unchanged;
- layer/boundary affected;
- tests added/removed and their unique role;
- canonical numerical result impact;
- old code/docs/scripts deleted after migration;
- dependency/schema changes;
- relevant performance measurements.

For pure refactors, state explicitly that numerical baselines were not changed.

## AI-generated changes

AI agents follow exactly the same rules. They must inspect the current repository/CI before changing code, must not invent compatibility requirements, must not refresh numerical baselines to hide drift, and must delete superseded scaffolding after all consumers are migrated. Generated code does not get a lower review or verification standard.
