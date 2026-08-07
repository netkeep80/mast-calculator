# Architecture Foundation 2.0 — current architecture

Status: current repository architecture after issue #52.

This document is the single source of truth for package ownership, environment boundaries and dependency direction. Numerical/FEM details live separately in [`CALCULATION_ARCHITECTURE.md`](CALCULATION_ARCHITECTURE.md); the pre-migration audit is historical evidence in `docs/architecture/FOUNDATION_AUDIT.md`.

## Repository layout

```text
packages/
  domain/
  numerics/
  structural-analysis/
  engineering/
  design/
  reporting/
  application/

apps/
  web/

tests/
scripts/
```

The repository intentionally uses one root npm package rather than workspace overhead. Package boundaries are source/import boundaries enforced by CI. The Web build is static ESM assembly; no bundler is required.

## Dependency direction

```text
apps/web
    ↓
application
    ↓
reporting / design / engineering
    ↓
structural-analysis
    ↓
domain + numerics
```

More precisely, CI permits:

```text
domain              -> domain
numerics            -> numerics
structural-analysis -> structural-analysis, domain, numerics
engineering         -> engineering, structural-analysis, domain, numerics
design              -> design, engineering, structural-analysis, domain, numerics
reporting           -> reporting, design, engineering, structural-analysis, domain, numerics
application         -> application, reporting, design, engineering, structural-analysis, domain, numerics
apps/web            -> public package entrypoints
```

Forbidden automatically:

- any `packages/** -> apps/**` import;
- lower layer importing an upper layer;
- browser globals (`window`, `document`, `Worker`, `localStorage`, `Blob`, Canvas APIs, etc.) in packages;
- Node runtime APIs/imports in portable packages;
- cross-package deep imports into `src/*`;
- Web deep imports into package internals;
- unresolved relative imports;
- circular production imports.

The policy implementation is `scripts/architecture-audit-lib.mjs`; negative fixtures live in `tests/architecture-audit.test.js`. The issue #52 baseline has no permanent environment exceptions.

## Package ownership

### `packages/domain`

Pure project/reference semantics:

- canonical project defaults and `resolveCalculationParameters()`;
- reinforcement, bolt, nut, thread, guy-wire and weld reference catalogues;
- weather conversion/presets;
- diameter profile and fabrication geometry rules that do not require FEM.

No solver, report rendering or environment API belongs here.

### `packages/numerics`

Generic numerical primitives:

- dense linear algebra helpers;
- symmetric band storage/factorization;
- generic vector operations.

This layer has no mast, bolt, weld, weather or application semantics.

### `packages/structural-analysis`

Raw structural mechanics and solver paths:

- physical frame geometry/model assembly;
- distributed/nodal loads;
- global banded frame FEM;
- module Schur solver and module response/verification support;
- eigen-buckling orchestration;
- weld-zone stiffness representation.

`analyzeFrame()` owns structural response only: DOF, rotations, reactions, member end actions, global buckling and numerical diagnostics. It does **not** apply reinforcement yield, material safety factor, von Mises/member utilization or guy-wire acceptance criteria.

The independent dense frame solver remains verification/test-support. It is deliberately **not** exported from the normal production index; tests use `packages/structural-analysis/testing.js`.

### `packages/engineering`

Engineering interpretation/checks on structural response:

- member strength, local Euler capacity and utilization via `analyzeCheckedFrame()`;
- bolt capacity/preload;
- joint demand/configuration and nut net-section checks;
- weld checks;
- connection envelope;
- lateral/static/crane capacity calculations;
- nonlinear guy-wire system plus cable/member acceptance criteria;
- verification primitives and mixed-diameter verification.

The old member-strength formula was moved verbatim out of the structural solver. `analyzeCheckedFrame()` decorates raw `analyzeFrame()` output without introducing a second FEM implementation.

### `packages/design`

Pure design/manufacturing projections:

