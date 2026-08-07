# Расчётный pipeline и structural-analysis

Этот документ описывает **математический/инженерный pipeline**, а не repository architecture. Фактическая карта packages, public APIs и направления зависимостей находится только в [`ARCHITECTURE.md`](ARCHITECTURE.md).

Текущие реализации находятся в `packages/structural-analysis`, `packages/engineering` и вызываются через portable use-cases `packages/application`.

## Поток расчёта

```text
Project input
  ↓
resolveCalculationParameters()          domain
  ↓
physical 9-member octahedral modules
  ↓
global frame assembly + module stack   structural-analysis
  ↓
operational load cases
  ↓
┌─────────────────────────┐
│ global banded FEM       │
│ exact module Schur      │  runtime cross-check
└─────────────────────────┘
  ↓
member N/V/T/M + interface actions
  ↓
connection engineering                 engineering
  bolt / nut / preload / weld
  ↓
fix selected physical joint
  ↓
┌──────────────────┬──────────────────┬──────────────────┬────────────────┐
│ pure lateral ref │ static top mass  │ horizontal boom  │ maximum height │
└──────────────────┴──────────────────┴──────────────────┴────────────────┘
  ↓
verification + design/report projections
```

The independent dense FEM is verification/test-support and is exposed only through `packages/structural-analysis/testing.js`; it is not a production calculation path.

## Physical module

A module is a regular octahedron oriented legs-down:

```text
edge a = Lstock / nparts
1 <= nparts <= 48, integer
R = a / sqrt(3)
h = a * sqrt(2/3)
3 top-ring + 6 leg = 9 members/module
```

Adjacent levels rotate by 60°. There is no special `closeTopRing`: the top triangle belongs naturally to the last physical module.

## Frame formulation

Each node has six DOF:

```text
ux, uy, uz, rx, ry, rz
```

Each member is a 12-DOF spatial Euler–Bernoulli frame element. Circular-section properties provide `EA`, `EIy`, `EIz`, `GJ`. Self-weight, ice and wind on members are distributed loads converted to consistent local nodal vectors.

After solving, local end actions are recovered as:

```text
[N, Vy, Vz, T, My, Mz]A
[N, Vy, Vz, T, My, Mz]B
```

## Global banded FEM

`compileFrameSystem()` builds symmetric-band stiffness and factorizes once per geometry. Multiple load cases reuse that factorization:

```text
K u = F
```

The solver reports numerical residuals, free-DOF equilibrium, force/moment equilibrium and conditioning diagnostics.

## Module Schur solver

A module has 36 interface DOF: 18 bottom + 18 top.

Top-down condensation:

```text
A = Ktt + Supper
S = Kbb - Kbt A^-1 Ktb
p = fb - Kbt A^-1 (ft + pupper)
```

Bottom-up recovery:

```text
ut = A^-1 (ft + pupper - Ktb ub)
```

This is the same linear structural system with a different assembly/solution path. Runtime verification compares the complete displacement/rotation vector and interface equilibrium against global FEM.

For the natural top boundary, modular results distinguish structural transfer from direct top-node load so equipment/fixture loads are neither dropped nor doubled.

## Independent dense reference FEM

The dense oracle independently assembles full `K`, solves by Gaussian elimination and reconstructs reactions/end forces. It does not import the production band solver or module stack.

CI compares global ↔ Schur ↔ dense on canonical scenarios for:

- all 6-DOF displacements/rotations;
- support reactions;
- member local end forces;
- buckling factor where enabled.

See [`TRIPLE_SOLVER_VERIFICATION.md`](TRIPLE_SOLVER_VERIFICATION.md).

## Load semantics

Production input intentionally has one physical representation for each user load. Arbitrary legacy `extraHorizontalLoadN` / `extraVerticalLoadN` do not affect operational load cases.

User-facing operational loads are:

```text
self weight
ice
wind on members
equipmentMassKg
equipmentWindAreaM2
```

Special verification/capacity fixtures use the internal structural option:

```js
buildLoadCase(model, parameters, {
  topPointLoadN: [Fx, Fy, Fz],
})
```

This avoids creating a second public way to specify the same load.

## Member and buckling checks

Current elastic member utilization combines material stress and local Euler buckling:

```text
Ustress = sigma_eq / (Ry/gamma_M)
UEuler = Ncompression / NE
Umember = max(Ustress, UEuler)
```

Global eigen-buckling solves the coupled frame problem from the current compression state and reports an eigen residual. The modular Schur static decomposition does not replace the global eigenproblem.

## Physical connection layer

The frame model keeps ideal-rigid structural nodes. The real intermodule assembly is checked after FEM:

```text
upper module: 2 ribs -> clearance nut My
vertical bolt Mx passes through My
lower module: 4 ribs -> coupling nut Mx
bolt screws into coupling nut
```

Engineering checks include:

- physical bolt/nut geometry;
- nut net section relative to rib area;
- preload and external tension/shear interaction;
- weld demand/effective area/service reserve;
- one fixed selected physical joint reused by special capacity calculations.

Detailed derivations live in [`CONNECTIONS.md`](CONNECTIONS.md), [`JOINT_CONFIGURATOR.md`](JOINT_CONFIGURATOR.md) and [`JOINT_STRENGTH_AND_VISUALIZATION.md`](JOINT_STRENGTH_AND_VISUALIZATION.md).

## Special capacity problems

The current core keeps distinct physical questions instead of conflating them:

- **pure lateral reference** — normalized transverse loading, no ordinary weather/self-weight combination;
- **static top payload** — gravity-only search retaining mast self-weight;
- **horizontal crane boom** — the same frame rotated horizontal, with member self-weight becoming transverse load;
- **maximum height** — discrete module-count search under design/ultimate criteria.

See the corresponding documents:

- [`LATERAL_CAPACITY_WEATHER_VALIDATION.md`](LATERAL_CAPACITY_WEATHER_VALIDATION.md)
- [`STATIC_PAYLOAD_CAPACITY.md`](STATIC_PAYLOAD_CAPACITY.md)
- [`CRANE_BOOM_CAPACITY.md`](CRANE_BOOM_CAPACITY.md)
- [`MODULAR_ANALYSIS_AND_HEIGHT.md`](MODULAR_ANALYSIS_AND_HEIGHT.md)

## Regression contract

Architecture refactoring must not silently change this physics. The safety net from issue #51 includes:

```text
canonical numerical baseline
seeded physical invariants
global/Schur/dense full-vector equivalence
historical bug regressions
40-module correctness/performance guard
Ubuntu/macOS/Windows canonical equivalence
```

Policy and baseline update rules are documented in [`testing/REGRESSION_SAFETY_NET.md`](testing/REGRESSION_SAFETY_NET.md).
