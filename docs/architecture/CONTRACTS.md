# Canonical contracts

Status: current after Architecture Foundation 2.0, Web UI 2.0 result consolidation, and load-action schema migration #113.

## Public project input

All environment adapters construct one grouped `ProjectInput`:

```ts
{
  geometry: { moduleCount, stockBarLengthMm, stockBarPieces, barDiameterMm, moduleDiametersMm? },
  material: { reinforcementClass, materialSafetyFactor },
  loadActions:
    | { profile: 'sp20-2016-amendment-6' }
    | {
        profile: 'manual-migrated-v1',
        steelSelfWeightLoadFactor,
        equipmentLoadFactor,
        iceLoadFactor,
        windLoadFactor,
      },
  environment: {
    windActionMode?, windRegion?, windTerrainType?, windPresetId, windPressurePa?, dragCoefficient,
    windDirectionDeg, windEnvelopeEnabled, windEnvelopeStepDeg, lateralCapacityStepDeg,
    iceThicknessMm, iceDensityKgM3,
  },
  equipment: { massKg, windAreaM2, dragCoefficient },
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

New projects use `sp20-2016-amendment-6`; the resolver owns the named design-action factors and their provenance. `manual-migrated-v1` exists only to preserve historical `project/v1` numerical meaning during explicit migration. It must not be presented as the normative default profile.

The input does **not** contain derived or catalogue-owned values. In particular these are forbidden as user fields: `ribCutLengthMm`, `triangleSideMm`, `moduleHeightMm`, `youngModulusGPa`, `yieldStrengthMPa`, `tensileStrengthMPa`, `densityKgM3`, `windSpeedMs`, `jointEffectiveRadiusMm`, `jointBaseMetalTensileStrengthMPa`, `extraHorizontalLoadN`, and `extraVerticalLoadN`.

`createProjectInput(overrides)` is the convenience constructor. `validateProjectInput()` is the runtime boundary check for complete current external values.

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

`ResolvedProject` contains the flat, fully derived values consumed by numerical and engineering packages, including named action factors and `loadActionProvenance`. Adapters must never construct it directly and must never apply a second default/resolve pass.

Physical modal mass/inertia remains unfactored. Design-action factors belong to load effects and may not leak into modal inertia.

The former transition helpers `resolveCalculationParameters()` and `DEFAULT_PARAMETERS` were removed in #62. They are not production exports and must not be reintroduced as compatibility layers. Tests that need a resolved fixture use `tests/helpers/resolved-project.js`, which maps only user-owned values and resolves through the canonical boundary.

## External project JSON

The current persisted/imported schema is:

```json
{
  "schema": "mast-calculator/project/v2",
  "project": {
    "geometry": {},
    "material": {},
    "loadActions": { "profile": "sp20-2016-amendment-6" },
    "environment": {},
    "equipment": {},
    "connection": {},
    "criteria": {}
  }
}
```

Historical `mast-calculator/project/v1` remains a supported migration source. Its ambiguous coefficients are interpreted exactly as the old runtime did:

```text
environment.deadLoadFactor -> steel self-weight + ice
equipment.loadFactor       -> equipment weight
environment.windLoadFactor -> wind
```

They become a v2 `manual-migrated-v1` profile. Finite zero coefficients are preserved; negative/non-finite values are rejected. Writers always emit v2.

The package may also contain optional user-owned `guys` and `erection` configuration. Derived cable states, erection FEM topology, loads, reactions and envelopes are results and are never persisted as project input.

Public helpers:

```text
createProjectPackage(ProjectInput)
serializeProjectPackage(package)
parseProjectPackage(json)
assertProjectPackage(value)
migrateProjectPackage(value)
```

Unknown schema ids and unknown package/input fields fail closed with `ProjectSchemaError`. Any future incompatible external JSON semantics require a new schema version and explicit tested migration.

## Application result

The canonical headless use case is:

```ts
const result = calculateProject(projectInput)
```

The application resolves input once, performs engineering/design enrichment through copy-on-write assembly, adds final verification, and returns one complete `CalculationResult`. The public result is deeply frozen by default. Web, CLI and Desktop consume this value; they do not add engineering fields after calculation.

For optional guy wires, `calculateProjectWithGuys()` returns the complete `CalculationResult` plus a separate nonlinear `GuyedResult`. The two values deliberately remain separate contracts.

Low-level calculation functions below the application boundary consume `ResolvedProject` directly. They do not accept flat user input and do not perform fallback resolution.

## Engineering summary

Presentation adapters must not independently decide project PASS/FAIL from raw fields. The canonical projection is:

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

`fail` means at least one implemented required criterion failed. `incomplete` is intentionally **not** a soft PASS: no implemented required criterion failed, but at least one required criterion is not verified.

For a guyed project, the current nonlinear cable solver does not yet recompute the physical bolt/weld envelope from guyed member-end actions. Therefore `guyed-connection-envelope` is a required `not-verified` criterion. Ordinary connection PASS plus `GUY PASS` cannot produce full project PASS until that layer exists.

Existing `mast-calculator/result-summary/v1` remains a stable machine transport contract. Its historical bare `passes` field keeps its original four-criterion meaning for compatibility, but those statuses are derived from `engineering-summary/v1`. A future incompatible reinterpretation requires a new schema version.

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

Imports inside TypeScript source use NodeNext runtime specifiers such as `./module.js`; TypeScript and the architecture audit resolve them to the owning `.ts` source file while emitted JavaScript keeps the runtime-compatible path.

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

Canonical numerical equivalence remains a veto except for explicitly reviewed physics/schema changes such as #113. Baselines or tolerances must never be weakened merely to make a migration pass. Intentional numerical changes must be demonstrated and reviewed independently from serialization compatibility.
