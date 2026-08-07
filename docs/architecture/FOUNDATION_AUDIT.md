# Architecture Foundation 2.0 — historical audit snapshot

Issue: #50  
Parent epic: #49

> **Historical document.** This audit described the repository immediately before the physical core extraction in issue #52. It is not the current architecture map. The authoritative current document is [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

The detailed pre-migration version remains in Git history (PR #58). It was intentionally compacted after its findings were turned into executable architecture policy and the old `site/engine` layout was removed.

## Measured pre-#52 baseline

The issue #50 audit measured:

```text
63 production JavaScript modules under site/
14,282 production LOC
43 tests/*.test.js files
0 production import cycles
```

At that time most engineering code lived under `site/engine/**`, so browser deployment location and core package ownership were not physically separated.

## Findings that drove #51–#54

The audit identified these major risks:

1. `CalculationResult` completeness was split across calculation orchestration, a completion wrapper and the Web Worker.
2. `app-bootstrap.js` contained low-level engineering preview calls.
3. `guys-app.js` reconstructed a second mast input/orchestration path.
4. `design-package.js` mixed a portable package codec with browser `localStorage` persistence.
5. legacy flat fields such as `extraHorizontalLoadN` / `extraVerticalLoadN` survived in parameter plumbing after their public load semantics had been removed.
6. several derived geometry/material/joint values still looked like ordinary public inputs.
7. `reference-frame.js` had no production importer because it is an intentionally independent dense verification oracle, not dead code.

## What issue #52 changed

Issue #52 executed the physical-boundary part of that migration:

```text
site/engine/*        -> packages/*
site Web adapter     -> apps/web/*
```

It also:

- extracted project-parameter resolution below application orchestration;
- split browser design-package persistence from the portable codec;
- introduced package public entrypoints and automated dependency-direction/deep-import rules;
- retained the independent dense solver behind `packages/structural-analysis/testing.js`;
- added an explicit headless application API;
- changed GitHub Pages to assemble `apps/web + packages` without a second bundled core copy.

The old moved source paths are not kept as compatibility wrappers. Git history is the archive.

## Current executable audit

The repository architecture is no longer inferred from this document. It is checked directly by:

```bash
npm run audit:architecture
npm run audit:architecture:report
npm run test:architecture
```

The policy scans `packages/**` and `apps/web/**` and rejects environment coupling, forbidden dependency direction, cross-package deep imports, cycles and unresolved relative imports.

For the current package map and ownership rules, see [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
