# Architecture Foundation 2.0 — current architecture

Status: current repository architecture through issue #56.

This document is the single source of truth for package ownership, environment boundaries and dependency direction. Canonical public data contracts are specified in [`architecture/CONTRACTS.md`](architecture/CONTRACTS.md) and ADR-006; numerical/FEM details live separately in [`CALCULATION_ARCHITECTURE.md`](CALCULATION_ARCHITECTURE.md). Desktop-specific operational details live in [`DESKTOP.md`](DESKTOP.md) and [`BUILD_AND_RELEASE.md`](BUILD_AND_RELEASE.md).

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
  cli/
  desktop/

tests/
scripts/
docs/
```

The repository intentionally uses one root npm package rather than workspace overhead. Package boundaries are source/import boundaries enforced by CI. TypeScript is the canonical headless source; Node, Web, CLI and Desktop consume compiler-emitted JavaScript from that same source. The Web build is static ESM assembly; no second bundled engineering core is generated.

## Dependency direction

```text
apps/web ─────┐
apps/cli ─────┼──→ application
apps/desktop ─┘         ↓
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
apps/* adapters      -> public package entrypoints
```

Forbidden automatically:

- any `packages/** -> apps/**` import;
- lower layer importing an upper layer;
- browser globals (`window`, `document`, `Worker`, `localStorage`, `Blob`, Canvas APIs, etc.) in packages;
- Node/Tauri runtime APIs in portable packages;
- cross-package deep imports into `src/*`;
- Web/CLI/Desktop deep imports into package internals;
- unresolved relative imports;
- circular production imports.

The policy implementation is `scripts/architecture-audit-lib.mjs`; negative fixtures live in `tests/architecture-audit.test.js`. The architecture baseline has no permanent environment or cycle exceptions.

## Canonical data flow

The public calculation pipeline is:

```text
ProjectInput
    ↓ validate + resolve once
ResolvedProject
    ↓ structural + engineering orchestration
CalculationResult
    ↓ projections only
result-summary/v1 / design-package/v1 / reports / OBJ / procurement
```

`ProjectInput` contains user-owned input only. Derived geometry, material properties, selected joint details and solver state do not become transport fields merely because an adapter needs to display them. `CalculationResult` is complete and deeply immutable at the application boundary; adapters do not enrich it after calculation.

Portable external projects use `mast-calculator/project/v1`. Any incompatible future format requires a new schema id and an explicit migration/contract test; silent reinterpretation is forbidden.

## Package ownership

### `packages/domain`

Pure project/reference semantics:

- canonical grouped `ProjectInput`, runtime validation and `ProjectInput -> ResolvedProject` resolution;
- versioned `mast-calculator/project/v1` package schema and serialization helpers;
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

The independent dense frame solver remains a verification oracle. It is deliberately not exported from the normal production index; tests use the dedicated structural-analysis testing entrypoint.

### `packages/engineering`

Engineering interpretation/checks on structural response:

- member strength, local Euler capacity and utilization;
- bolt capacity/preload;
- joint demand/configuration and nut net-section checks;
- weld checks;
- connection envelope;
- lateral/static/crane capacity calculations;
- nonlinear guy-wire system plus cable/member acceptance criteria;
- verification primitives and mixed-diameter verification.

Engineering may use structural response but does not own another FEM implementation.

### `packages/design`

Pure design/manufacturing projections:

- assembly mass and procurement transforms;
- portable `design-package/v1` codec;
- detailed mast polygon model;
- joint visual geometry;
- technical projection;
- OBJ serialization.

The design package module is portable. Browser persistence remains an app-adapter concern.

### `packages/reporting`

Pure reporting/projection functions:

- material/member report transforms and CSV;
- calculation note/project HTML;
- fabrication/reference appendix;
- ESKD document generation;
- reference-data projection used by UI/reporting.

Reporting returns data/text artifacts; it does not decide how a browser, CLI or Desktop environment persists them.

### `packages/application`

Portable use-case layer. Its public surface owns project calculation, optimization, guy-wire calculation, verification, portable package handling, canonical result summaries and application-level artifact orchestration.

Every public use case validates canonical grouped `ProjectInput`, resolves it exactly once to `ResolvedProject`, and passes that resolved value down the calculation chain. `calculateProject()` owns assembly of the complete public `CalculationResult`; completed results are deeply immutable by default. Application failures cross the boundary as typed application errors.

Progress/cancellation are portable hooks. The application layer does not know about DOM, Web Workers, Node process termination, Tauri IPC or filesystems.

## Web adapter

`apps/web` owns browser environment concerns only:

- DOM/forms and scenario UX;
- construction/application of canonical grouped `ProjectInput` through the shared form adapter;
- Web Worker transport, progress and cancellation presentation;
- Canvas viewers;
- browser persistence where the product explicitly uses `localStorage`;
- runtime build-info display;
- browser implementation of the shared text-file adapter;
- navigation.

The calculation Worker imports the application public API and calls canonical application use cases. Heavy calculation policy is not duplicated in the Worker or UI.

All user-facing text-file operations go through the environment `fileAdapter`. Only the browser implementation owns file-input/Blob/object-URL mechanics; shared presentation modules do not.

## CLI adapter

`apps/cli` is a headless transport over compiler-emitted application/design/reporting packages. It owns:

- command-line parsing and exit-code policy;
- filesystem input/output;
- machine-readable stdout/stderr discipline;
- process/worker watchdog behaviour;
- CLI provenance metadata.

It does not own a calculation formula, solver, optimizer or alternate project schema. `calculate`, `optimize`, `validate` and export commands operate on the same `project/v1` package and canonical use cases as Web/Desktop.

## Desktop adapter

`apps/desktop` is a Tauri shell over the canonical Web presentation and the same compiler-emitted packages. `scripts/build-desktop-web.mjs` builds the normal Web tree, copies it as the Desktop WebView tree and overlays only explicit environment modules such as the Tauri file adapter.

The Rust shell intentionally exposes only narrow native Open/Save commands. Paths come from native dialogs; the WebView is not given broad filesystem, shell, HTTP or updater capabilities. Tauri is an environment shell, not a second engineering core and not a reason to port FEM to Rust.

Calculation/optimization, progress and cancellation use the same Web Worker/controller files as Web. The Desktop equivalence gate verifies that those files are not forked and compares canonical output against direct application, CLI and Web adapters.

Desktop runtime assets are self-contained and scanned for remote runtime imports. Version/build identity is generated into `build-info.json` and displayed by the shared presentation. See [`DESKTOP.md`](DESKTOP.md) and ADR [`adr/0001-tauri-desktop-adapter.md`](adr/0001-tauri-desktop-adapter.md).

## File persistence boundary

Portable packages create/parse/serialize data; adapters persist it.

```text
presentation/use case
      ↓
fileAdapter.saveText / openText
      ├─ browser: file input + Blob download
      └─ desktop: Tauri native dialog + narrow IPC

CLI uses its own explicit filesystem transport.
```

This boundary covers project packages, design packages, reports, ESKD, OBJ, procurement HTML/CSV and the other current text artifacts. Adding a new export should first produce a portable artifact in application/design/reporting and only then bind persistence in an app adapter.

## Public entrypoints

Every package has `packages/<name>/index.ts`, emitted to `index.js`. Cross-package production imports use these public entrypoints.

Special verification entrypoints may exist only when they represent an intentional non-production oracle. They must not become convenience deep-import escape hatches.

`tests/package-entrypoints.test.js` and the architecture audit guard dependency ownership and the absence of compatibility production paths.

## Headless execution

A plain Node process uses the same public contract as every adapter:

```js
import {
  calculateProject,
  createProjectInput,
} from './.build/packages/application/index.js'

const input = createProjectInput({
  geometry: { moduleCount: 1 },
})
const result = calculateProject(input)
```

`tests/headless-api.test.js` exercises project calculation, optimization and guy-wire calculation without browser globals. Contract tests guard user-only input, runtime schema versioning, typed errors and immutable complete results. Canonical and triple-FEM suites independently protect numerical equivalence.

## Builds

### Core

`npm run build:core` emits the canonical strict-TypeScript package tree to `.build/packages`.

### Web / GitHub Pages

`npm run build:web` creates:

```text
_site/
  index.html, design.html, ...
  logo.jpg
  apps/web/
  packages/        # compiler-emitted canonical core
```

Pages publishes that tree. There is no browser-only engineering copy.

### Desktop

`npm run build:desktop:web` creates `_desktop` from the canonical Web build plus the explicit Desktop environment overlay. `npm run prepare:desktop:icons` derives platform icon assets from one canonical source PNG. Native Tauri CI compiles and bundles Linux AppImage, Windows NSIS and macOS app artifacts.

Published GitHub Releases can attach the corresponding unsigned Desktop artifacts via the release workflow. Signing/notarization/updating are separate trust-policy work and are not silently enabled.

## Verification gates

Foundation-relevant commands include:

```bash
npm run check
npm run typecheck
npm run test:contracts
npm run audit:architecture
npm run test:architecture
npm run test:headless
npm run test:foundation
npm run test:platform
npm run test:cli
npm run test:desktop
npm test
npm run build:web
```

Permanent principles behind the CI matrix:

- canonical numerical regression is a veto, not a baseline to regenerate during refactoring;
- independent FEM cross-checks remain separate from adapter tests;
- adapter/platform equivalence must exercise the same versioned contracts;
- all supported native platforms must compile/package the Desktop shell;
- environment/security boundaries are negative-tested, not just documented.

## Migration/deletion policy

The pre-foundation `site/engine/*` implementation and later transitional contract/typing paths have been removed. No compatibility wrappers are retained simply to preserve old internal imports.

For every Architecture Foundation migration:

```text
add/strengthen behavioral tests
→ introduce the new boundary
→ migrate every consumer
→ prove numerical/functional equivalence
→ delete old implementation/imports/docs/tests
→ merge
```

Git history stores the old implementation. Issue #57 is the final Foundation purge/hardening pass; it must simplify this architecture further where possible rather than add another parallel layer.
