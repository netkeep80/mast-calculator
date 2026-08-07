# Regression safety net

Issue #51 freezes the numerical behaviour that Architecture Foundation 2.0 must preserve while code boundaries move.

## Layers of protection

The safety net deliberately has independent layers instead of one giant snapshot:

1. **Canonical baseline** — `tests/fixtures/canonical/scenarios-v1.js` defines versioned engineering inputs; `baseline-v1.json` stores a compact reviewed projection of current results.
2. **Independent solver equivalence** — `triple-solver-crosscheck.test.js` compares global banded FEM, modular Schur and the independent dense reference solver over complete 6-DOF vectors, reactions and member end forces.
3. **Seeded physical invariants** — `physics-invariants-seeded.test.js` regenerates deterministic cases and checks topology, independent self-weight, rigid-body geometry invariance, force equilibrium and global↔Schur agreement.
4. **Historical regressions** — focused tests preserve previously fixed failure modes; see `HISTORICAL_REGRESSIONS.md`.
5. **Performance budget** — the 40-module case separates correctness assertions from wall-clock budget while sharing one memoized calculation.
6. **Platform equivalence** — CI runs the canonical baseline on Ubuntu, Windows and macOS. The full heavy suite has one owner rather than being repeated on every OS.

## Canonical scenarios

`mast-calculator/canonical-scenarios/v1` contains 16 named cases covering:

- one-module self weight and heavy top mass;
- two-module oblique wind;
- four-module wind + ice + equipment;
- 7-module and 12-module reference calculations;
- the 40-module performance owner;
- mixed diameters;
- manual and automatic physical joints;
- multi-tier guys;
- static top payload, pure lateral capacity, horizontal crane boom and maximum-height search;
- design-package → restored design result → mesh/OBJ round-trip.

The baseline is intentionally **not** a serialized `CalculationResult`. Small and large cases store only stable topology, selected physical outputs, engineering extrema and deterministic vector checksums. Complete 6-DOF equivalence remains in the independent triple-solver tests where differences are reviewable as vectors rather than opaque JSON churn.

## Floating-point policy

All new regression comparisons use `tests/helpers/regression-tolerances.js`.

| class | relative | absolute | intent |
|---|---:|---:|---|
| DOF | `2e-8` | `2e-10` | displacement/rotation and DOF checksums |
| force | `2e-8` | `1e-5 N` | reactions, loads, cable/limit forces |
| moment | `2e-8` | `1e-6 N·m` | moment comparisons |
| utilization | `2e-8` | `1e-10` | dimensionless utilization |
| eigenvalue | `2e-7` | `1e-8` | buckling factors/eigenvalues |
| residual | `0` | `1e-6` | numerical residual guard |
| geometry | `1e-10` | `1e-7 mm` | fabrication/geometry dimensions |
| mass | `2e-9` | `1e-6 kg` | mass projections |

Exact discrete contracts — counts, topology, selected bolt sizes, schema ids and governing modes — remain exact.

## Updating the baseline

A baseline update is a reviewed engineering change, not a way to make CI green.

1. Explain the physical/contract reason for the changed result in the PR.
2. Run `node scripts/generate-canonical-baseline.mjs` against the intended implementation.
3. Compare the generated projection with `baseline-v1.json` and change only the affected fields.
4. Keep seeded invariants and independent solver checks green without weakening their tolerances.
5. If the meaning of an input or result changes rather than only its expected numeric value, introduce a new schema version instead of silently reinterpreting `v1`.

## Test commands

- `npm test` — full regression owner, run once in CI on Ubuntu.
- `npm run test:foundation` — canonical + seeded invariants + independent triple-FEM equivalence.
- `npm run test:canonical` — frozen baseline only.
- `npm run test:properties` — deterministic seeded invariants.
- `npm run test:platform` — portable canonical gate used on the OS matrix.
- `npm run test:performance` — correctness + timing tests for the bounded large case.
- existing focused commands (`test:joint`, `test:statics`, `test:guys`, etc.) remain useful for local diagnosis and specialized CI gates.

## CI ownership

The ordinary PR workflow owns the full `npm test` suite once on Ubuntu. A separate three-OS matrix owns only `test:platform`. Architecture CI owns dependency/environment policy and its own negative fixtures; it does not repeat the full engineering suite. Specialized historical workflows may run focused subsets when their purpose is explicit, but no workflow should duplicate the complete expensive regression suite merely for another label.
