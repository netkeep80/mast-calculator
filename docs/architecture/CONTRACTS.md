# Canonical contracts

Status: current for Architecture Foundation 2.0 issues #61 and #62.

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

Low-level calculation functions below the application boundary consume `ResolvedProject` directly. They do not accept flat user input and do not perform fallback resolution.

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
npm run test:foundation
npm run test:architecture
npm run audit:architecture
npm test
```

Canonical numerical equivalence remains a veto: contract or TypeScript refactoring is not allowed to alter engineering results except for explicitly reviewed serialization changes caused by removal of dead fields. The frozen canonical baseline is never regenerated merely to make a migration pass.