- assembly mass and procurement transforms;
- portable `design-package/v1` codec;
- detailed mast polygon model;
- joint visual geometry;
- technical projection;
- OBJ serialization.

The design package module is portable. Browser persistence was split out of it; `localStorage` lives only in `apps/web/design-storage.js`.

### `packages/reporting`

Pure reporting/projection functions:

- material/member report transforms and CSV;
- calculation note/project HTML;
- fabrication/reference appendix;
- ESKD document generation;
- reference-data projection used by UI/reporting.

### `packages/application`

Portable use-case layer. Its explicit public API includes:

```js
calculateProject(input, options)
optimizeProject(input, options)
calculateGuyedProject(input, tiers, options)
createVerification(result)
```

`calculateProject()` owns the complete headless calculation result exposed to environment adapters. `calculateGuyedProject()` delegates the engineering guy-wire use case without exposing solver ownership to Web. Progress is a callback passed through `options`; the application layer does not know about `self.postMessage`, DOM or filesystems.

Legacy calculation functions remain inside the same canonical application package for internal/focused tests during the foundation sequence, but no old `site/engine` compatibility path exists. Issue #53/#54 will tighten result/contracts and orchestration further without another physical core copy.

## Web adapter

`apps/web` owns environment concerns only:

- DOM/forms and scenario UX;
- Web Worker transport;
- Canvas viewers;
- `localStorage` design-package persistence;
- `fetch(build-info)`;
- Blob/URL downloads;
- navigation.

The calculation Worker imports the application public API and calls `calculateProject()` / `optimizeProject()`. The guys UI calls `calculateGuyedProject()` rather than importing structural or engineering implementation paths directly. Web no longer performs module-verification enrichment itself.

Some UI preview/orchestration logic is intentionally still scheduled for issue #54; issue #52 establishes the hard physical boundary and public API so that cleanup can occur without moving physics again.

## Public entrypoints

Every package has `packages/<name>/index.js`. Cross-package production imports use these entrypoints.

Special exception by design:

```text
packages/structural-analysis/testing.js
```

This exposes the independent dense oracle only to verification/tests. It is not a second production FEM API.

`tests/package-entrypoints.test.js` also guards semantic ownership: member-strength formulae and guy-wire acceptance must remain outside the structural production API.

## Node/headless execution

A plain Node process can import:

```js
import { calculateProject } from './packages/application/index.js'

const result = calculateProject({ moduleCount: 1 })
```

`tests/headless-api.test.js` exercises project calculation, optimization and guy-wire calculation without browser globals. The #51 canonical and triple-FEM suites simultaneously prove numerical equivalence after the physical move.

## Web build and GitHub Pages

`npm run build:web` creates:

```text
_site/
  index.html, design.html, ...     # root entry HTML with <base href="./apps/web/">
  logo.jpg
  apps/web/                        # browser adapter source
  packages/                        # same ESM core tested by Node
```

No second bundled copy of the engineering core is generated. Browser and Node consume the same package source files.

Pages CI adds deployment metadata and publishes `_site`. Static-site CI serves the assembled tree and verifies both Web modules and public package entrypoints.

## Verification gates

Relevant foundation gates:

```bash
npm run check
npm run audit:architecture
npm run test:architecture
npm run test:headless
npm run test:foundation
npm run test:platform
npm test
npm run build:web
```

The full engineering suite is owned once by Ubuntu CI; canonical equivalence runs on Ubuntu/macOS/Windows. The 40-module performance test remains a separate wall-clock budget while sharing the same calculation with its correctness assertions.

## Migration/deletion policy

The pre-#52 `site/engine/*` implementation has been removed. There are no permanent re-export wrappers at those paths and no duplicate core kept for fallback.

For every later Architecture Foundation migration:

```text
add/strengthen behavioral tests
→ introduce the new boundary
→ migrate every consumer
→ prove numerical/functional equivalence
→ delete old implementation/imports/docs/tests
→ merge
```

Git history stores the old implementation.