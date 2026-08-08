# Canonical contracts

Status: current after Architecture Foundation 2.0 and Web UI 2.0 result consolidation.

## Public project input

All environment adapters construct one grouped `ProjectInput`:

```ts
{
  geometry: { moduleCount, stockBarLengthMm, stockBarPieces, barDiameterMm, moduleDiametersMm? },
  material: { reinforcementClass, materialSafetyFactor },
  environment: {
    deadLoadFactor, windLoadFactor, windPresetId, windPressurePa?, dragCoefficient,
    windDirectionDeg, windEnvelopeEnabled, windEnvelopeStepDeg, lateralCapacityStepDeg,
    iceThicknessMm, iceDensityKgM3,
  },
  equipment: { massKg, windAreaM2, dragCoefficient, loadFactor },
  connection: {
    configuratorMode, boltDiameterMm, boltClass, clearanceNutThreadMm, boltLengthMm,
    threadEngagementFactor, boltShearPlanes, conditionFactor, weldConsumableId,
    weldLegMm, weldSegmentsPerEnd, weldBetaF, weldBetaZ,
    tighteningTorqueNm?, nutFactor?, preloadVariation?, nutSectionAreaRatio?,
    weldToRibAreaRatio?, weldServiceYears?, weldInitialStiffnessRetention?,
    weldAnnualStiffnessLossRate?, weldMinimumStiffnessRetention?,
  },
  criteria: { displacementLimitMm, minimumBucklingFactor, heightSearchMaxModules },
}
```

The input does **not** contain derived or catalogue-owned values. In particular these are forbidden as user fields: `ribCutLengthMm`, `triangleSideMm`, `moduleHeightMm`, `youngModulusGPa`, `yieldStrengthMPa`, `tensileStrengthMPa`, `densityKgM3`, `windSpeedMs`, `jointEffectiveRadiusMm`, `jointBaseMetalTensileStrengthMPa`, `extraHorizontalLoadN`, and `extraVerticalLoadN`.

`createProjectInput(overrides)` is the convenience constructor. `validateProjectInput()` is the runtime boundary check for complete external values.

## Resolution

There is one public resolution step:

```text
ProjectInput
   |
   v
resolveProjectInput()
   |
   v
ResolvedProject
```

`ResolvedProject` contains the flat, fully derived values consumed by the numerical and engineering implementation. Adapters must never construct it directly and must never apply a second default/resolve pass.

The former transition helpers `resolveCalculationParameters()` and `DEFAULT_PARAMETERS` were removed in #62. They are not production exports and must not be reintroduced as compatibility layers. Low-level tests that need a resolved fixture use a test-only adapter under `tests/helpers/`; that adapter accepts only user-owned project fields and resolves them through the same canonical `ProjectInput -> resolveProjectInput()` path.

## Application result

The canonical headless use case is:

```ts
const result = calculateProject(projectInput)
```

The application resolves input once, performs all engineering/design enrichment through copy-on-write assembly, adds final verification, and returns one complete `CalculationResult`. The public result is deeply frozen by default. Web, CLI and Desktop adapters consume this value; they do not add engineering fields after calculation.

For a project with optional guy wires, `calculateProjectWithGuys()` returns the normal complete `CalculationResult` plus a separate nonlinear `GuyedResult`. The two values are deliberately not merged into one incompatible result type. `GuyedResult` currently owns member/cable/displacement/buckling envelope checks; normal special capacity searches remain part of `CalculationResult`.

Low-level calculation functions below the application boundary consume `ResolvedProject` directly. They do not accept flat user input and do not perform fallback resolution.

## Engineering summary

Presentation adapters must not independently decide project PASS/FAIL from raw result fields. The canonical projection is:

```text
mast-calculator/engineering-summary/v1
```

created by:

```ts
createEngineeringSummary(calculationResult, optionalGuyedResult)
```

Each criterion has a stable id, group, source, status, required flag, comparison, value, limit and normalized ratio. The summary publishes:

```text
overallStatus: pass | fail | incomplete
governingCriterionId
pendingCriterionIds[]
criteria[]
capacities
```

`fail` means at least one implemented required criterion has failed. `incomplete` is intentionally **not** a soft PASS: no implemented required criterion has failed, but at least one required criterion is not verified.

For a guyed project, the current nonlinear cable solver does not yet recompute the physical bolt/weld envelope from guyed member-end actions. Therefore `guyed-connection-envelope` is a required `not-verified` criterion. A known ordinary connection failure is still a hard veto, but ordinary connection PASS plus `GUY PASS` cannot produce full project PASS. Until the guyed connection layer exists, an otherwise passing guyed project is `incomplete`.

Existing `mast-calculator/result-summary/v1` remains a stable machine transport contract. Its historical bare `passes` field keeps its original four-criterion meaning for compatibility, but those four statuses are now derived from `engineering-summary/v1` rather than from duplicated comparison formulas. A future incompatible reinterpretation of `result-summary/v1` requires a new schema version.

## External JSON

Persisted/imported project JSON is versioned independently from internal TypeScript shapes:

```json
{
  "schema": "mast-calculator/project/v1",
  "project": {
    "geometry": {},
    "material": {},
    "environment": {},
    "equipment": {},
    "connection": {},
    "criteria": {}
  }
}
```

The package may also contain optional user-owned `guys` input. Derived cable lengths, tensions, reactions and envelopes are results and are never persisted as project input.

Public helpers:

```text
createProjectPackage(ProjectInput)
serializeProjectPackage(package)
parseProjectPackage(json)
assertProjectPackage(value)
```

Unknown schema ids and unknown package/input fields fail closed with `ProjectSchemaError`. An incompatible future schema must receive a new version and explicit migration path; silently accepting unknown fields or reinterpreting them is forbidden.

## Errors

Application entrypoints normalize boundary failures to `MastApplicationError`. Categories are:

- `input-validation`
- `unsupported-configuration`
- `numerical-failure`
- `convergence-failure`
- `schema-error`
- `internal-invariant`

Adapters may translate these errors into UI/CLI messages, but must not infer engineering semantics from arbitrary exception strings.

## TypeScript/runtime ownership

Canonical packages are authored only in TypeScript. Compiler output is emitted to `.build/packages` for Node tests and Web publication. Source `.js` implementations, compatibility wrappers and `allowJs` are forbidden by architecture tests.

Imports inside TypeScript source intentionally use NodeNext runtime specifiers such as `./module.js`; TypeScript and the architecture audit resolve those specifiers to the owning `.ts` source file, while emitted JavaScript keeps the runtime-compatible path.

## CI contract

The contract boundary is guarded by:

```bash
npm run typecheck
npm run build:core
npm run test:contracts
npm run test:headless
npm run test:architecture
npm run audit:architecture
npm test
```

Canonical numerical equivalence remains a veto: contract or TypeScript refactoring is not allowed to alter engineering results except for explicitly reviewed serialization changes caused by removal of dead fields. The frozen canonical baseline is never regenerated merely to make a migration pass.
